"use strict";

/*
 * The marketer's face, in the corner of their own video.
 *
 * Myles's argument for it is authenticity: a prospecting video with a person in
 * it is somebody talking to a realtor, and one without is a slideshow with a
 * voice on it. So the take can carry the camera as well as the microphone, and
 * what the camera saw is composited into the finished cut as a small rounded
 * card.
 *
 * BOTTOM LEFT, AND ONLY BOTTOM LEFT. The bottom right corner is where the
 * School Explorer house button sits on every listing frame - see views/frame.html
 * - and that button is the one thing these videos are about. A face over it
 * would break the video to decorate it.
 *
 * Nothing in here is allowed to lose a take. A camera that was not recorded, a
 * file with no video track in it, a clip ffmpeg will not read: each of those
 * comes back as "no picture-in-picture on this one" and the voice is burned on
 * exactly as it always was. The take is the thing somebody spent a minute
 * recording; the face is the garnish.
 */

const path = require("path");
const config = require("./config");
const { run } = require("./exec");
const { probeDuration } = require("./audio");

/**
 * The card, in the 1920x1080 the finished video is built at.
 *
 * `width`/`height` are the camera picture itself and `border` is the white edge
 * drawn around it, so the card on screen is width+2*border by height+2*border.
 *
 * Sized as a compromise rather than as big as it could be. The Explorer popups
 * are drawn from x=150 to x=1750 and stop at y=948 (views/frame.html), so a card
 * in the bottom left corner of a 1080-tall frame unavoidably covers part of the
 * popup's bottom left corner. Smaller means less of the product hidden; bigger
 * means a face somebody can actually read at email-preview size. 264x198 takes a
 * corner off the popup about a tenth of its width and costs nothing that carries
 * a number or a label in it.
 *
 * 4:3 rather than 16:9 on purpose: a widescreen webcam gets cropped in at the
 * sides, which puts the person in the middle of the card instead of marooned in
 * the middle of a letterbox.
 */
const PIP = {
  width: 264,
  height: 198,
  border: 6,
  radius: 24,
  margin: 40,
};

/** The white card including its border - what actually lands on the frame. */
const CARD_WIDTH = PIP.width + PIP.border * 2;
const CARD_HEIGHT = PIP.height + PIP.border * 2;

/** Below this there is no clip worth compositing, only a flicker. */
const LEAST_CLIP_SECONDS = 0.5;

/**
 * Is there a camera in this take at all?
 *
 * The browser records one file with both tracks in it, so a take with the webcam
 * switched on and a take without are the same upload with a different number of
 * streams. Asked of the file rather than trusted from the form: a browser that
 * was refused the camera still posts the take, and it still has to work.
 */
async function hasVideoTrack(file) {
  try {
    const { stdout } = await run(config.ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "default=nw=1:nk=1",
      file,
    ]);
    return String(stdout).trim() === "video";
  } catch (_) {
    return false;
  }
}

/**
 * The camera track, cut to the same span of the take the voice was cut to.
 *
 * src/audio.js does not use the whole recording. It takes the dead air off the
 * front - a browser take usually starts with several seconds of somebody
 * reaching for the mouse - and off the end, and then puts a known 0.6s of
 * silence back in front. So the voice in the finished video is a window onto the
 * middle of the take, and the camera has to be cut to exactly the same window or
 * the mouth stops matching the words.
 *
 * `align` is that window, measured by buildRecordedTrack rather than guessed
 * here: how much came off the front, how much was left, and where it lands in
 * the finished cut.
 *
 * Also re-encoded rather than passed through. A MediaRecorder webm has no
 * duration in its header and its frames arrive whenever the camera felt like
 * sending one; re-encoding at a fixed 30fps gives the overlay pass a file whose
 * timestamps mean what they say.
 */
