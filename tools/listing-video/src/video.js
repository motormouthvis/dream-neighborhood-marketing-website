"use strict";

const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");
const { run } = require("./exec");
const { probeDuration } = require("./audio");

const TAIL_SECONDS = 1.0;

/**
 * Stitch the still frames to the voice track as a 1920x1080 H.264 mp4.
 */
async function buildVideo({ frames, durations, audioFile, workDir, outFile, log }) {
  if (frames.length !== durations.length) {
    throw new Error("Internal error: frame count and scene count do not match.");
  }

  const audioDuration = await probeDuration(audioFile);
  const scenes = durations.slice();

  // Absorb rounding drift into the last scene so picture and voice land together.
  const plannedTotal = scenes.reduce((sum, value) => sum + value, 0);
  scenes[scenes.length - 1] += Math.max(0, audioDuration - plannedTotal) + TAIL_SECONDS;
  const videoDuration = scenes.reduce((sum, value) => sum + value, 0);

  const lines = [];
  frames.forEach((frame, index) => {
    lines.push(`file '${frame.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${scenes[index].toFixed(3)}`);
  });
  lines.push(`file '${frames[frames.length - 1].replace(/'/g, "'\\''")}'`);

  const listFile = path.join(workDir, "frames.txt");
  await fsp.writeFile(listFile, `${lines.join("\n")}\n`, "utf8");

  log("Rendering the video");
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
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      "-profile:v",
      "high",
      "-level",
      "4.0",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-ar",
      "44100",
      "-movflags",
      "+faststart",
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

module.exports = { buildVideo, buildPoster };
