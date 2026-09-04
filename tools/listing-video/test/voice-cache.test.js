"use strict";

/*
 * Not paying ElevenLabs for the same forty seconds of script per realtor.
 *
 * Every AI-voice job used to send the whole script, so the shared lines were
 * billed again for every customer when only the greeting differs.
 *
 * Each line is now kept on disk under a key made of what was said and who said
 * it, so a second job on the same script and voice only pays for the lines that
 * carry the customer's name.
 *
 * Nothing here talks to ElevenLabs: fetch is stubbed and the calls are counted,
 * so these run without a key and spend nothing.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-voicecache-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "cache-test-token";
process.env.ELEVENLABS_API_KEY = "test-key-not-a-real-one";
// The offline voice must not be picked up and quietly used instead.
process.env.PIPER_BIN = "/nonexistent/piper";
process.env.PIPER_VOICE = "/nonexistent/voice.onnx";
delete process.env.OPENAI_API_KEY;

const config = require("../src/config");
const voiceCache = require("../src/voice-cache");
const voices = require("../src/voices");
const { buildAiVoiceTrack } = require("../src/audio");
const { run } = require("../src/exec");

const realFetch = global.fetch;

const JESSICA = "cgSgspJ2msm6clMCkdW9";
const GEORGE = "JBFqnCBsd6RMkjVDRZzb";
const PREMADE = [
  { voice_id: JESSICA, name: "Jessica", category: "premade", labels: { gender: "female" } },
  { voice_id: GEORGE, name: "George", category: "premade", labels: { gender: "male" } },
];

/** A second of real audio, so ffmpeg can read what the stub "spoke". */
let spokenMp3 = null;
async function anMp3() {
  if (spokenMp3) return spokenMp3;
  const file = path.join(dataDir, "spoken.mp3");
  await run(config.ffmpegPath, [
    "-y", "-f", "lavfi", "-i", "sine=frequency=320:duration=1.2",
    "-ac", "1", "-ar", "44100", "-b:a", "64k", file,
  ]);
  spokenMp3 = await fsp.readFile(file);
  return spokenMp3;
}

