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
 *   notes      free text for whoever edits it next
 *   beats[]    ordered list of { scene, seconds, text, caption }
 *
 * The two shipped v11 templates are seeded on first run from
 * src/default-templates.js and can be edited, duplicated or deleted from there
 * like any other template.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");
const { NE_TABS } = require("./demo-data");
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

  return { scene, seconds: Math.round(seconds * 10) / 10, text, caption: cleanCaption(raw.caption) };
}

function cleanTemplate(raw, { id } = {}) {
  if (!raw || typeof raw !== "object") throw badRequest("That script template is empty.");

  const name = String(raw.name || "").trim().slice(0, 90);
  if (!name) throw badRequest("Give the template a name.");

  const explorers = String(raw.explorers || "").trim();
  if (!EXPLORER_MODES.includes(explorers)) {
    throw badRequest('Choose "School Explorer only" or "School Explorer, then Neighborhood Explorer".');
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

/**
 * Put the two shipped templates on disk the first time this data dir is used.
 * A deleted default stays deleted: the marker records that seeding already
 * happened, so nothing reappears behind anyone's back.
 */
async function ensureSeeded() {
  ensureDir();
  const marker = path.join(dir(), SEED_MARKER);
  if (fs.existsSync(marker)) return [];
  const seeded = [];
  for (const template of DEFAULT_TEMPLATES) {
    if (fs.existsSync(fileFor(template.id))) continue;
    await writeTemplate(stamp(cleanTemplate({ ...template, builtIn: true }, { id: template.id })));
    seeded.push(template.id);
  }
  await fsp.writeFile(
    marker,
    `${JSON.stringify({ seededAt: new Date().toISOString(), ids: DEFAULT_TEMPLATE_IDS }, null, 2)}\n`,
    "utf8"
  );
  return seeded;
}

/** Put the two shipped v11 templates back, exactly as they ship. */
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
    };
    if (beat.scene === "ne") {
      rendered.neTab = Math.min(neSeen, NE_TABS.length - 1);
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
  MIN_BEAT_SECONDS,
  MAX_BEAT_SECONDS,
  dir,
  ensureSeeded,
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
