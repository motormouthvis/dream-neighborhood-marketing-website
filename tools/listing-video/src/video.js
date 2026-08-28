"use strict";

const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");
const { run } = require("./exec");
const { probeDuration } = require("./audio");

/*
 * There is no tail.
 *
 * The picture used to be held for a second after the audio finished, on top of
 * whatever silence the voice track already ended with, so a school-only video
 * sat on the School Explorer card for two or three seconds after "Give us a
 * call". The voice track is now cut back to the last word plus a breath (see
 * src/audio.js) and the video ends exactly with it.
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
 * The finished video is exactly as long as the voice track. If the voice runs
 * past the planned scenes the last one is held to cover it; if it finishes
 * early, the video stops there rather than sitting in silence.
 */
async function buildVideo({ frames, durations, audioFile, workDir, outFile, log }) {
  if (frames.length !== durations.length) {
    throw new Error("Internal error: frame count and beat count do not match.");
  }

  const audioDuration = await probeDuration(audioFile);
  const scenes = durations.slice();
  const plannedTotal = scenes.reduce((sum, value) => sum + value, 0);
  // Only ever extended, never padded past the audio: the -t below is what ends
  // the video, and it ends on the last word.
  scenes[scenes.length - 1] += Math.max(0, audioDuration - plannedTotal);
  const videoDuration = audioDuration;

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
      // No apad: the audio is already the length of the video, and padding it
      // would put the trailing silence straight back.
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
