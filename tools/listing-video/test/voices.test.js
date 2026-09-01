"use strict";

/*
 * Picking a male or female ElevenLabs voice on the form.
 *
 * This is a free ElevenLabs plan, so only the premade/default voices work. A
 * Voice Library voice answers 401 and would fail at render time - after the
 * silent video has already been made - so the list is asked of the account
 * rather than written down, and a voice that is refused is dropped.
 *
 * Nothing here talks to ElevenLabs: fetch is stubbed, so the tests run without a
 * key and never spend anybody's credits.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-voices-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "voices-test-token";
// A key has to look present for any of this to be offered at all.
process.env.ELEVENLABS_API_KEY = "test-key-not-a-real-one";

const config = require("../src/config");
const voices = require("../src/voices");
const store = require("../src/store");
const templates = require("../src/templates");
const app = require("../server");

const TOOL = "/tools/listing-video";
const realFetch = global.fetch;

/** The premade voices a free account really returns, trimmed to what we read. */
const PREMADE = [
  { voice_id: "9BWtsMINqrJLrRacOk9x", name: "Aria", category: "premade", labels: { gender: "female" } },
  { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", category: "premade", labels: { gender: "female" } },
  { voice_id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", category: "premade", labels: { gender: "female" } },
  { voice_id: "JBFqnCBsd6RMkjVDRZzb", name: "George", category: "premade", labels: { gender: "male" } },
  { voice_id: "nPczCjzI2devNBz1zQrb", name: "Brian", category: "premade", labels: { gender: "male" } },
  { voice_id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", category: "premade", labels: { gender: "male" } },
  // A Voice Library voice: a paid plan only, so it must never be offered.
  { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "professional", labels: { gender: "female" } },
  { voice_id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", category: "cloned", labels: { gender: "female" } },
];

/** Answer the voices endpoint with whatever a test wants, and record the calls. */
function stubElevenLabs({ list = PREMADE, listStatus = 200 } = {}) {
  const calls = { list: 0, spoke: [], keySeen: [] };
  global.fetch = async (url, options) => {
    const target = String(url);
    const key = (options && options.headers && options.headers["xi-api-key"]) || "";
    if (target.endsWith("/v1/voices")) {
      calls.list += 1;
      calls.keySeen.push(key);
      if (listStatus !== 200) return new Response("nope", { status: listStatus });
      return new Response(JSON.stringify({ voices: list }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (target.includes("/v1/text-to-speech/")) {
      const spokenWith = decodeURIComponent(target.split("/v1/text-to-speech/")[1].split("?")[0]);
      calls.spoke.push(spokenWith);
      return new Response("not really an mp3", { status: 200 });
    }
    return realFetch(url, options);
  };
  return calls;
}

test.beforeEach(() => {
  voices.reset();
});

test.after(async () => {
  global.fetch = realFetch;
  await fsp.rm(dataDir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------- */
/* what gets offered                                                */
/* ---------------------------------------------------------------- */

test("two women and two men, by name, from the account's own list", async () => {
  const calls = stubElevenLabs();
  const offered = await voices.listVoices({ fresh: true });

  assert.equal(calls.list, 1, "the account is asked");
  assert.equal(offered.length, 4, JSON.stringify(offered));
  assert.equal(offered.filter((voice) => voice.sex === "female").length, 2);
  assert.equal(offered.filter((voice) => voice.sex === "male").length, 2);

  // Human names, not ids, because this is a label on a radio button.
  for (const voice of offered) {
    assert.match(voice.name, /^[A-Z][a-z]+$/, JSON.stringify(voice));
    assert.ok(voice.id && voice.id !== voice.name);
  }

  // Two distinct men.
  const men = offered.filter((voice) => voice.sex === "male");
  assert.notEqual(men[0].id, men[1].id);
  assert.notEqual(men[0].name, men[1].name);
});

test("Jessica is the default, because she is the one known to work", async () => {
  stubElevenLabs();
  const offered = await voices.listVoices({ fresh: true });
  assert.equal(offered[0].id, voices.PREFERRED_FEMALE_ID);
  assert.equal(offered[0].name, "Jessica");
  assert.equal(offered[0].sex, "female");
  // Nobody picking anything gets her.
  assert.equal(await voices.resolveVoiceId(""), voices.PREFERRED_FEMALE_ID);
});

test("a Voice Library voice is never offered on this plan", async () => {
  stubElevenLabs();
  const offered = await voices.listVoices({ fresh: true });
  const names = offered.map((voice) => voice.name);
  assert.ok(!names.includes("Rachel"), JSON.stringify(names));
  assert.ok(!names.includes("Charlotte"), JSON.stringify(names));
  // And asking for one by id does not get it either.
  assert.notEqual(await voices.resolveVoiceId("21m00Tcm4TlvDq8ikWAM"), "21m00Tcm4TlvDq8ikWAM");
});

test("the key goes in the header and nowhere else", async () => {
  const calls = stubElevenLabs();
  await voices.listVoices({ fresh: true });
  assert.equal(calls.keySeen[0], config.elevenLabsKey, "sent as a header");
  // Whatever is handed to the browser must not carry it.
  const offered = await voices.listVoices();
  assert.equal(JSON.stringify(offered).includes(config.elevenLabsKey), false);
});

test("an account that cannot be asked still offers something", async () => {
  stubElevenLabs({ listStatus: 500 });
  const offered = await voices.listVoices({ fresh: true });
  assert.equal(offered.length, 4, "falls back rather than showing an empty picker");
  assert.equal(offered[0].name, "Jessica");
  assert.equal(offered.filter((voice) => voice.sex === "male").length, 2);
});

test("a voice that comes back refused is dropped and the rest stay", async () => {
  stubElevenLabs();
  const before = await voices.listVoices({ fresh: true });
  const dropped = before.find((voice) => voice.sex === "male");

  voices.blockVoice(dropped.id);

  const after = await voices.listVoices({ fresh: true });
  assert.ok(!after.some((voice) => voice.id === dropped.id), "the refused voice is gone");
  assert.equal(after.filter((voice) => voice.sex === "male").length, 2, "and another man takes its place");
  assert.equal(after.filter((voice) => voice.sex === "female").length, 2, "the women are untouched");
  // Asking for it by id no longer gets it.
  assert.notEqual(await voices.resolveVoiceId(dropped.id), dropped.id);
});

test("401 and 402 mean no access; a wobble does not", () => {
  assert.equal(voices.statusMeansNoAccess(401), true);
  assert.equal(voices.statusMeansNoAccess(402), true);
  assert.equal(voices.statusMeansNoAccess(500), false);
  assert.equal(voices.statusMeansNoAccess(429), false);
});

/* ---------------------------------------------------------------- */
/* the choice reaching the job, and the voice it speaks with         */
/* ---------------------------------------------------------------- */

async function signedIn() {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const signin = await realFetch(`${origin}${TOOL}/api/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "voices-test-token" }),
  });
  const cookie = signin.headers.getSetCookie()[0].split(";")[0];
  return {
    get: (url) => realFetch(`${origin}${url}`, { headers: { cookie } }),
    post: (url, body) =>
      realFetch(`${origin}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** The form's payload, with whichever voice a test wants to pick. */
function formFor(voiceId) {
  return {
    templateId: "vanessa-se-only-v11",
    firstName: "Vanessa",
    company: "DOMO Realty",
    websiteUrl: "https://example.test/",
    listingUrl: "https://example.test/listings/123-main-st",
    customerEmail: "fixture@example.test",
    fromId: "bill",
    voiceId,
  };
}

test("the form is offered the voices, male and female", async () => {
  stubElevenLabs();
  const tool = await signedIn();
  try {
    const session = await (await tool.get(`${TOOL}/api/session`)).json();
    assert.equal(session.aiVoice.available, true);
    assert.equal(session.aiVoice.voices.length, 4);
    assert.equal(session.aiVoice.defaultVoiceId, voices.PREFERRED_FEMALE_ID);
    assert.ok(session.aiVoice.voices.some((voice) => voice.sex === "male"));
    assert.ok(session.aiVoice.voices.some((voice) => voice.sex === "female"));
    // The key never leaves the server.
    assert.equal(JSON.stringify(session).includes(config.elevenLabsKey), false);
  } finally {
    await tool.close();
  }
});

test("picking a male voice keeps a male voiceId on the job", async () => {
  stubElevenLabs();
  await templates.ensureSeeded();
  const offered = await voices.listVoices({ fresh: true });
  const man = offered.find((voice) => voice.sex === "male");

  const tool = await signedIn();
  try {
    const created = await (await tool.post(`${TOOL}/api/jobs`, formFor(man.id))).json();
    const job = await store.getJob(created.id);
    assert.equal(job.input.voiceId, man.id, `wanted ${man.name}'s id on the job`);
  } finally {
    await tool.close();
  }
});

test("picking a female voice keeps that one instead", async () => {
  stubElevenLabs();
  await templates.ensureSeeded();
  const offered = await voices.listVoices({ fresh: true });
  const women = offered.filter((voice) => voice.sex === "female");
  const notTheDefault = women[1];
  assert.notEqual(notTheDefault.id, voices.PREFERRED_FEMALE_ID, "pick the one that is not the default");

  const tool = await signedIn();
  try {
    const created = await (await tool.post(`${TOOL}/api/jobs`, formFor(notTheDefault.id))).json();
    const job = await store.getJob(created.id);
    assert.equal(job.input.voiceId, notTheDefault.id);
  } finally {
    await tool.close();
  }
});

test("a voice this plan cannot use is not booked onto a job", async () => {
  stubElevenLabs();
  await templates.ensureSeeded();
  const tool = await signedIn();
  try {
    // Rachel is a Voice Library voice, so the form should not have offered her.
    const created = await (await tool.post(`${TOOL}/api/jobs`, formFor("21m00Tcm4TlvDq8ikWAM"))).json();
    const job = await store.getJob(created.id);
    assert.notEqual(job.input.voiceId, "21m00Tcm4TlvDq8ikWAM");
    assert.equal(job.input.voiceId, voices.PREFERRED_FEMALE_ID, "it falls back to the default");
  } finally {
    await tool.close();
  }
});

test("the AI voice speaks with the voice the job was given", async () => {
  const calls = stubElevenLabs();
  const offered = await voices.listVoices({ fresh: true });
  const man = offered.find((voice) => voice.sex === "male");

  const { buildAiVoiceTrack } = require("../src/audio");
  const workDir = await fsp.mkdtemp(path.join(dataDir, "spoke-"));

  // The stub returns something that is not an mp3, so ffmpeg will refuse it -
  // which is fine, because what is being checked is the voice it asked for.
  await buildAiVoiceTrack({
    beats: [{ text: "Hey Vanessa, Claire from Dream Neighborhood.", seconds: 5 }],
    workDir,
    log: () => {},
    voiceId: man.id,
  }).catch(() => {});

  assert.ok(calls.spoke.length, "it tried to speak");
  assert.equal(calls.spoke[0], man.id, `spoke with ${calls.spoke[0]}, wanted ${man.name} (${man.id})`);
});

test("no voice asked for means Jessica does the talking", async () => {
  const calls = stubElevenLabs();
  const { buildAiVoiceTrack } = require("../src/audio");
  const workDir = await fsp.mkdtemp(path.join(dataDir, "default-"));

  await buildAiVoiceTrack({
    beats: [{ text: "Hey Vanessa.", seconds: 4 }],
    workDir,
    log: () => {},
  }).catch(() => {});

  assert.equal(calls.spoke[0], voices.PREFERRED_FEMALE_ID);
});

test("a voice that answers 401 while speaking is dropped from the picker", async () => {
  stubElevenLabs();
  const offered = await voices.listVoices({ fresh: true });
  const man = offered.find((voice) => voice.sex === "male");

  // This time the account refuses that voice when asked to speak.
  global.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith("/v1/voices")) {
      return new Response(JSON.stringify({ voices: PREMADE }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (target.includes(`/v1/text-to-speech/${man.id}`)) return new Response("no", { status: 401 });
    return realFetch(url, options);
  };

  const { buildAiVoiceTrack } = require("../src/audio");
  const workDir = await fsp.mkdtemp(path.join(dataDir, "refused-"));
  await buildAiVoiceTrack({
    beats: [{ text: "Hey Vanessa.", seconds: 4 }],
    workDir,
    log: () => {},
    voiceId: man.id,
  }).catch(() => {});

  assert.equal(voices.isBlocked(man.id), true, "the refusal is remembered");
  const after = await voices.listVoices({ fresh: true });
  assert.ok(!after.some((voice) => voice.id === man.id), "and it is off the picker");
  assert.ok(after.length >= 3, "the ones that work are still there");
});
