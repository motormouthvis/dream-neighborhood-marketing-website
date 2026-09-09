"use strict";

/*
 * The pauses between the sections, which Bill said were too long.
 *
 * He watched an AI-voice video whose nine beats added up to 64 seconds and whose
 * speech added up to about forty. The missing twenty-odd seconds were on screen:
 * three seconds of nothing after the first line, two and a half after the fourth,
 * four and a half sitting on the last frame at the end. Nothing had failed - each
 * line had been laid into the window its beat asked for, and the leftover of that
 * window was silence.
 *
 * So on the AI path the picture now follows the voice: a line is spoken, the dead
 * air is cut off both ends of it, and the scene is that long plus one breath. The
 * script's own seconds decide nothing.
 *
 * The overdub path is deliberately untouched and is checked here too, because the
 * two rules live one `if` apart in render.js and the wrong one is easy to spread.
 * Somebody recording a take is watching the silent cut and reading along, so a
 * window that closes early takes their words with it.
 *
 * Nothing here talks to ElevenLabs. fetch is stubbed with tones of known length,
 * wrapped in the silence a hosted voice really does hand back, so these run
 * without a key and spend nothing.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-aitiming-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "ai-timing-token";
process.env.ELEVENLABS_API_KEY = "test-key-not-a-real-one";
// The offline voice must not be picked up and quietly used instead.
process.env.PIPER_BIN = "/nonexistent/piper";
process.env.PIPER_VOICE = "/nonexistent/voice.onnx";
delete process.env.OPENAI_API_KEY;

const config = require("../src/config");
const voices = require("../src/voices");
const voiceCache = require("../src/voice-cache");
const { run } = require("../src/exec");
const {
  buildAiVoiceTrack,
  buildRecordedTrack,
  probeDuration,
  AI_BREATH_SECONDS,
  AI_TAIL_SECONDS,
  LEAD_SILENCE_SECONDS,
} = require("../src/audio");
const { buildVideo } = require("../src/video");

const JESSICA = "cgSgspJ2msm6clMCkdW9";
const PREMADE = [{ voice_id: JESSICA, name: "Jessica", category: "premade", labels: { gender: "female" } }];

const realFetch = global.fetch;

/*
 * A script sized the way Bill's was: every beat allowed far more time than the
 * line in it takes to say. The `spoken` column is what the stubbed voice will
 * hand back for that line, and it is what each scene now has to come out at.
 */
const SCRIPT = [
  { seconds: 9, spoken: 4.2, text: "Hey Bill, Claire from Dream Neighborhood. I was looking at Red Wagon Realty." },
  { seconds: 7, spoken: 2.0, text: "Take a look at this listing, as it is today." },
  { seconds: 8, spoken: 5.4, text: "A mom opens it, and there is nothing here about the schools. So she bounces." },
  { seconds: 7, spoken: 1.6, text: "Here is the same page with the School Explorer on it." },
  { seconds: 9, spoken: 3.1, text: "The School Explorer is free for life, and there is no credit card." },
];

const SCRIPT_SECONDS = SCRIPT.reduce((sum, beat) => sum + beat.seconds, 0);
const SPEECH_SECONDS = SCRIPT.reduce((sum, beat) => sum + beat.spoken, 0);

/** What a hosted voice sends for a line: half a second of nothing, the words, more nothing. */
const VOICE_PADDING_SECONDS = 0.5;

const spokenMp3 = new Map();
async function anMp3(seconds) {
  if (spokenMp3.has(seconds)) return spokenMp3.get(seconds);
  const file = path.join(dataDir, `spoken-${seconds}.mp3`);
  await run(config.ffmpegPath, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=44100:cl=mono:d=${VOICE_PADDING_SECONDS}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=320:duration=${seconds}`,
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=44100:cl=mono:d=${VOICE_PADDING_SECONDS}`,
    "-filter_complex",
    "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
    "-map",
    "[out]",
    "-ac",
    "1",
    "-ar",
    "44100",
    "-b:a",
    "64k",
    file,
  ]);
  const bytes = await fsp.readFile(file);
  spokenMp3.set(seconds, bytes);
  return bytes;
}