/** Stand in for ElevenLabs, recording every line it is asked to speak. */
async function stubElevenLabs() {
  const audio = await anMp3();
  const calls = { spoke: [], voices: [] };
  global.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith("/v1/voices")) {
      return new Response(JSON.stringify({ voices: PREMADE }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (target.includes("/v1/text-to-speech/")) {
      calls.voices.push(decodeURIComponent(target.split("/v1/text-to-speech/")[1].split("?")[0]));
      calls.spoke.push(JSON.parse(options.body).text);
      return new Response(audio, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    }
    return realFetch(url, options);
  };
  return calls;
}

/** The shape of a real script: a personal greeting, then lines everybody hears. */
function scriptFor(firstName, company) {
  return [
    { seconds: 8, text: `Hey ${firstName}, Claire from Dream Neighborhood. I was looking at ${company}.` },
    { seconds: 6, text: "Take a look at this one, as it is today." },
    { seconds: 6, text: "A mom opens it, and there's nothing here about schools. So she bounces." },
    { seconds: 6, text: "Here's the same page, with the Dream Neighborhood School Explorer." },
    { seconds: 6, text: "The School Explorer is free for life. No credit card required." },
  ];
}

async function buildFor(firstName, company, voiceId = JESSICA) {
  const workDir = await fsp.mkdtemp(path.join(dataDir, "job-"));
  const track = await buildAiVoiceTrack({
    beats: scriptFor(firstName, company),
    workDir,
    log: () => {},
    voiceId,
  });
  return track;
}

test.beforeEach(async () => {
  voices.reset();
  await voiceCache.clear();
});

test.after(async () => {
  global.fetch = realFetch;
  await fsp.rm(dataDir, { recursive: true, force: true });
});

test("the first job for a script speaks every line", async () => {
  const calls = await stubElevenLabs();
  await buildFor("Vanessa", "DOMO Realty");

  assert.equal(calls.spoke.length, 5, "nothing is cached yet, so all five are spoken");
  assert.ok(calls.spoke[0].includes("Vanessa"), "including the greeting");
});

/*
 * The whole point: a second realtor on the same script pays for the greeting and
 * nothing else.
 */
test("the second job on the same script and voice only pays for the greeting", async () => {
  const calls = await stubElevenLabs();

  await buildFor("Vanessa", "DOMO Realty");
  const afterFirst = calls.spoke.length;
  calls.spoke.length = 0;

  await buildFor("Melida", "Filpo Realty");

  assert.equal(afterFirst, 5);
  assert.equal(calls.spoke.length, 1, `spoke ${JSON.stringify(calls.spoke)}`);
  assert.match(calls.spoke[0], /Melida/, "and the one line it spoke is the personalised one");
  assert.match(calls.spoke[0], /Filpo Realty/);
});

test("a third and fourth job cost the same one line each", async () => {
  const calls = await stubElevenLabs();
  await buildFor("Vanessa", "DOMO Realty");
  calls.spoke.length = 0;

  await buildFor("Bill", "Red Wagon");
  await buildFor("Andy", "Andy Harris Real Estate");

  assert.equal(calls.spoke.length, 2, "one greeting each, no shared lines");
});

test("what a job billed is written down, so the saving is visible", async () => {
  await stubElevenLabs();
  const first = await buildFor("Vanessa", "DOMO Realty");
  const second = await buildFor("Melida", "Filpo Realty");

  assert.equal(first.voice.reusedLines, 0, "the first job had nothing to reuse");
  assert.equal(first.voice.billedCharacters, first.voice.scriptCharacters, "so it paid for the script");

  assert.equal(second.voice.reusedLines, 4, "the second reused the four shared lines");
  assert.ok(
    second.voice.billedCharacters < second.voice.scriptCharacters / 3,
    `billed ${second.voice.billedCharacters} of ${second.voice.scriptCharacters}`
  );
});

/* ---------------------------------------------------------------- */
/* what has to bust it                                              */
/* ---------------------------------------------------------------- */

test("changing the voice speaks the whole script again", async () => {
  const calls = await stubElevenLabs();
  await buildFor("Vanessa", "DOMO Realty", JESSICA);
  calls.spoke.length = 0;
  calls.voices.length = 0;

  await buildFor("Vanessa", "DOMO Realty", GEORGE);

  assert.equal(calls.spoke.length, 5, "a different voice cannot reuse the first one's lines");
  assert.ok(
    calls.voices.every((id) => id === GEORGE),
    `the whole track has to be one voice: ${JSON.stringify([...new Set(calls.voices)])}`
  );
});

test("editing a line on the Scripts page re-speaks that line and no others", async () => {
  const calls = await stubElevenLabs();
  await buildFor("Vanessa", "DOMO Realty");
  calls.spoke.length = 0;

  const edited = scriptFor("Vanessa", "DOMO Realty");
  edited[3].text = "Here's the same page, with the Dream Neighborhood School Explorer on it.";
  const workDir = await fsp.mkdtemp(path.join(dataDir, "edited-"));
  await buildAiVoiceTrack({ beats: edited, workDir, log: () => {}, voiceId: JESSICA });

  assert.equal(calls.spoke.length, 1, `spoke ${JSON.stringify(calls.spoke)}`);
  assert.match(calls.spoke[0], /School Explorer on it/);
});

test("tidying whitespace does not re-bill a line", async () => {
  const calls = await stubElevenLabs();
  await buildFor("Vanessa", "DOMO Realty");
  calls.spoke.length = 0;

  const respaced = scriptFor("Vanessa", "DOMO Realty");
  respaced[2].text = `  ${respaced[2].text.replace(/ /g, "  ")}  `;
  const workDir = await fsp.mkdtemp(path.join(dataDir, "spaced-"));
  await buildAiVoiceTrack({ beats: respaced, workDir, log: () => {}, voiceId: JESSICA });

  assert.equal(calls.spoke.length, 0, "the same words, however they were spaced");
});

test("a personal mention later in the script is billed, and the rest are not", async () => {
  const calls = await stubElevenLabs();
  const withLateMention = (firstName) => [
    { seconds: 8, text: `Hey ${firstName}, Claire from Dream Neighborhood.` },
    { seconds: 6, text: "Take a look at this one, as it is today." },
    { seconds: 6, text: `Give ${firstName} a call back on this one.` },
  ];

  let workDir = await fsp.mkdtemp(path.join(dataDir, "late-a-"));
  await buildAiVoiceTrack({ beats: withLateMention("Vanessa"), workDir, log: () => {}, voiceId: JESSICA });
  calls.spoke.length = 0;

  workDir = await fsp.mkdtemp(path.join(dataDir, "late-b-"));
  await buildAiVoiceTrack({ beats: withLateMention("Melida"), workDir, log: () => {}, voiceId: JESSICA });

  // Both lines with the name in are spoken; the shared one is not. No special
  // case was needed for the late mention - it simply does not match a kept line.
  assert.equal(calls.spoke.length, 2, JSON.stringify(calls.spoke));
  assert.ok(calls.spoke.every((line) => line.includes("Melida")));
});

/* ---------------------------------------------------------------- */
/* what it must never do                                            */
/* ---------------------------------------------------------------- */

test("a cached line is never spliced onto another engine's track", () => {
  // Only the engine that charges by the character is kept at all.
  assert.equal(voiceCache.canCache("elevenlabs"), true);
  assert.equal(voiceCache.canCache("openai"), false);
  assert.equal(voiceCache.canCache("piper"), false);

  // And the engine is part of the key, so the same words in the same voice under
  // a different engine cannot collide.
  const same = { voiceId: JESSICA, text: "Take a look at this one.", model: "m", settings: { a: 1 } };
  assert.notEqual(
    voiceCache.keyFor({ ...same, engine: "elevenlabs" }),
    voiceCache.keyFor({ ...same, engine: "openai" })
  );
});

test("the model and its settings are part of the key", () => {
  const same = { engine: "elevenlabs", voiceId: JESSICA, text: "Take a look at this one." };
  const base = voiceCache.keyFor({ ...same, model: "eleven_multilingual_v2", settings: { stability: 0.45 } });

  assert.notEqual(base, voiceCache.keyFor({ ...same, model: "eleven_turbo_v2", settings: { stability: 0.45 } }));
  assert.notEqual(base, voiceCache.keyFor({ ...same, model: "eleven_multilingual_v2", settings: { stability: 0.7 } }));
  assert.equal(base, voiceCache.keyFor({ ...same, model: "eleven_multilingual_v2", settings: { stability: 0.45 } }));
});

test("the kept lines are real audio, and the track still comes out right", async () => {
  await stubElevenLabs();
  const first = await buildFor("Vanessa", "DOMO Realty");
  const second = await buildFor("Melida", "Filpo Realty");

  // A track built mostly from kept lines is still a playable track of about the
  // length the script asked for - the padding is worked out per job, not cached.
  assert.ok(fs.existsSync(second.audioFile));
  assert.ok(second.totalDuration > 5, `only ${second.totalDuration}s`);
  assert.equal(second.durations.length, 5, "one scene length per beat, as before");
  assert.deepEqual(
    first.durations.map((d) => Math.round(d)),
    second.durations.map((d) => Math.round(d)),
    "the same script gives the same scene lengths whether or not it was cached"
  );
});

test("a job can be built when the cache directory cannot be written", async () => {
  const calls = await stubElevenLabs();
  await voiceCache.clear();
  // A read-only data dir must not stop a video being made; it just costs money.
  const dir = voiceCache.cacheDir();
  await fsp.mkdir(dir, { recursive: true });
  await fsp.chmod(dir, 0o500);
  try {
    const track = await buildFor("Vanessa", "DOMO Realty");
    assert.ok(track.audioFile, "the track is still built");
    assert.equal(calls.spoke.length, 5);
  } finally {
    await fsp.chmod(dir, 0o700);
  }
});
