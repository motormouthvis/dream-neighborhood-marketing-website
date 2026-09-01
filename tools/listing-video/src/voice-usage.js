"use strict";

/*
 * How much of the ElevenLabs allowance is left.
 *
 * So Bill can see an upgrade coming rather than finding out when a render fails
 * halfway through a script.
 *
 * Read server side only, and only ever reported as the handful of numbers below.
 * The key never leaves this file, and the subscription response is not passed on
 * as it arrives - it carries billing and payment fields that have no business in
 * a browser.
 *
 * A key can be allowed to speak but not to read usage. Ours is exactly that
 * today: text-to-speech works, and /v1/user/subscription answers 401
 * missing_permissions user_read. That is reported as what it is, with somewhere
 * to go and look by hand, rather than as a number we do not have.
 */

const config = require("./config");

const URL = "https://api.elevenlabs.io/v1/user/subscription";
const TIMEOUT_MS = 8000;
/* Usage does not move fast, and the form should not wait on a network call. */
const CACHE_MS = 5 * 60 * 1000;

/** Where to look by hand when the key cannot read usage. */
const USAGE_PAGE = "https://elevenlabs.io/app/usage";

/* Time to upgrade when either of these is true. */
const LOW_FRACTION = 0.2;
const LOW_CHARACTERS = 10000;

let cache = null;
let cacheAt = 0;

function niceTier(tier) {
  const said = String(tier || "").trim();
  if (!said) return "";
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** The plan's own reset date, as a day rather than a unix stamp. */
function resetDate(subscription) {
  const seconds =
    Number(subscription.next_character_count_reset_unix) ||
    Number(subscription.next_invoice_time_unix) ||
    0;
  if (!seconds) return "";
  const when = new Date(seconds * 1000);
  if (Number.isNaN(when.getTime())) return "";
  return when.toISOString().slice(0, 10);
}

/**
 * Does this 401 mean the key cannot read usage, as opposed to being wrong?
 *
 * A key that is simply invalid should not be reported as a permissions problem,
 * because the fix is a different one.
 */
function meansNoReadPermission(status, body) {
  if (status !== 401) return false;
  const said = JSON.stringify(body || "").toLowerCase();
  return said.includes("missing_permissions") || said.includes("user_read");
}

/**
 * The state of the allowance, in the few fields worth showing.
 *
 * Never throws, and never returns anything but these shapes:
 *
 *   { state: "off" }        no key on this server
 *   { state: "no-read" }    the key can speak but cannot read usage
 *   { state: "unreadable" } something else went wrong
 *   { state: "ok", ... }    real numbers
 */
async function readUsage({ fresh = false } = {}) {
  if (!config.elevenLabsKey) return { state: "off" };
  if (!fresh && cache && Date.now() - cacheAt < CACHE_MS) return cache;

  const answer = await ask();
  cache = answer;
  cacheAt = Date.now();
  return answer;
}

async function ask() {
  const stop = AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
  let response;
  try {
    // Header only. Never a query string, never a log line.
    response = await fetch(URL, { headers: { "xi-api-key": config.elevenLabsKey }, signal: stop });
  } catch (error) {
    return { state: "unreadable", why: "ElevenLabs could not be reached." };
  }

  let body = null;
  try {
    body = await response.json();
  } catch (_) {
    body = null;
  }

  if (meansNoReadPermission(response.status, body)) {
    return {
      state: "no-read",
      checkUrl: USAGE_PAGE,
      why: "This key can speak, but it is not allowed to read the account's usage.",
    };
  }
  if (!response.ok) {
    return { state: "unreadable", why: `ElevenLabs answered ${response.status}.`, checkUrl: USAGE_PAGE };
  }
  if (!body || typeof body !== "object") {
    return { state: "unreadable", why: "ElevenLabs sent something unreadable.", checkUrl: USAGE_PAGE };
  }

  const used = Number(body.character_count);
  const limit = Number(body.character_limit);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return { state: "unreadable", why: "The account did not report a character allowance.", checkUrl: USAGE_PAGE };
  }

  const remaining = Math.max(0, limit - used);
  const fraction = remaining / limit;

  /*
   * Deliberately a whitelist, not a copy with a few fields removed. The
   * subscription response carries billing dates, currency and invoice details,
   * and none of it should reach a browser because somebody added a field
   * upstream.
   */
  return {
    state: "ok",
    tier: niceTier(body.tier),
    status: String(body.status || "").trim(),
    used,
    limit,
    remaining,
    percentLeft: Math.round(fraction * 100),
    resetOn: resetDate(body),
    // Either test being true is worth saying out loud.
    upgradeSoon: fraction < LOW_FRACTION || remaining < LOW_CHARACTERS,
    checkUrl: USAGE_PAGE,
  };
}

/** For tests. */
function reset() {
  cache = null;
  cacheAt = 0;
}

module.exports = { readUsage, reset, USAGE_PAGE, LOW_FRACTION, LOW_CHARACTERS, meansNoReadPermission };