/** Stand in for ElevenLabs, answering each line with a tone of that line's length. */
async function stubElevenLabs() {
  const lengths = new Map(SCRIPT.map((beat) => [beat.text, beat.spoken]));
  for (const beat of SCRIPT) await anMp3(beat.spoken);

  global.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith("/v1/voices")) {
      return new Response(JSON.stringify({ voices: PREMADE }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (target.includes("/v1/text-to-speech/")) {
      const asked = JSON.parse(options.body).text;
      const seconds = lengths.get(asked);
      assert.ok(seconds, `the stub was asked for a line it does not know: ${asked}`);
      return new Response(await anMp3(seconds), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    }
    return realFetch(url, options);
  };
}

async function buildTrack(beats = SCRIPT) {
  const workDir = await fsp.mkdtemp(path.join(dataDir, "job-"));
  const track = await buildAiVoiceTrack({
    beats: beats.map(({ seconds, text }) => ({ seconds, text })),
    workDir,
    log: () => {},
    voiceId: JESSICA,
  });
  return { track, workDir };
}

/** Every stretch of silence in a file, as { start, seconds }. */
async function silences(file, shortest = 0.15) {
  const { stderr } = await run(config.ffmpegPath, [
    "-i",
    file,
    "-af",
    `silencedetect=noise=-45dB:d=${shortest}`,
    "-f",
    "null",
    "-",
  ]);
  const total = await probeDuration(file);
  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])));
  const ends = [...stderr.matchAll(/silence_end:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((start, index) => {
    const end = index < ends.length ? ends[index] : total;
    return { start, seconds: end - start };
  });
}

/** How many seconds of nothing a file ends with. */
async function trailingSilence(file) {
  const total = await probeDuration(file);
  const runs = await silences(file, 0.2);
  if (!runs.length) return 0;
  const last = runs[runs.length - 1];
  return last.start + last.seconds >= total - 0.15 ? total - last.start : 0;
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

test.beforeEach(async () => {
  voices.reset();
  await voiceCache.clear();
  await stubElevenLabs();
});

test.after(async () => {
  global.fetch = realFetch;
  await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

/* ---------------------------------------------------------------- */
/* a scene is as long as the line said over it                      */
/* ---------------------------------------------------------------- */

test("each scene is the length of its spoken line, not the length the script guessed", async () => {
  const { track } = await buildTrack();

  assert.equal(track.durations.length, SCRIPT.length, "still one scene length per beat");

  SCRIPT.forEach((beat, index) => {
    const lead = index === 0 ? LEAD_SILENCE_SECONDS : 0;
    // The last scene is landed on the last word instead of on a breath, so it
    // gets the tail rather than the gap. Every other one is words plus a breath.
    const after = index === SCRIPT.length - 1 ? AI_TAIL_SECONDS : AI_BREATH_SECONDS;
    const wanted = lead + beat.spoken + after;
    assert.ok(
      Math.abs(track.durations[index] - wanted) < 0.35,
      `scene ${index + 1} is ${track.durations[index].toFixed(2)}s, wanted about ${wanted.toFixed(2)}s ` +
        `(the script said ${beat.seconds}s)`
    );
    assert.ok(
      track.durations[index] < beat.seconds - 1,
      `scene ${index + 1} is still sitting in its ${beat.seconds}s window`
    );
  });
});

/*
 * The silence a hosted voice sends around the words is cut off, so a gap is the
 * breath the track puts there on purpose and nothing else. This is the thing Bill
 * actually heard: on his video the gaps ran from one and a half to three seconds.
 */
test("there is one short breath between lines and nothing else", async () => {
  const { track } = await buildTrack();

  const runs = await silences(track.audioFile);
  const gaps = runs.filter((run) => run.start > 0.2);

  assert.equal(gaps.length, SCRIPT.length - 1, `expected a gap between each pair of lines, found ${gaps.length}`);
  for (const gap of gaps) {
    assert.ok(
      gap.seconds < 0.9,
      `a ${gap.seconds.toFixed(2)}s gap at ${gap.start.toFixed(2)}s - that is a pause, not a breath`
    );
  }

  // And the lead-in is still there, so the first word is not clipped.
  const lead = runs.find((run) => run.start <= 0.2);
  assert.ok(lead, "the lead-in silence has gone; the first word can be clipped");
  assert.ok(lead.seconds < 1.2, `the lead-in is ${lead.seconds.toFixed(2)}s`);
});

test("the whole track is the speech plus its breaths, not the script's length", async () => {
  const { track } = await buildTrack();

  const breaths = (SCRIPT.length - 1) * AI_BREATH_SECONDS;
  const wanted = LEAD_SILENCE_SECONDS + SPEECH_SECONDS + breaths;
  assert.ok(
    Math.abs(track.totalDuration - wanted) < 1.2,
    `the voice track is ${track.totalDuration.toFixed(2)}s, wanted about ${wanted.toFixed(2)}s`
  );
  assert.ok(
    track.totalDuration < SCRIPT_SECONDS - 10,
    `the track is ${track.totalDuration.toFixed(2)}s against a ${SCRIPT_SECONDS}s script, so padding is still in it`
  );
});

/* ---------------------------------------------------------------- */
/* and the finished video with it                                   */
/* ---------------------------------------------------------------- */

test("the finished video is the length of the voice, and does not end on a held still", async () => {
  const { track, workDir } = await buildTrack();
  const frames = await stills(workDir, SCRIPT.length);

  const video = await buildVideo({
    frames,
    durations: track.durations,
    audioFile: track.audioFile,
    workDir,
    outFile: path.join(workDir, "video.mp4"),
    log: () => {},
  });

  assert.ok(
    Math.abs(video.duration - (track.totalDuration + AI_TAIL_SECONDS)) < 0.5,
    `video is ${video.duration.toFixed(2)}s for a ${track.totalDuration.toFixed(2)}s voice`
  );
  assert.ok(
    video.duration < SCRIPT_SECONDS - 10,
    `video is ${video.duration.toFixed(2)}s against a ${SCRIPT_SECONDS}s script, so the padding survived`
  );

  // Bill's video sat on its last frame for four and a half seconds.
  const tail = await trailingSilence(path.join(workDir, "video.mp4"));
  assert.ok(tail < 0.9, `${tail.toFixed(2)}s of held still after the last word`);
});

test("the job's own numbers say the picture followed the voice", async () => {
  const { track } = await buildTrack();

  assert.equal(track.voice.mode, "ai");
  assert.equal(track.voice.followsSpeech, true, "the review step reads this to explain the shorter cut");
  assert.equal(track.voice.scriptSeconds, SCRIPT_SECONDS, "and what the script had asked for");
});

/* ---------------------------------------------------------------- */
/* what must not change: the overdub                                */
/* ---------------------------------------------------------------- */

/*
 * A person recording a take watches the silent cut and reads along, so the
 * picture they were timing against has to be the picture under their voice. The
 * AI rule must not leak across the `if` in render.js and start cutting their
 * scenes back to their words.
 */
test("a recorded take still keeps the script's own timing", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "overdub-"));
  const raw = path.join(dir, "take.wav");
  await run(config.ffmpegPath, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=320:duration=6",
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "pcm_s16le",
    raw,
  ]);

  const track = await buildRecordedTrack({ uploadPath: raw, workDir: dir, log: () => {} });
  assert.equal(track.voice.mode, "recorded");
  assert.equal(track.durations, undefined, "an overdub does not re-time the picture at all");

  const durations = [5, 5, 5];
  const frames = await stills(dir, durations.length);
  const video = await buildVideo({
    frames,
    durations,
    audioFile: track.audioFile,
    workDir: dir,
    outFile: path.join(dir, "video.mp4"),
    log: () => {},
  });

  assert.ok(
    Math.abs(video.duration - 15) < 0.35,
    `a 15s script with a ${track.totalDuration.toFixed(1)}s take came out ${video.duration.toFixed(2)}s`
  );
});

