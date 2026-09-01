"use strict";

/*
 * Which ElevenLabs voices this account can actually speak with.
 *
 * The list is asked for rather than assumed. This is a free plan, so only the
 * premade/default voices work - anything from the Voice Library answers 401 for
 * us, and hardcoding names would mean offering voices that fail at render time,
 * after the silent video has already been made.
 *
 * A short list on purpose: two male, two female. This is a picker on a form, not
 * a voice browser.
 *
 * Worth knowing: ElevenLabs' Default voices expire on 31 December 2026, and are
 * only available to accounts created before March 2026. When they go, this asks
 * the account what it has and offers that instead of breaking - which is the main
 * reason the list is fetched rather than written down here.
 */

const config = require("./config");

const WANTED_PER_SEX = 2;
const LIST_URL = "https://api.elevenlabs.io/v1/voices";
const LIST_TIMEOUT_MS = 8000;
/* Long enough that a form load is not a network call, short enough to notice a plan change. */
const CACHE_MS = 10 * 60 * 1000;

/*
 * The default female, and the one Bill has heard.
 *
 * Kept first among the women wherever it is available, so the voice that is known
 * to work is the one a job gets when nobody picks.
 */
const PREFERRED_FEMALE_ID = "cgSgspJ2msm6clMCkdW9";

/*
 * Only used when the account cannot be asked - no key, or the call fails.
 *
 * These are premade voices with confirmed IDs, so the picker still offers
 * something sensible rather than nothing. Anything here that turns out not to
 * work gets dropped the first time it answers 401 or 402.
 */
const FALLBACK = [
  { id: PREFERRED_FEMALE_ID, name: "Jessica", sex: "female" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", sex: "female" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", sex: "male" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", sex: "male" },
];

/* Voices this account has refused. Remembered so a dead voice is offered once, not every time. */
const blocked = new Set();
let cache = null;
let cacheAt = 0;

/** Mark a voice as one this account will not speak with. */
function blockVoice(voiceId, why) {
  if (!voiceId) return;
  blocked.add(String(voiceId));
  cache = null;
  return why;
}

function isBlocked(voiceId) {
  return blocked.has(String(voiceId));
}

/** A 401 or 402 means the plan cannot use that voice, so stop offering it. */
function statusMeansNoAccess(status) {
  return status === 401 || status === 402 || status === 403;
}

function sexOf(voice) {
  const said = String((voice.labels && voice.labels.gender) || "").toLowerCase();
  if (said.includes("female")) return "female";
  if (said.includes("male")) return "male";
  return "";
}

/*
 * A voice this plan can use.
 *
 * "premade" is what the API calls the default voices. A Voice Library voice comes
 * back as "professional" or "cloned" and needs a paid plan, so it is not offered
 * however good it sounds.
 */
function usableOnAFreePlan(voice) {
  const category = String(voice.category || "").toLowerCase();
  if (category && category !== "premade" && category !== "default") return false;
  const gate = voice.voice_verification || {};
  if (gate.requires_verification) return false;
  return true;
}

/** Ask the account what it has. Returns [] when it cannot be asked. */
async function fetchFromElevenLabs() {
  if (!config.elevenLabsKey) return [];

  const stop = AbortSignal.timeout ? AbortSignal.timeout(LIST_TIMEOUT_MS) : undefined;
  let response;
  try {
    // The key goes in the header and nowhere else - never a log line, never a
    // query string, and never back to the browser.
    response = await fetch(LIST_URL, { headers: { "xi-api-key": config.elevenLabsKey }, signal: stop });
  } catch (_) {
    return [];
  }
  if (!response.ok) return [];

  let body;
  try {
    body = await response.json();
  } catch (_) {
    return [];
  }

  return (Array.isArray(body.voices) ? body.voices : [])
    .filter((voice) => voice && voice.voice_id && usableOnAFreePlan(voice))
    .map((voice) => ({ id: String(voice.voice_id), name: String(voice.name || "").trim(), sex: sexOf(voice) }))
    .filter((voice) => voice.name && voice.sex);
}

/** Two of each, women first, with the known-good female at the front. */
function shortlist(all) {
  const pick = (sex) =>
    all
      .filter((voice) => voice.sex === sex && !isBlocked(voice.id))
      .sort((a, b) => {
        if (a.id === PREFERRED_FEMALE_ID) return -1;
        if (b.id === PREFERRED_FEMALE_ID) return 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, WANTED_PER_SEX);

  return pick("female").concat(pick("male"));
}

/**
 * The voices to offer, newest answer cached for a few minutes.
 *
 * Never throws: a picker that cannot be built is an empty list, and the AI voice
 * simply stays on whatever the server's default is.
 */
async function listVoices({ fresh = false } = {}) {
  if (!config.elevenLabsKey) return [];
  if (!fresh && cache && Date.now() - cacheAt < CACHE_MS) return cache;

  const fromAccount = await fetchFromElevenLabs();
  const chosen = shortlist(fromAccount.length ? fromAccount : FALLBACK);

  cache = chosen;
  cacheAt = Date.now();
  return chosen;
}

/** The voice a job should use: the one asked for, if we can still speak with it. */
async function resolveVoiceId(wanted) {
  const asked = String(wanted || "").trim();
  const offered = await listVoices();

  if (asked && !isBlocked(asked) && offered.some((voice) => voice.id === asked)) return asked;
  // An unknown or dead choice falls back to the first voice on offer, then to
  // whatever the server was configured with.
  const first = offered.length ? offered[0].id : "";
  return first || config.elevenLabsVoiceId;
}

/** What to call a voice in a log line or on a card. */
async function labelFor(voiceId) {
  const offered = await listVoices();
  const found = offered.find((voice) => voice.id === String(voiceId || ""));
  if (!found) return "ElevenLabs voice";
  return `${found.name} (${found.sex})`;
}

/** For tests: forget what has been fetched and what has been refused. */
function reset() {
  cache = null;
  cacheAt = 0;
  blocked.clear();
}

module.exports = {
  listVoices,
  resolveVoiceId,
  labelFor,
  blockVoice,
  isBlocked,
  statusMeansNoAccess,
  reset,
  PREFERRED_FEMALE_ID,
  FALLBACK,
  WANTED_PER_SEX,
};
