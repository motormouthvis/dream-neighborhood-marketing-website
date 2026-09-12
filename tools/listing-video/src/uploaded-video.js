"use strict";

/**
 * A finished video somebody made somewhere else, hosted here.
 *
 * Everything else in this tool builds a video: it finds a listing, films the
 * Explorers, draws the scenes and lays a voice over them. This is the other
 * thing Myles needs, and it is much smaller. He already has videos - a screen
 * recording, something a phone shot, something cut in another editor - and what
 * he wants from this box is the part that has nothing to do with making them:
 * a `/v/{id}` link he can send, a card in the Library, and the same email flow.
 *
 * So there is no capture on this path and no Explorer. No Chrome is opened at
 * all. The file arrives, it is checked, and it becomes a job that is already
 * ready - which is why the public watch page, the library list and the send step
 * did not have to learn anything new: they were only ever asking a job for
 * `result.videoFile`.
 *
 * What this deliberately does NOT do:
 *
 *   It does not trust the upload's content type or its file name. A browser will
 *   label a file whatever it likes and multer passes it straight through, so the
 *   container is read out of the bytes and ffprobe has to find a video stream in
 *   it before anything is kept. Same rule as src/listing-image.js.
 *
 *   It does not re-encode. A re-encode of a couple of minutes of 1080p is
 *   minutes of ffmpeg on a small dyno, and this is a request somebody is waiting
 *   on. The file is remuxed - the same picture and sound, copied into a new
 *   container with its index at the front so a browser can start playing before
 *   it has the whole file - which is seconds, and is the one thing a video made
 *   for a hard drive usually lacks.
 */

const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");
const { run } = require("./exec");

/*
 * How big an upload may be, and why this number.
 *
 * Heroku's router hangs up a request when 55 seconds pass with no bytes moving,
 * and the dyno's disk is small and ephemeral. A minute of 1080p out of a screen
 * recorder is roughly 10-20MB, so 120MB is several minutes of the kind of video
 * this is for and still lands inside the router's patience on any ordinary line.
 * Beyond that the answer is not a bigger number here - it is a shorter video, or
 * a real video host.
 *
 * The refusal names the number, because "that file is too big" with no size in
 * it is the least useful sentence a form can say.
 */
const MAX_UPLOADED_VIDEO_BYTES = 120 * 1024 * 1024;

/** Long enough to be a video rather than a stray frame or a broken export. */
const MIN_UPLOADED_VIDEO_SECONDS = 1;

/*
 * As long as anything anybody would send a customer, with room to spare.
 *
 * Not a technical limit - the disk is the technical limit - but a 40 minute
 * upload on this box is a mistake, and finding out after it has been sent is
 * worse than finding out on the form.
 */
const MAX_UPLOADED_VIDEO_SECONDS = 20 * 60;

function videoError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

/*
 * The mp4 family, read out of the bytes.
 *
 * An ISO base media file starts with a box: four bytes of length, then the type.
 * For the first box that type is `ftyp`, and the four bytes after it are the
 * brand - `isom`, `mp42`, `avc1`, `M4V ` and so on, all of which a browser plays
 * as an mp4. QuickTime's `qt  ` brand is here too because that is what a Mac
 * screen recording saved as .mov actually is, and the picture inside it is
 * usually H.264 that will remux into an mp4 without being re-encoded.
 *
 * WebM is deliberately not accepted. Safari does not play it, and a link that
 * works for Myles and not for the customer he sent it to is worse than a refusal.
 */
const MP4_BRANDS = /^(isom|iso2|iso4|iso5|iso6|avc1|mp41|mp42|mp71|M4V |M4VP|M4A |mmp4|dash|qt {2})$/;

function sniffVideoBrand(buffer) {
  if (!buffer || buffer.length < 12) return "";
  if (buffer.toString("latin1", 4, 8) !== "ftyp") return "";
  const brand = buffer.toString("latin1", 8, 12);
  return MP4_BRANDS.test(brand) ? brand : "";
}

/** Is this an mp4 (or a QuickTime file we can put in an mp4 container)? */
function looksLikeMp4(buffer) {
  return Boolean(sniffVideoBrand(buffer));
}

/**
 * What ffprobe says is in the file: how long, and how big the picture is.
 *
 * Asked of the streams rather than the container, because a container's duration
 * can be missing on a file that was written by something that crashed. No video
 * stream at all is the refusal that matters: an audio-only m4a will otherwise
 * sail through the byte check, since it is the same container.
 */
