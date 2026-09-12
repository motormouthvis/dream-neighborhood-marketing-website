"use strict";

const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");
const { run } = require("./exec");
const { probeDuration } = require("./audio");
const { pipFilter } = require("./webcam");

/*
 * How long the finished video is: whatever the scene lengths handed in add up to.
 *
 * Nothing here decides those. Two callers do, and they answer differently on
 * purpose - see attachAudio in render.js:
 *
 *   Overdub. The silent cut's own lengths, unchanged. That is the picture that
 *   was approved and the picture the take was recorded against, so a shorter
 *   voice does not shorten it: the picture holds and the audio stops.
 *
 *   AI voice. The lengths src/audio.js measured off the spoken lines. The
 *   picture follows the voice, so the video comes out as long as the speech
 *   plus a breath rather than as long as the script's guess at it.
 *
 * Either way nothing is padded on after the last word, and the only thing that
 * makes a finished video shorter than it was built is a person trimming it on
 * the final review: trimVideoAt below.
 */

const ENCODE = [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-profile:v",
  "high",
  "-level",
  "4.0",
  "-movflags",
  "+faststart",
];

async function writeConcatList({ frames, durations, workDir, name }) {
  const lines = [];
  frames.forEach((frame, index) => {
    lines.push(`file '${frame.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${durations[index].toFixed(3)}`);
  });
  // The concat demuxer ignores the duration of the last entry, so it is
  // repeated to hold the final frame for its full time.
  lines.push(`file '${frames[frames.length - 1].replace(/'/g, "'\\''")}'`);
  const listFile = path.join(workDir, name);
  await fsp.writeFile(listFile, `${lines.join("\n")}\n`, "utf8");
  return listFile;
}

/**
 * The picture on its own, with no audio track at all. This is what gets watched
 * while the voice is recorded, so the words land on the right scenes.
 */
async function buildSilentVideo({ frames, durations, workDir, outFile, log }) {
  if (frames.length !== durations.length) {
    throw new Error("Internal error: frame count and beat count do not match.");
  }
  const listFile = await writeConcatList({ frames, durations, workDir, name: "frames-silent.txt" });
  const total = durations.reduce((sum, value) => sum + value, 0);

  log("Rendering the silent video");
  await run(
    config.ffmpegPath,
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-an",
      "-t",
      total.toFixed(3),
      "-vf",
      "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p",
      ...ENCODE,
      "-crf",
      "20",
      outFile,
    ],
    { timeout: 900000 }
  );

  return { file: outFile, duration: await probeDuration(outFile) };
}

/**
 * The same stills, this time with a voice track laid over them.
 *
 * The finished video is as long as the scene lengths add up to. On an overdub
 * those are the silent cut's, so silent 60 with a 30 second voice comes out 60:
 * the picture runs to the end and the audio stops. On the AI path they were
 * measured off the speech, so a script that guesses 60 for forty seconds of
 * words comes out at about forty.
 *
 * Nothing is padded on after the last word either way, and the picture is never
 * quietly cut back to the voice - if it is shorter it is because the caller
 * asked for shorter scenes.
 *
 * The one exception is a voice that runs past those scenes, and it is there to
 * avoid clipping somebody mid-word: the last scene is held to cover it.
 *
 * Making a finished video shorter than it was built is a person's decision,
 * taken on the final review with "Trim Remainder of Video" - see trimVideoAt.
 *
 * `webcam`, when there is one, is the camera card: a clip from src/webcam.js
 * that gets composited into the bottom left corner for as long as it lasts. It
 * is an overlay and nothing more - it does not touch the scene lengths, it does
 * not touch the audio, and a video built without one comes out byte for byte the
 * same as it did before any of this existed.
 */
