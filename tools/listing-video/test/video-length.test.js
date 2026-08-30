"use strict";

/*
 * How long the finished video is.
 *
 * Bill's rule: the silent cut is the source of truth. If the silent cut is 60
 * seconds and the voice is 30, the finished video is still 60 seconds - the
 * picture holds and the audio ends. It is never cut down to the voice, and
 * nothing is padded on after the last word.
 *
 * The one thing that shortens it is a person on the final review pausing the
 * player and trimming the remainder.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-length-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "test-token";

const config = require("../src/config");
const { run } = require("../src/exec");
const {
  buildVideo,
  buildSilentVideo,
  trimVideoAt,
  MIN_TRIMMED_SECONDS,
  TAIL_AFTER_VOICE_SECONDS,
} = require("../src/video");
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
  if (!starts.length) return 0;

  const lastStart = starts[starts.length - 1];
  // Either the run was still going when the file ended, or ffmpeg closed it off
  // at the very end - which it does, and which means the same thing.
  const closedAtTheEnd = ends.length === starts.length && ends[ends.length - 1] >= total - 0.15;
  if (starts.length > ends.length || closedAtTheEnd) return total - lastStart;
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

/* ---------------------------------------------------------------- */
/* the silent cut decides the length                                */
/* ---------------------------------------------------------------- */

test("the silent preview is exactly the script's length", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "silent-"));
  const frames = await stills(dir, 3);
  const silent = await buildSilentVideo({
    frames,
    durations: [2, 3, 2.5],
    workDir: dir,
    outFile: path.join(dir, "silent.mp4"),
    log: () => {},
  });
  assert.ok(Math.abs(silent.duration - 7.5) < 0.3, `silent preview is ${silent.duration.toFixed(2)}s, wanted 7.5s`);
});

/*
 * The rule Bill corrected. The picture used to be cut back to the voice, so a
 * short take threw away most of the cut he had already approved.
 */
test("a voice shorter than the picture does not shorten the video", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "short-voice-"));
  const raw = await takeThatTrailsOff(dir, 3, 4);
  const track = await buildRecordedTrack({ uploadPath: raw, workDir: dir, log: () => {} });
  const frames = await stills(dir, 3);
  const durations = [4, 4, 4];
  const scriptLength = durations.reduce((sum, value) => sum + value, 0);

  assert.ok(track.totalDuration < 5, `the voice is ${track.totalDuration.toFixed(2)}s, so this is the short-voice case`);

  const video = await buildVideo({
    frames,
    durations,
    audioFile: track.audioFile,
    workDir: dir,
    outFile: path.join(dir, "video.mp4"),
    log: () => {},
  });

  assert.ok(
    Math.abs(video.duration - scriptLength) < 0.35,
    `video is ${video.duration.toFixed(2)}s but the silent cut is ${scriptLength}s`
  );
  // The picture holds and the audio has finished, which is silence on the end -
  // and that is correct here, not something to trim away.
  const gap = await trailingSilence(path.join(dir, "video.mp4"));
  assert.ok(gap > 5, `only ${gap.toFixed(2)}s of held picture after the voice; it was cut back to the voice`);
});

/*
 * The other rule: the picture runs on for five seconds after the last word.
 *
 * A take recorded against the silent video ends about where the script does, and
 * the video used to stop dead on the last word - no pause at all.
 */
test("a voice that reaches the end of the script gets five seconds after it", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "long-voice-"));
  const raw = await takeThatTrailsOff(dir, 6, 1);
  const track = await buildRecordedTrack({ uploadPath: raw, workDir: dir, log: () => {} });
  const frames = await stills(dir, 2);

  // Four seconds of script against about six and a half seconds of voice.
  const video = await buildVideo({
    frames,
    durations: [2, 2],
    audioFile: track.audioFile,
    workDir: dir,
    outFile: path.join(dir, "video.mp4"),
    log: () => {},
  });

  const wanted = track.totalDuration + TAIL_AFTER_VOICE_SECONDS;
  assert.ok(
    Math.abs(video.duration - wanted) < 0.35,
    `video is ${video.duration.toFixed(2)}s for a ${track.totalDuration.toFixed(2)}s voice; wanted ${wanted.toFixed(2)}s`
  );

  // Which is five seconds of picture with nothing on the sound track.
  const tail = await trailingSilence(path.join(dir, "video.mp4"));
  assert.ok(
    Math.abs(tail - TAIL_AFTER_VOICE_SECONDS) < 0.6,
    `${tail.toFixed(2)}s of picture after the last word, wanted ${TAIL_AFTER_VOICE_SECONDS}s`
  );
});

