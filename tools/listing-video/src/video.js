"use strict";

const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");
const { run } = require("./exec");
const { probeDuration } = require("./audio");

const TAIL_SECONDS = 1.0;

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
 * The same stills, this time with a voice track laid over them. Any rounding
 * drift plus a short tail is absorbed by the last scene, so the picture never
 * ends before the last word.
 */
async function buildVideo({ frames, durations, audioFile, workDir, outFile, log }) {
  if (frames.length !== durations.length) {
    throw new Error("Internal error: frame count and beat count do not match.");
  }

  const audioDuration = await probeDuration(audioFile);
  const scenes = durations.slice();
  const plannedTotal = scenes.reduce((sum, value) => sum + value, 0);
  scenes[scenes.length - 1] += Math.max(0, audioDuration - plannedTotal) + TAIL_SECONDS;
  const videoDuration = scenes.reduce((sum, value) => sum + value, 0);

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
      "-af",
      "apad",
      "-t",
      videoDuration.toFixed(3),
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

async function buildPoster({ frames, outFile }) {
  // Prefer a frame with the explorer card open - it makes a better thumbnail.
  const source = frames[Math.min(frames.length - 1, Math.max(0, frames.length - 3))];
  await run(config.ffmpegPath, ["-y", "-i", source, "-vf", "scale=1280:-2", "-q:v", "4", outFile]);
  return outFile;
}

module.exports = { buildSilentVideo, buildVideo, buildPoster };