async function prepareWebcamClip({ takePath, workDir, align, log = () => {} }) {
  if (!(await hasVideoTrack(takePath))) {
    log("No camera in that take - the video gets the voice and no picture-in-picture");
    return null;
  }

  const skip = Math.max(0, Number(align && align.skipSeconds) || 0);
  const keep = Number(align && align.keepSeconds) || 0;
  const startsAt = Math.max(0, Number(align && align.startSeconds) || 0);

  if (!(keep > LEAST_CLIP_SECONDS)) {
    log("The take was too short to put a camera card on - the voice goes on without one");
    return null;
  }

  const outFile = path.join(workDir, "webcam.mp4");
  try {
    await run(
      config.ffmpegPath,
      [
        "-y",
        // A browser recording carries no timestamps worth having; make some.
        "-fflags",
        "+genpts",
        "-i",
        takePath,
        "-an",
        // Seeking on the output side, not the input: it decodes what it skips,
        // which is slower and is the only accurate way to cut a webm like this.
        "-ss",
        skip.toFixed(3),
        "-t",
        keep.toFixed(3),
        "-vf",
        `fps=30,scale=${PIP.width}:${PIP.height}:force_original_aspect_ratio=increase,crop=${PIP.width}:${PIP.height},setsar=1`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        outFile,
      ],
      { timeout: 600000 }
    );
  } catch (error) {
    // A camera that will not re-encode is not a reason to throw the voice away.
    log(`The camera track could not be prepared (${firstWords(error)}) - burning the voice without it`);
    return null;
  }

  let seconds;
  try {
    seconds = await probeDuration(outFile);
  } catch (_) {
    log("The camera clip came out unreadable - burning the voice without it");
    return null;
  }
  if (seconds < LEAST_CLIP_SECONDS) {
    log("The camera clip came out too short to use - burning the voice without it");
    return null;
  }

  log(`Camera card ready: ${seconds.toFixed(1)}s, starting ${startsAt.toFixed(1)}s into the video`);
  return { file: outFile, seconds, startSeconds: startsAt };
}

/** ffmpeg's last words, short enough to put in a progress log. */
function firstWords(error) {
  return String((error && error.message) || "")
    .split("\n")
    .filter(Boolean)
    .slice(-1)
    .join(" ")
    .slice(0, 160);
}

/**
 * The filter that puts the card on the picture.
 *
 * Three things happen to the camera stream and one to the join:
 *
 *   pad      a white edge all the way round, so the card has a boundary against
 *            a listing photo that might be any colour at all
 *   geq      the corners rounded off, by making the alpha channel zero outside a
 *            quarter circle of PIP.radius in each corner. Per pixel and per
 *            frame, which sounds expensive and is not: the card is 276x210, and
 *            the whole overlay pass still runs several times faster than real
 *            time on a dyno-sized CPU
 *   setpts   shifted to where the voice starts, because the finished video opens
 *            with 0.6s of silence before the first word and a face that appeared
 *            before it would be talking to nobody
 *
 * and then `overlay` drops it in the bottom left corner, `repeatlast=0` so the
 * card disappears when the take runs out rather than freezing on screen for the
 * rest of the video, and `eof_action=pass` so the picture keeps going without it.
 */
function pipFilter({ input = "2:v", base = "base", out = "v", startSeconds = 0 }) {
  const r = PIP.radius;
  // Zero alpha outside the rounded corners: only pixels within `r` of both a
  // vertical and a horizontal edge are tested at all, and those are kept only if
  // they fall inside the quarter circle.
  const alpha =
    `if(gt(abs(W/2-X),W/2-${r})*gt(abs(H/2-Y),H/2-${r}),` +
    `if(lte(hypot(${r}-(W/2-abs(W/2-X)),${r}-(H/2-abs(H/2-Y))),${r}),255,0),255)`;

  const card =
    `[${input}]pad=${CARD_WIDTH}:${CARD_HEIGHT}:${PIP.border}:${PIP.border}:color=white,format=rgba,` +
    `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}',` +
    `setpts=PTS-STARTPTS+${startSeconds.toFixed(3)}/TB[pip]`;

  const drop =
    `[${base}][pip]overlay=x=${PIP.margin}:y=H-h-${PIP.margin}:` +
    `eof_action=pass:repeatlast=0,format=yuv420p[${out}]`;

  return `${card};${drop}`;
}

module.exports = {
  PIP,
  CARD_WIDTH,
  CARD_HEIGHT,
  LEAST_CLIP_SECONDS,
  hasVideoTrack,
  prepareWebcamClip,
  pipFilter,
};