test("the tail is five seconds, not the old one second and not none", () => {
  assert.equal(TAIL_AFTER_VOICE_SECONDS, 5);
});

/*
 * Dead air on the end of a take is still cut off the audio - not to shorten the
 * picture, which it cannot, but so a take that was stopped late does not push the
 * video past the script. And nothing is added after the last word.
 */
test("room tone after the last word is not left to stretch the video", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "roomtone-"));
  const raw = await takeThatTrailsOff(dir, 3, 6);
  assert.ok((await probeDuration(raw)) > 8.5, "the take really does trail off");

  const track = await buildRecordedTrack({ uploadPath: raw, workDir: dir, log: () => {} });

  // 0.6s of lead so the first word is not clipped, then 3s of speech. No tail.
  assert.ok(track.totalDuration < 4.2, `voice track is ${track.totalDuration.toFixed(2)}s, so silence is still on it`);
  assert.ok(track.totalDuration > 3.2, `voice track is ${track.totalDuration.toFixed(2)}s, so the speech was cut into`);
  assert.ok((await trailingSilence(track.audioFile)) < 0.3, "nothing is padded on after the last word");

  /*
   * The video is the voice plus the five second tail. Had the room tone been
   * left on, the take would have been about 9.4s and the video about 14.4s -
   * six seconds of nothing on the end, on top of the tail.
   */
  const frames = await stills(dir, 2);
  const video = await buildVideo({
    frames,
    durations: [2, 2],
    audioFile: track.audioFile,
    workDir: dir,
    outFile: path.join(dir, "video.mp4"),
    log: () => {},
  });
  const wanted = track.totalDuration + TAIL_AFTER_VOICE_SECONDS;
  assert.ok(
    Math.abs(video.duration - wanted) < 0.35,
    `video is ${video.duration.toFixed(2)}s, wanted ${wanted.toFixed(2)}s`
  );
  assert.ok(video.duration < 11, `video is ${video.duration.toFixed(2)}s, so the room tone was left on`);
});

/* ---------------------------------------------------------------- */
/* the only thing that shortens it: a person                        */
/* ---------------------------------------------------------------- */

/** A finished video of a known length, to trim. */
async function aVideo(dir, durations) {
  const raw = await takeThatTrailsOff(dir, 2, 1);
  const track = await buildRecordedTrack({ uploadPath: raw, workDir: dir, log: () => {} });
  const frames = await stills(dir, durations.length);
  return buildVideo({
    frames,
    durations,
    audioFile: track.audioFile,
    workDir: dir,
    outFile: path.join(dir, "video.mp4"),
    log: () => {},
  });
}

test("trimming cuts everything after the playhead", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "trim-"));
  const video = await aVideo(dir, [4, 4, 4]);
  assert.ok(Math.abs(video.duration - 12) < 0.35, `video is ${video.duration.toFixed(2)}s, wanted 12s`);

  const trimmed = await trimVideoAt({
    inputFile: video.file,
    atSeconds: 7.5,
    outFile: path.join(dir, "trimmed.mp4"),
  });

  assert.ok(Math.abs(trimmed.duration - 7.5) < 0.35, `trimmed to ${trimmed.duration.toFixed(2)}s, wanted 7.5s`);
  assert.ok(Math.abs(trimmed.wasSeconds - 12) < 0.35, "it reports what it was before");
  // Cut where they paused it, not at the previous keyframe.
  assert.ok(trimmed.duration < 8, "a stream copy would have left the rest of the second scene");
});

test("a trim needs a sensible place to cut", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "trim-bad-"));
  const video = await aVideo(dir, [3, 3]);
  const out = path.join(dir, "nope.mp4");

  for (const at of [0, -4, Number.NaN, "banana", null, undefined]) {
    await assert.rejects(
      () => trimVideoAt({ inputFile: video.file, atSeconds: at, outFile: out }),
      /pause the video/i,
      `${JSON.stringify(at)} should not be a cut point`
    );
  }

  // Nothing shorter than a couple of seconds: that is not a video.
  await assert.rejects(
    () => trimVideoAt({ inputFile: video.file, atSeconds: MIN_TRIMMED_SECONDS - 0.5, outFile: out }),
    /at least/i
  );

  // And at or past the end there is nothing to remove.
  await assert.rejects(
    () => trimVideoAt({ inputFile: video.file, atSeconds: video.duration, outFile: out }),
    /already the end/i
  );
  await assert.rejects(
    () => trimVideoAt({ inputFile: video.file, atSeconds: video.duration + 5, outFile: out }),
    /already the end/i
  );

  assert.equal(fs.existsSync(out), false, "a refused trim writes nothing");
});

