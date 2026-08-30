"use strict";

const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");
const { run } = require("./exec");
const { probeDuration } = require("./audio");

/*
 * The silent cut's length is the length of the finished video.
 *
 * That is the picture that was approved, so that is what gets sent. A shorter
 * voice does not shorten it - the picture holds and the audio stops - and nothing
 * is padded on after the last word.
 *
 * The only thing that makes a video shorter is a person trimming it on the final
 * review: trimVideoAt below.
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
 * The finished video is as long as the silent cut. Silent 60 with a 30 second
 * voice comes out 60; silent 12 with a 12 second voice comes out 12. The picture
 * runs to the end and the audio stops. Nothing is padded on after the last word
 * and the picture is never cut back to the voice.
 *
 * The one exception is a voice that runs past the script, and it is there to
 * avoid clipping somebody mid-word: the last scene is held to cover it.
 *
 * Making a video shorter is a person's decision, taken on the final review with
 * "Trim Remainder of Video" - see trimVideoAt below.
 */
async function buildVideo({ frames, durations, audioFile, workDir, outFile, log }) {
  if (frames.length !== durations.length) {
    throw new Error("Internal error: frame count and beat count do not match.");
  }

  const audioDuration = await probeDuration(audioFile);
  const scenes = durations.slice();
  const plannedTotal = scenes.reduce((sum, value) => sum + value, 0);
  // Only ever the silent cut's length, unless the voice would be clipped.
  const videoDuration = Math.max(plannedTotal, audioDuration);
  scenes[scenes.length - 1] += Math.max(0, videoDuration - plannedTotal);

  const listFile = await writeConcatList({ frames, durations: scenes, workDir, name: "frames-voiced.txt" });

  log("Rendering the video with your audio");
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
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-t",
      videoDuration.toFixed(3),
      // The voice is usually shorter than the picture, so the track is padded
      // with silence to the end. The picture holds; the audio has finished.
      "-af",
      "apad",
      "-vf",
      "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p",
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
  const full = await probeDuration(inputFile);
  const at = Number(atSeconds);

  if (!Number.isFinite(at) || at <= 0) {
    throw new Error("Pause the video where you want it to end, then trim.");
  }
  if (at < MIN_TRIMMED_SECONDS) {
    throw new Error(`A video has to be at least ${MIN_TRIMMED_SECONDS} seconds long. Pause it later and try again.`);
  }
  // Within a frame of the end there is nothing to remove.
  if (at >= full - 0.05) {
    throw new Error("That is already the end of the video. Pause it earlier to cut something off.");
  }

  log(`Cutting everything after ${at.toFixed(1)}s`);
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

  return { file: outFile, duration: await probeDuration(outFile), wasSeconds: full };
}

async function buildPoster({ frames, outFile }) {
  // Prefer a frame with the explorer card open - it makes a better thumbnail.
  const source = frames[Math.min(frames.length - 1, Math.max(0, frames.length - 3))];
  await run(config.ffmpegPath, ["-y", "-i", source, "-vf", "scale=1280:-2", "-q:v", "4", outFile]);
  return outFile;
}

module.exports = { buildSilentVideo, buildVideo, buildPoster, trimVideoAt, MIN_TRIMMED_SECONDS };