async function buildVideo({ frames, durations, audioFile, workDir, outFile, log, webcam = null }) {
  if (frames.length !== durations.length) {
    throw new Error("Internal error: frame count and beat count do not match.");
  }

  const audioDuration = await probeDuration(audioFile);
  const scenes = durations.slice();
  const plannedTotal = scenes.reduce((sum, value) => sum + value, 0);
  // Only ever what the scenes ask for, unless the voice would be clipped.
  const videoDuration = Math.max(plannedTotal, audioDuration);
  scenes[scenes.length - 1] += Math.max(0, videoDuration - plannedTotal);

  const listFile = await writeConcatList({ frames, durations: scenes, workDir, name: "frames-voiced.txt" });

  /*
   * The stills, and then the camera card on top of them if there is one.
   *
   * Without a camera this is the one pass over a list of JPEGs it has always
   * been, written as a filtergraph rather than a -vf so that both paths encode
   * through the same code. With one there is a second video input and the
   * pictures are a background the card is composited onto - see src/webcam.js
   * for the card itself and for why it can only ever go bottom left.
   */
  const scaleStills = "[0:v]fps=30,scale=1920:1080:flags=lanczos[base]";
  const filter = webcam
    ? `${scaleStills};${pipFilter({ input: "2:v", base: "base", out: "v", startSeconds: webcam.startSeconds || 0 })}`
    : `${scaleStills};[base]format=yuv420p[v]`;

  log(webcam ? "Rendering the video with your audio and camera" : "Rendering the video with your audio");
  await run(
    config.ffmpegPath,
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-i",
      audioFile,
      ...(webcam ? ["-i", webcam.file] : []),
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "1:a:0",
      "-t",
      videoDuration.toFixed(3),
      // The voice is usually shorter than the picture, so the track is padded
      // with silence to the end. The picture holds; the audio has finished.
      "-af",
      "apad",
      ...ENCODE,
      "-crf",
      "21",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-ar",
      "44100",
      outFile,
    ],
    { timeout: 900000 }
  );

  return { file: outFile, duration: await probeDuration(outFile) };
}

/** The shortest a trimmed video is allowed to be, so nobody keeps two frames. */
const MIN_TRIMMED_SECONDS = 3;

/**
 * Cut everything after a point a person chose.
 *
 * The only thing that shortens a finished video. Nothing here guesses: the
 * playhead is where they paused it on the final review, and everything after it
 * goes - picture and audio together.
 *
 * Re-encoded rather than stream-copied, because a stream copy cuts at the
 * previous keyframe and would leave up to a couple of seconds of whatever they
 * wanted rid of.
 */
async function trimVideoAt({ inputFile, atSeconds, outFile, log = () => {} }) {
  let full;
  try {
    full = await probeDuration(inputFile);
  } catch (error) {
    throw new Error(`The video could not be read to trim it (${error.message}).`);
  }
  const asked = Number(atSeconds);

  if (!Number.isFinite(asked) || asked <= 0) {
    throw new Error("Pause the video where you want it to end, then trim.");
  }
  if (asked < MIN_TRIMMED_SECONDS) {
    throw new Error(`A video has to be at least ${MIN_TRIMMED_SECONDS} seconds long. Pause it later and try again.`);
  }

  /*
   * The playhead is a browser's idea of the time and this is ffprobe's, and the
   * two disagree by a frame or so. A cut is not refused over that: the time is
   * pulled just inside the end of the file instead, so pausing a whisker past
   * where ffprobe thinks the video stops still trims.
   */
  const LAST_FRAME = 0.05;
  const at = Math.min(asked, full - LAST_FRAME);
  if (at < MIN_TRIMMED_SECONDS || at <= 0) {
    throw new Error("That is already the end of the video. Pause it earlier to cut something off.");
  }
  // Genuinely at the end: there is nothing to remove, so nothing is re-encoded.
  if (full - at <= LAST_FRAME * 1.5) {
    throw new Error("That is already the end of the video. Pause it earlier to cut something off.");
  }
  if (at < asked - 0.01) log(`The player and the file disagree slightly; cutting at ${at.toFixed(2)}s`);

  log(`Cutting everything after ${at.toFixed(1)}s of ${full.toFixed(1)}s`);
  try {
    await run(
      config.ffmpegPath,
      [
        "-y",
        "-i",
        inputFile,
        "-t",
        at.toFixed(3),
        "-vf",
        "fps=30,format=yuv420p",
        ...ENCODE,
        "-crf",
        "21",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-ar",
        "44100",
        outFile,
      ],
      { timeout: 900000 }
    );
  } catch (error) {
    // ffmpeg's last words, so a failure is something a person can act on rather
    // than a bare "that video was not trimmed".
    const said = String(error.message || "").split("\n").filter(Boolean).slice(-2).join(" ");
    throw new Error(`The video could not be re-encoded to cut it${said ? ` (${said})` : ""}.`);
  }

  let duration;
  try {
    duration = await probeDuration(outFile);
  } catch (error) {
    throw new Error(`The cut was made but the new file could not be read (${error.message}).`);
  }
  return { file: outFile, duration, wasSeconds: full };
}

async function buildPoster({ frames, outFile }) {
  // Prefer a frame with the explorer card open - it makes a better thumbnail.
  const source = frames[Math.min(frames.length - 1, Math.max(0, frames.length - 3))];
  await run(config.ffmpegPath, ["-y", "-i", source, "-vf", "scale=1280:-2", "-q:v", "4", outFile]);
  return outFile;
}

module.exports = { buildSilentVideo, buildVideo, buildPoster, trimVideoAt, MIN_TRIMMED_SECONDS };
