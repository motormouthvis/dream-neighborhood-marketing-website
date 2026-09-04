"use strict";

/**
 * Script templates, stored as plain JSON on disk under the data dir so Bill and
 * Myles can create, edit and keep their own scripts from the Scripts page
 * without anyone touching this repo.
 *
 * One file per template: <dataDir>/templates/<id>.json
 *
 * A template is:
 *   id         slug, also the file name
 *   name       what shows in the picker
 *   explorers  "se"    - School Explorer only, no Neighborhood Explorer at all
 *              "se-ne" - School Explorer first, then the Neighborhood Explorer tabs
 *   listingExplorer
 *              "absent"         - film a listing that does NOT have an Explorer
 *                                 on it yet. This is the "before" shot.
 *              "prefer-present" - film a listing that ALREADY has School
 *                                 Explorer, for an upgrade pitch. A listing
 *                                 without one is accepted as a fallback.
 *   notes      free text for whoever edits it next
 *   beats[]    ordered list of { scene, seconds, text, caption, tab }
 *
 * The shipped templates are seeded from src/default-templates.js and can be
 * edited, duplicated or deleted from there like any other template.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");
const { NE_TABS, canonicalTabName } = require("./demo-data");
const { DEFAULT_TEMPLATES, DEFAULT_TEMPLATE_IDS } = require("./default-templates");

const SCENES = ["listing", "listing-tap", "se", "ne"];
const SCENE_LABELS = {
  listing: "Their listing page",
  "listing-tap": "Their listing page, tapping the house",
  se: "School Explorer card",
  ne: "Neighborhood Explorer card",
};
const EXPLORER_MODES = ["se", "se-ne"];
const EXPLORER_MODE_LABELS = {
  se: "School Explorer only",
  "se-ne": "School Explorer, then Neighborhood Explorer",
};

const LISTING_EXPLORER_MODES = ["absent", "prefer-present"];
const LISTING_EXPLORER_LABELS = {
  absent: "A listing with no Explorer on it yet (the before shot)",
  "prefer-present": "A listing that already has School Explorer (an upgrade pitch)",
};

const MIN_BEAT_SECONDS = 0.5;
const MAX_BEAT_SECONDS = 120;
const MAX_TOTAL_SECONDS = 900;
const SEED_MARKER = ".seeded.json";

function dir() {
  return path.join(config.dataDir, "templates");
}

function fileFor(id) {
  return path.join(dir(), `${id}.json`);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function notFound(id) {
  const error = new Error(`There is no script template called "${id}".`);
  error.status = 404;
  return error;
}

/* ---------------------------------------------------------------- */
/* validation - every message here is read by Bill or Myles          */
/* ---------------------------------------------------------------- */

function cleanCaption(raw) {
  const caption = raw && typeof raw === "object" ? raw : {};
  const headline = String(caption.headline == null ? "" : caption.headline).trim().slice(0, 120);
  const subline = String(caption.subline == null ? "" : caption.subline).trim().slice(0, 160);
  return headline || subline ? { headline, subline } : null;
}

/** "Housing and Market Trends" and "Housing & Market Trends" are the same tab. */
function sameTabName(a, b) {
  const flatten = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z]/g, "");
  return flatten(a) === flatten(b);
}

/**
 * Which Neighborhood Explorer tab a beat shows.
 *
 * Stored as the tab's name, so a script file read by a person says
 * "Housing & Market Trends" rather than 3. Left empty, tabs are handed out in
 * the order the beats appear, which is what the v11 script relies on.
 */
function cleanTab(raw, scene, where) {
  if (scene !== "ne") return null;
  const wanted = raw == null ? "" : String(raw).trim();
  if (!wanted) return null;

  if (/^\d+$/.test(wanted)) {
    const index = Number(wanted);
    if (index < 0 || index >= NE_TABS.length) {
      throw badRequest(`${where} asks for tab ${index}, but there are only ${NE_TABS.length}.`);
    }
    return NE_TABS[index];
  }

  // canonicalTabName also answers to what a chip used to be called, so a script
  // saved when Mobility and Points of Interest had those names keeps working.
  const canonical = canonicalTabName(wanted);
  const match = NE_TABS.find((tab) => sameTabName(tab, canonical));
  if (!match) {
    throw badRequest(`${where} names a Neighborhood Explorer tab that does not exist: "${wanted}". The tabs are: ${NE_TABS.join(", ")}.`);
  }
  return match;
}