async function probeVideo(file) {
  let stdout = "";
  try {
    ({ stdout } = await run(
      config.ffprobePath,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,codec_name:format=duration",
        "-of",
        "json",
        file,
      ],
      { timeout: 60000 }
    ));
  } catch (error) {
    throw videoError(
      "UPLOADED_VIDEO_UNREADABLE",
      "That file could not be read as a video. Export it again as an mp4 and upload that."
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(String(stdout));
  } catch (_) {
    parsed = {};
  }
  const stream = (parsed.streams || [])[0];
  if (!stream || !stream.width || !stream.height) {
    throw videoError(
      "UPLOADED_VIDEO_NO_PICTURE",
      "There is no picture in that file - it reads as audio only. Upload the mp4 of the video itself."
    );
  }

  const duration = Number((parsed.format || {}).duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw videoError(
      "UPLOADED_VIDEO_NO_LENGTH",
      "That file does not say how long it is, which usually means the export did not finish. Export it again and upload that."
    );
  }

  return {
    durationSeconds: duration,
    width: Number(stream.width),
    height: Number(stream.height),
    codec: String(stream.codec_name || ""),
  };
}

/**
 * Take an upload and leave a playable video and a poster in the job's folder.
 *
 * Comes out shaped like the `result` a rendered job ends up with, so the watch
 * page, the library and the send step read it the same way they read a video
 * this tool made.
 */
async function prepareUploadedVideo({ sourcePath, jobDir, log = () => {} }) {
  let head;
  try {
    const handle = await fsp.open(sourcePath, "r");
    try {
      const buffer = Buffer.alloc(64);
      const { bytesRead } = await handle.read(buffer, 0, 64, 0);
      head = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch (_) {
    throw videoError("UPLOADED_VIDEO_MISSING", "That upload is no longer on the server. Pick the file again.");
  }

  if (!looksLikeMp4(head)) {
    throw videoError(
      "UPLOADED_VIDEO_NOT_MP4",
      "That file is not an mp4. Export or save the video as an mp4 (H.264) and upload that - a .webm, a .mkv or a .zip will not do, because not every browser the customer might use can play them."
    );
  }

  const probed = await probeVideo(sourcePath);
  if (probed.durationSeconds < MIN_UPLOADED_VIDEO_SECONDS) {
    throw videoError(
      "UPLOADED_VIDEO_TOO_SHORT",
      `That video is only ${probed.durationSeconds.toFixed(1)} seconds long, which is not a video anybody can watch. Upload the finished cut.`
    );
  }
  if (probed.durationSeconds > MAX_UPLOADED_VIDEO_SECONDS) {
    throw videoError(
      "UPLOADED_VIDEO_TOO_LONG",
      `That video is ${Math.round(probed.durationSeconds / 60)} minutes long, and this box only hosts short prospecting videos. Cut it down, or put a video that long somewhere built for it.`
    );
  }

  await fsp.mkdir(jobDir, { recursive: true });
  const videoFile = path.join(jobDir, "video.mp4");
  const posterFile = path.join(jobDir, "poster.jpg");

  /*
   * Remuxed, not re-encoded: the picture and the sound are copied across
   * untouched and only the container is rewritten, with its index moved to the
   * front so a browser can start playing before the whole file has arrived. A
   * video exported for a hard drive usually has that index at the end, which is
   * what makes a watch link sit on a black frame until the download finishes.
   */
  log("Checking the file and moving its index to the front so it starts playing straight away");
  try {
    await run(
      config.ffmpegPath,
      ["-y", "-i", sourcePath, "-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-movflags", "+faststart", videoFile],
      { timeout: 600000 }
    );
  } catch (error) {
    // ffmpeg's last words, so a refusal is something somebody can act on.
    const said = String(error.message || "").split("\n").filter(Boolean).slice(-2).join(" ");
    throw videoError(
      "UPLOADED_VIDEO_NOT_PLAYABLE",
      `That video could not be prepared for the web${said ? ` (${said})` : ""}. Export it again as an mp4 with H.264 video and AAC audio.`
    );
  }

  // Read back off the file that will actually be served, not off the upload.
  const kept = await probeVideo(videoFile);

  /*
   * The thumbnail, from a second or so in.
   *
   * Not frame zero: a lot of videos open on a fade from black, and a black
   * poster reads as a broken link on the watch page. A poster that cannot be
   * made is not worth failing an upload over - the watch page falls back to the
   * video's own first frame.
   */
  const at = Math.min(1.5, Math.max(0.2, kept.durationSeconds / 3));
  await run(
    config.ffmpegPath,
    ["-y", "-ss", at.toFixed(2), "-i", videoFile, "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "4", posterFile],
    { timeout: 120000 }
  ).catch(() => null);

  log(
    `Ready: ${kept.width}x${kept.height}, ${kept.durationSeconds.toFixed(1)}s${
      kept.codec ? `, ${kept.codec}` : ""
    }`
  );

  return {
    videoFile,
    posterFile,
    durationSeconds: Math.round(kept.durationSeconds),
    width: kept.width,
    height: kept.height,
    codec: kept.codec,
  };
}

module.exports = {
  prepareUploadedVideo,
  probeVideo,
  looksLikeMp4,
  sniffVideoBrand,
  MAX_UPLOADED_VIDEO_BYTES,
  MIN_UPLOADED_VIDEO_SECONDS,
  MAX_UPLOADED_VIDEO_SECONDS,
};
