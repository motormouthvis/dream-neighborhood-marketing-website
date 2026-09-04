"use strict";

/*
 * The shared lines, spoken once and kept.
 *
 * Every AI-voice job used to send the whole script to ElevenLabs, so the same
 * forty seconds of "here's the same page, with the Dream Neighborhood School
 * Explorer..." was paid for again for every realtor. Only the greeting actually
 * differs between customers.
 *
 * So each line is kept on disk under a key made of what was said and who said
 * it. A line whose words are the same as last time is read back off the disk and
 * costs nothing; only the lines carrying the customer's name and company are
 * billed.
 *
 * Cached per LINE rather than as one run-together bed, which matters for three
 * reasons: each line is still padded to its own scene length, so the picture
 * timing is untouched; a script that mentions the customer again halfway down
 * simply misses the cache for that line instead of needing a special case; and
 * editing one line on the Scripts page only re-bills that line.
 *
 * The key carries the engine, the voice and the model settings, so a cached
 * ElevenLabs line can never be spliced onto a Piper or OpenAI track, and
 * changing the voice or the words starts again.
 *
 * On Heroku this lives on the dyno's disk and goes when the dyno restarts, so it
 * saves within a working session rather than for ever. Nothing depends on it
 * surviving: a miss is just the line being spoken again.
 */

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");

/* Only the engine that charges by the character is worth keeping. */
const CACHED_ENGINES = new Set(["elevenlabs"]);

/* Enough for a good few scripts across voices; oldest go first beyond it. */
const MAX_LINES_KEPT = 400;

function cacheDir() {
  return path.join(config.dataDir, "voice-cache");
}

/**
 * What makes one spoken line different from another.
 *
 * Anything that would change the audio has to be in here, or a stale line gets
 * read back: the words, the voice, the engine, and the model settings.
 */
function keyFor({ engine, voiceId, text, model, settings }) {
  const identity = JSON.stringify({
    engine: String(engine || ""),
    voiceId: String(voiceId || ""),
    model: String(model || ""),
    settings: settings || null,
    // Whitespace-only edits on the Scripts page should not re-bill a line.
    text: String(text || "").replace(/\s+/g, " ").trim(),
  });
  return crypto.createHash("sha256").update(identity).digest("hex").slice(0, 40);
}

function canCache(engine) {
  return CACHED_ENGINES.has(String(engine || ""));
}

function fileFor(key) {
  return path.join(cacheDir(), `${key}.wav`);
}

/** The line if it has been said before, or "" if it has not. */
function find(key) {
  const file = fileFor(key);
  try {
    if (fs.statSync(file).size > 1000) return file;
  } catch (_) {
    /* not there, which is the normal case the first time */
  }
  return "";
}

/**
 * Keep a line that was just spoken.
 *
 * Written beside and renamed into place, so two jobs building the same line at
 * once cannot leave a half-written file for the next one to read back.
 */
async function keep(key, wavFile) {
  await fsp.mkdir(cacheDir(), { recursive: true });
  const target = fileFor(key);
  const pending = `${target}.${process.pid}.part`;
  try {
    await fsp.copyFile(wavFile, pending);
    await fsp.rename(pending, target);
  } catch (_) {
    await fsp.rm(pending, { force: true }).catch(() => {});
    return "";
  }
  prune().catch(() => {});
  return target;
}

/** Keep the cache from growing for ever. Oldest read goes first. */
async function prune() {
  let names;
  try {
    names = await fsp.readdir(cacheDir());
  } catch (_) {
    return;
  }
  const lines = names.filter((name) => name.endsWith(".wav"));
  if (lines.length <= MAX_LINES_KEPT) return;

  const withTimes = [];
  for (const name of lines) {
    try {
      const stat = await fsp.stat(path.join(cacheDir(), name));
      withTimes.push({ name, at: stat.atimeMs || stat.mtimeMs });
    } catch (_) {
      /* gone between reading the directory and asking about it */
    }
  }
  withTimes.sort((a, b) => a.at - b.at);
  for (const entry of withTimes.slice(0, withTimes.length - MAX_LINES_KEPT)) {
    await fsp.rm(path.join(cacheDir(), entry.name), { force: true }).catch(() => {});
  }
}

/** What a line costs to say, for the log. */
function charactersIn(text) {
  return String(text || "").length;
}

/** For tests, and for a support answer to "make it say it again". */
async function clear() {
  await fsp.rm(cacheDir(), { recursive: true, force: true }).catch(() => {});
}

async function count() {
  try {
    return (await fsp.readdir(cacheDir())).filter((name) => name.endsWith(".wav")).length;
  } catch (_) {
    return 0;
  }
}

module.exports = { keyFor, canCache, find, keep, clear, count, cacheDir, charactersIn, MAX_LINES_KEPT };