test("a trimmed video still plays, with picture and sound", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "trim-plays-"));
  const video = await aVideo(dir, [4, 4]);
  const trimmed = await trimVideoAt({
    inputFile: video.file,
    atSeconds: 5,
    outFile: path.join(dir, "trimmed.mp4"),
  });

  const { stdout } = await run(config.ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type",
    "-of",
    "csv=p=0",
    trimmed.file,
  ]);
  const streams = stdout.trim().split("\n").map((line) => line.trim());
  assert.ok(streams.includes("video"), "it still has a picture");
  assert.ok(streams.includes("audio"), "it still has a sound track");
});

/* ---------------------------------------------------------------- */
/* trimming through the tool, the way Bill does it                  */
/* ---------------------------------------------------------------- */

const store = require("../src/store");
const { trimFinishedVideo } = require("../src/render");

/** A job with a finished video on disk, ready for the final review. */
async function readyJob(durations) {
  const templates = require("../src/templates");
  await templates.ensureSeeded();
  const template = await templates.getTemplate("vanessa-se-only-v11");
  const input = {
    templateId: template.id,
    firstName: "Bill",
    company: "Trim Realty",
    websiteUrl: "https://example.test/",
    listingUrl: "",
    customerEmail: "fixture@example.test",
    fromId: "bill",
  };
  const job = await store.createJob({ input, template, beats: templates.renderBeats(template, input) });
  const dir = store.jobDir(job.id);
  await fsp.mkdir(dir, { recursive: true });

  const video = await aVideo(dir, durations);
  job.silent = { frames: [], posterFile: "", capturedPageUrl: "", capturedAddress: null, notes: [] };
  job.result = {
    videoFile: video.file,
    posterFile: "",
    durationSeconds: Math.round(video.duration),
    voice: { mode: "recorded", engine: "recorded", label: "Your recorded voice" },
    templateName: template.name,
    sceneCount: durations.length,
    notes: [],
  };
  job.status = "ready";
  await store.markReviewed(job, "played");
  return { job, was: video.duration };
}

test("trimming through the tool shortens the video and asks for another review", async () => {
  const { job, was } = await readyJob([4, 4, 4]);
  assert.equal(job.review.reviewed, true, "it was reviewed before the trim");

  await trimFinishedVideo(job, { atSeconds: 6 });

  const fresh = await store.getJob(job.id);
  assert.ok(Math.abs((await probeDuration(fresh.result.videoFile)) - 6) < 0.35);
  assert.equal(fresh.result.durationSeconds, 6);
  assert.equal(fresh.result.trimmed.atSeconds, 6);
  assert.ok(Math.abs(fresh.result.trimmed.wasSeconds - was) < 0.35, "it records what it was");

  // A different video to the one that was approved, so approval starts over.
  assert.equal(fresh.review.reviewed, false, "the review has to be done again");

  // Same file, so the watch link keeps working.
  assert.equal(fresh.result.videoFile, job.result.videoFile);
  assert.ok(fs.existsSync(fresh.result.videoFile));
  assert.equal(fs.existsSync(path.join(store.jobDir(job.id), "video-trimming.mp4")), false, "no leftovers");
});

test("a refused trim leaves the finished video alone", async () => {
  const { job, was } = await readyJob([3, 3]);

  await assert.rejects(() => trimFinishedVideo(job, { atSeconds: 0 }), /pause the video/i);
  await assert.rejects(() => trimFinishedVideo(job, { atSeconds: was + 10 }), /already the end/i);

  const fresh = await store.getJob(job.id);
  assert.ok(Math.abs((await probeDuration(fresh.result.videoFile)) - was) < 0.35, "still its original length");
  assert.equal(fresh.review.reviewed, true, "and still reviewed, because nothing changed");
});

test.after(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});