function cleanBeat(raw, position) {
  const where = `Beat ${position + 1}`;
  if (!raw || typeof raw !== "object") throw badRequest(`${where} is empty.`);

  const text = String(raw.text == null ? "" : raw.text).replace(/\s+/g, " ").trim();
  if (!text) throw badRequest(`${where} needs some spoken words.`);
  if (text.length > 900) throw badRequest(`${where} is too long. Split it into two beats.`);

  const scene = String(raw.scene || "").trim();
  if (!SCENES.includes(scene)) {
    throw badRequest(`${where} has an unknown scene. Use one of: ${SCENES.join(", ")}.`);
  }

  const seconds = Number(raw.seconds);
  if (!Number.isFinite(seconds) || seconds < MIN_BEAT_SECONDS || seconds > MAX_BEAT_SECONDS) {
    throw badRequest(`${where} needs a suggested duration between ${MIN_BEAT_SECONDS} and ${MAX_BEAT_SECONDS} seconds.`);
  }

  return {
    scene,
    seconds: Math.round(seconds * 10) / 10,
    text,
    caption: cleanCaption(raw.caption),
    tab: cleanTab(raw.tab, scene, where),
  };
}

function cleanTemplate(raw, { id } = {}) {
  if (!raw || typeof raw !== "object") throw badRequest("That script template is empty.");

  const name = String(raw.name || "").trim().slice(0, 90);
  if (!name) throw badRequest("Give the template a name.");

  const explorers = String(raw.explorers || "").trim();
  if (!EXPLORER_MODES.includes(explorers)) {
    throw badRequest('Choose "School Explorer only" or "School Explorer, then Neighborhood Explorer".');
  }

  // Older script files predate this setting, and they were all before-shots.
  const listingExplorer = String(raw.listingExplorer || "absent").trim();
  if (!LISTING_EXPLORER_MODES.includes(listingExplorer)) {
    throw badRequest("Choose what their listing should already have on it.");
  }

  const rawBeats = Array.isArray(raw.beats) ? raw.beats : [];
  if (rawBeats.length === 0) throw badRequest("A template needs at least one beat.");
  if (rawBeats.length > 80) throw badRequest("That is too many beats for one video.");
  const beats = rawBeats.map(cleanBeat);

  const total = beats.reduce((sum, beat) => sum + beat.seconds, 0);
  if (total > MAX_TOTAL_SECONDS) {
    throw badRequest(`Those durations add up to ${Math.round(total)}s. Keep a video under ${MAX_TOTAL_SECONDS / 60} minutes.`);
  }

  if (explorers === "se" && beats.some((beat) => beat.scene === "ne")) {
    throw badRequest(
      'This template is set to "School Explorer only", so it cannot contain a Neighborhood Explorer beat. Switch it to "School Explorer, then Neighborhood Explorer" or change that beat.'
    );
  }

  // School Explorer is always the first explorer the customer sees.
  const firstSe = beats.findIndex((beat) => beat.scene === "se");
  const firstNe = beats.findIndex((beat) => beat.scene === "ne");
  if (firstNe !== -1 && (firstSe === -1 || firstNe < firstSe)) {
    throw badRequest("School Explorer has to be shown before any Neighborhood Explorer beat.");
  }

  const finalId = slugify(id || raw.id || name);
  if (!finalId) throw badRequest("That name has no letters or numbers in it, so it cannot be saved.");

  return {
    id: finalId,
    name,
    explorers,
    listingExplorer,
    notes: String(raw.notes || "").trim().slice(0, 600),
    beats,
    builtIn: Boolean(raw.builtIn),
  };
}

/* ---------------------------------------------------------------- */
/* disk                                                             */
/* ---------------------------------------------------------------- */

function ensureDir() {
  fs.mkdirSync(dir(), { recursive: true });
}

async function writeTemplate(template) {
  ensureDir();
  await fsp.writeFile(fileFor(template.id), `${JSON.stringify(template, null, 2)}\n`, "utf8");
  return template;
}

/*
 * The two chips the product renamed, and how a script should now read.
 *
 * The chip is written with an ampersand because that is what the product shows
 * and what gets clicked; the spoken line says "and", because that is how anybody
 * reads it aloud.
 */
const RENAMED_TABS = [
  { was: "Mobility", chip: "Walk & Bike", spoken: "Walk and Bike" },
  { was: "Points of Interest", chip: "What's Nearby", spoken: "What's Nearby" },
];

