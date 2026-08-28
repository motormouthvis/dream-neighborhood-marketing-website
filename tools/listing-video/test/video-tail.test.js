"use strict";

/*
 * Bill: "Can we crop the video at the end please."
 *
 * Videos used to run on after the last spoken line - a hardcoded one second of
 * held picture, on top of whatever silence the voice track already ended with.
 * A school-only video sat on the School Explorer card for two or three seconds
 * after "Give us a call".
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-tail-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "test-token";

const config = require("../src/config");
const { run } = require("../src/exec");
const { buildVideo, buildSilentVideo } = require("../src/video");
const { buildRecordedTrack, probeDuration } = require("../src/audio");

/** How many seconds of silence a file ends with. */
async function trailingSilence(file) {
  const { stderr } = await run(config.ffmpegPath, [
    "-i",
    file,
    "-af",
    "silencedetect=noise=-45dB:d=0.2",
    "-f",
    "null",
    "-",
  ]);
  const total = await probeDuration(file);
  const starts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  // A run of silence still going when the file ends.
  if (starts.length > ends.length) return total - starts[starts.length - 1];
  return 0;
}

/** Speech, then a long stretch of nothing: a take where recording kept going. */
async function takeThatTrailsOff(dir, speechSeconds, silenceSeconds) {
  const file = path.join(dir, "raw.wav");
  await run(config.ffmpegPath, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=320:duration=${speechSeconds}`,
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=44100:cl=mono:d=${silenceSeconds}`,
    "-filter_complex",
    "[0:a][1:a]concat=n=2:v=0:a=1[out]",
    "-map",
    "[out]",
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "pcm_s16le",
    file,
  ]);
  return file;
}

async function stills(dir, count) {
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const frame = path.join(dir, `frame-${i}.jpg`);
    await run(config.ffmpegPath, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x${i}0${i}0${i}0:s=1920x1080`,
      "-frames:v",
      "1",
      frame,
    ]);
    frames.push(frame);
  }
  return frames;
}

test("a take that trails off is cut back to the last word", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "trim-"));
  const raw = await takeThatTrailsOff(dir, 3, 4);
  assert.ok((await probeDuration(raw)) > 6.5, "the take really does trail off");

  const track = await buildRecordedTrack({ uploadPath: raw, workDir: dir, log: () => {} });

  // 0.6s of lead so the first word is not clipped, 3s of speech, a breath.
  assert.ok(track.totalDuration < 4.6, `voice track is ${track.totalDuration.toFixed(2)}s, so silence is still on it`);
  assert.ok(track.totalDuration > 3.4, `voice track is ${track.totalDuration.toFixed(2)}s, so the speech was cut into`);
  assert.ok((await trailingSilence(track.audioFile)) < 0.6);
});

test("the video ends with the voice, not with the planned scenes", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "short-"));
  const raw = await takeThatTrailsOff(dir, 3, 4);
  const track = await buildRecordedTrack({ uploadPath: raw, workDir: dir, log: () => {} });
  const frames = await stills(dir, 3);

  // Nine seconds of picture planned, about four seconds of voice.
  const video = await buildVideo({
    frames,
    durations: [3, 3, 3],
    audioFile: track.audioFile,
    workDir: dir,
    outFile: path.join(dir, "video.mp4"),
    log: () => {},
  });

  assert.ok(
    Math.abs(video.duration - track.totalDuration) < 0.35,
    `video is ${video.duration.toFixed(2)}s for a ${track.totalDuration.toFixed(2)}s voice track`
  );
  assert.ok(video.duration < 5, `video ran on to ${video.duration.toFixed(2)}s of the 9s of planned picture`);
  const gap = await trailingSilence(path.join(dir, "video.mp4"));
  assert.ok(gap < 0.6, `${gap.toFixed(2)}s of silence after the last word`);
});

test("a voice longer than the planned scenes still gets a picture all the way", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "long-"));
  const raw = await takeThatTrailsOff(dir, 6, 1);
  const track = await buildRecordedTrack({ uploadPath: raw, workDir: dir, log: () => {} });
  const frames = await stills(dir, 2);

  // Four seconds of planned picture, about seven seconds of voice: the last
  // scene has to be held rather than the video ending early.
  const video = await buildVideo({
    frames,
    durations: [2, 2],
    audioFile: track.audioFile,
    workDir: dir,
    outFile: path.join(dir, "video.mp4"),
    log: () => {},
  });

  assert.ok(video.duration > 6, `video is only ${video.duration.toFixed(2)}s for a ${track.totalDuration.toFixed(2)}s voice`);
  assert.ok(Math.abs(video.duration - track.totalDuration) < 0.35);
});

test("the silent preview keeps the script's own length", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "silent-"));
  const frames = await stills(dir, 3);
  const silent = await buildSilentVideo({
    frames,
    durations: [2, 3, 2.5],
    workDir: dir,
    outFile: path.join(dir, "silent.mp4"),
    log: () => {},
  });
  // Nothing is trimmed here: this is what the voice is recorded against.
  assert.ok(Math.abs(silent.duration - 7.5) < 0.3, `silent preview is ${silent.duration.toFixed(2)}s, wanted 7.5s`);
});

test.after(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});