/* ---------------------------------------------------------------- */
/* the awkward ones                                                 */
/* ---------------------------------------------------------------- */

/*
 * The script's seconds are ignored, so a script whose beats are all the same
 * length still gets scenes that differ - they follow the words, which is the
 * whole point.
 */
test("beats of identical length still get scenes of their own", async () => {
  const flat = SCRIPT.map((beat) => ({ ...beat, seconds: 8 }));
  const { track } = await buildTrack(flat);

  const rounded = track.durations.map((value) => Math.round(value * 2) / 2);
  assert.ok(new Set(rounded).size > 2, `every scene came out the same: ${JSON.stringify(rounded)}`);
  // Longest line, longest scene.
  const longest = SCRIPT.reduce((best, beat, index) => (beat.spoken > SCRIPT[best].spoken ? index : best), 0);
  assert.equal(
    track.durations.indexOf(Math.max(...track.durations)),
    longest,
    "the longest scene is not the one with the longest line in it"
  );
});

/*
 * A line whose beat is *shorter* than the words was already stretched before
 * this change, and still is - the scene is the line, however long that is.
 */
test("a line longer than its beat gets the room it needs", async () => {
  const cramped = SCRIPT.map((beat) => ({ ...beat, seconds: 1 }));
  const { track } = await buildTrack(cramped);

  SCRIPT.forEach((beat, index) => {
    assert.ok(
      track.durations[index] > beat.spoken - 0.35,
      `scene ${index + 1} is ${track.durations[index].toFixed(2)}s for a ${beat.spoken}s line, so it is clipped`
    );
  });
});

/*
 * Reusing a kept line must not reuse its timing from some other job's script.
 * The lengths are measured off the files on this job, cached or not.
 */
test("a cached line is timed the same as a freshly spoken one", async () => {
  const first = (await buildTrack()).track;
  const second = (await buildTrack()).track;

  assert.ok(second.voice.reusedLines > 0, "the second job should have reused something");
  assert.deepEqual(
    first.durations.map((value) => Math.round(value * 10) / 10),
    second.durations.map((value) => Math.round(value * 10) / 10),
    "the same script gives the same scene lengths whether or not it was cached"
  );
});