/**
 * Bring a script saved before the chips were renamed up to date.
 *
 * Seeding never overwrites a saved script, so a staging data dir still holds the
 * scripts as they were first written - naming Mobility and Points of Interest in
 * their tab pins, their spoken lines and their captions. The pins would still
 * find the right chip, but the voice would name a chip that is no longer there.
 *
 * Only the two old names are touched, and only where they still appear, so any
 * rewording already done by hand is left exactly as it is.
 */
function renameTabsIn(template) {
  let touched = 0;
  const beats = (template.beats || []).map((beat) => {
    const next = { ...beat };
    for (const { was, chip, spoken } of RENAMED_TABS) {
      const whole = new RegExp(`\\b${was.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      if (next.tab === was) {
        next.tab = chip;
        touched += 1;
      }
      if (typeof next.text === "string" && whole.test(next.text)) {
        next.text = next.text.replace(whole, spoken);
        touched += 1;
      }
      if (next.caption) {
        const caption = { ...next.caption };
        for (const part of ["headline", "subline"]) {
          if (typeof caption[part] === "string" && whole.test(caption[part])) {
            caption[part] = caption[part].replace(whole, chip);
            touched += 1;
          }
        }
        next.caption = caption;
      }
    }
    return next;
  });
  return touched ? { ...template, beats } : null;
}

/**
 * Put the shipped templates on disk.
 *
 * The marker records which ones have been offered before, one id at a time
 * rather than a single "seeded" flag. So a data dir that already has the two
 * v11 scripts picks up a newly shipped third one on the next boot, while a
 * default that somebody deleted stays deleted.
 */
async function ensureSeeded() {
  ensureDir();
  const marker = path.join(dir(), SEED_MARKER);

  let offered = [];
  try {
    const parsed = JSON.parse(await fsp.readFile(marker, "utf8"));
    if (Array.isArray(parsed.ids)) offered = parsed.ids.map(String);
  } catch (_) {
    offered = [];
  }

  const seeded = [];
  for (const template of DEFAULT_TEMPLATES) {
    if (offered.includes(template.id)) continue;
    if (!fs.existsSync(fileFor(template.id))) {
      await writeTemplate(stamp(cleanTemplate({ ...template, builtIn: true }, { id: template.id })));
      seeded.push(template.id);
    }
    offered.push(template.id);
  }

  await renameTabsOnDisk();

  const missing = DEFAULT_TEMPLATE_IDS.some((id) => !offered.includes(id));
  if (seeded.length || missing || !fs.existsSync(marker)) {
    await fsp.writeFile(
      marker,
      `${JSON.stringify({ seededAt: new Date().toISOString(), ids: offered }, null, 2)}\n`,
      "utf8"
    );
  }
  return seeded;
}

/** Apply the chip rename to every script already on disk. Returns the ids changed. */
async function renameTabsOnDisk() {
  let names = [];
  try {
    names = await fsp.readdir(dir());
  } catch (_) {
    return [];
  }
  const changed = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name === SEED_MARKER) continue;
    const id = name.replace(/\.json$/, "");
    let saved;
    try {
      saved = JSON.parse(await fsp.readFile(fileFor(id), "utf8"));
    } catch (_) {
      continue;
    }
    const renamed = renameTabsIn(saved);
    if (!renamed) continue;
    await writeTemplate(renamed);
    changed.push(id);
  }
  return changed;
}

/** Put the shipped templates back, exactly as they ship. */
async function restoreDefaults() {
  ensureDir();
  const restored = [];
  for (const template of DEFAULT_TEMPLATES) {
    await writeTemplate(stamp(cleanTemplate({ ...template, builtIn: true }, { id: template.id })));
    restored.push(template.id);
  }
  return restored;
}

function stamp(template, previous) {
  const now = new Date().toISOString();
  return {
    ...template,
    createdAt: (previous && previous.createdAt) || now,
    updatedAt: now,
  };
}

async function listTemplates() {
  await ensureSeeded();
  let names = [];
  try {
    names = await fsp.readdir(dir());
  } catch (_) {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name === SEED_MARKER) continue;
    const loaded = await readTemplate(name.replace(/\.json$/, ""));
    if (loaded) out.push(loaded);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function readTemplate(id) {
  if (!/^[a-z0-9-]{1,60}$/.test(String(id || ""))) return null;
  try {
    const parsed = JSON.parse(await fsp.readFile(fileFor(id), "utf8"));
    const clean = cleanTemplate(parsed, { id });
    return { ...clean, createdAt: parsed.createdAt || null, updatedAt: parsed.updatedAt || null };
  } catch (_) {
    // A hand-edited file that no longer parses should not take the whole page
    // down; it is just skipped and stays on disk for someone to fix.
    return null;
  }
}

async function getTemplate(id) {
  await ensureSeeded();
  const template = await readTemplate(id);
  if (!template) throw notFound(id);
  return template;
}

async function createTemplate(input) {
  await ensureSeeded();
  const clean = cleanTemplate({ ...input, builtIn: false });
  const id = await freeId(clean.id);
  return writeTemplate(stamp({ ...clean, id }));
}

async function updateTemplate(id, input) {
  const previous = await getTemplate(id);
  // The id is the file name and the saved reference on every video, so renaming
  // a template keeps its id.
  const clean = cleanTemplate({ ...input, builtIn: previous.builtIn }, { id: previous.id });
  return writeTemplate(stamp(clean, previous));
}

async function duplicateTemplate(id) {
  const source = await getTemplate(id);
  const name = `${source.name} copy`.slice(0, 90);
  const clean = cleanTemplate({ ...source, name, builtIn: false }, { id: slugify(name) });
  const freeSlug = await freeId(clean.id);
  return writeTemplate(stamp({ ...clean, id: freeSlug }));
}

async function deleteTemplate(id) {
  const template = await getTemplate(id);
  await fsp.rm(fileFor(template.id), { force: true });
  return template;
}

async function freeId(base) {
  let candidate = base;
  for (let suffix = 2; suffix < 200; suffix += 1) {
    if (!fs.existsSync(fileFor(candidate))) return candidate;
    candidate = `${base}-${suffix}`.slice(0, 60);
  }
  throw badRequest("Too many templates with that name already. Pick a different name.");
}

/* ---------------------------------------------------------------- */
/* turning a template into the beats a render uses                  */
/* ---------------------------------------------------------------- */

function fill(value, vars) {
  return String(value == null ? "" : value)
    .replace(/\{firstName\}/g, vars.firstName || "there")
    .replace(/\{company\}/g, vars.company || "your website");
}

/**
 * The beats a render actually draws: placeholders filled in, and each
 * Neighborhood Explorer beat given the tab it should highlight, in order.
 */
function renderBeats(template, vars = {}) {
  let neSeen = 0;
  return template.beats.map((beat, index) => {
    const rendered = {
      index,
      scene: beat.scene,
      seconds: beat.seconds,
      text: fill(beat.text, vars),
      caption: beat.caption
        ? { headline: fill(beat.caption.headline, vars), subline: fill(beat.caption.subline, vars) }
        : { headline: "", subline: "" },
      neTab: null,
      neTabName: "",
    };
    if (beat.scene === "ne") {
      // A beat that names its own tab wins. That is how a script guarantees the
      // Demographics tab is on screen while the voice says "Demographics".
      const pinned = beat.tab ? NE_TABS.indexOf(canonicalTabName(beat.tab)) : -1;
      rendered.neTab = pinned >= 0 ? pinned : Math.min(neSeen, NE_TABS.length - 1);
      rendered.neTabName = NE_TABS[rendered.neTab];
      neSeen += 1;
    }
    return rendered;
  });
}

/** The whole script as plain text, for the teleprompter. */
function beatsToText(beats) {
  return beats.map((beat) => beat.text).join("\n\n");
}

function totalSeconds(template) {
  return Math.round(template.beats.reduce((sum, beat) => sum + beat.seconds, 0) * 10) / 10;
}

/** What the picker and the Scripts list need, without the whole script. */
function summary(template) {
  return {
    id: template.id,
    name: template.name,
    explorers: template.explorers,
    explorersLabel: EXPLORER_MODE_LABELS[template.explorers],
    listingExplorer: template.listingExplorer,
    listingExplorerLabel: LISTING_EXPLORER_LABELS[template.listingExplorer],
    notes: template.notes,
    builtIn: template.builtIn,
    beatCount: template.beats.length,
    totalSeconds: totalSeconds(template),
    updatedAt: template.updatedAt || null,
  };
}

module.exports = {
  SCENES,
  SCENE_LABELS,
  EXPLORER_MODES,
  EXPLORER_MODE_LABELS,
  LISTING_EXPLORER_MODES,
  LISTING_EXPLORER_LABELS,
  NE_TABS,
  MIN_BEAT_SECONDS,
  MAX_BEAT_SECONDS,
  dir,
  ensureSeeded,
  renameTabsOnDisk,
  restoreDefaults,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  deleteTemplate,
  renderBeats,
  beatsToText,
  totalSeconds,
  summary,
  slugify,
};
