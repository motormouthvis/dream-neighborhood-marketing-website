"use strict";

/**
 * Script templates: what one is, and the ones this repo ships.
 *
 * WHERE SCRIPTS LIVE, AND WHY IT IS NOT HERE ANY MORE
 *
 * They used to be one JSON file each under <dataDir>/templates. Heroku replaces
 * the whole slug on every deploy and the dyno's disk goes with it, so every
 * ship wiped Bill's scripts and reseeded the shipped three - months of edits
 * gone, repeatedly, with nothing in the interface saying it would happen.
 *
 * Custom and edited scripts now live in the browser, in localStorage, one copy
 * per person. See public/js/script-store.js. That is Bill's call and it fits
 * how the tool is used: he and Myles want different scripts, and neither wants
 * the other's turning up in their picker. It also means a deploy cannot touch
 * them, because a deploy never touches their browser.
 *
 * What is left on this side:
 *
 *   the shipped defaults   read out of src/default-templates.js, never written
 *                          anywhere. GET /api/templates serves them.
 *   validation             cleanTemplate is the one place that says what a
 *                          script may contain, and it runs on anything the
 *                          browser sends before a video is made from it.
 *   the old files          read-only, so scripts written before this change can
 *                          be pulled into a browser once. Nothing deletes them.
 *
 * A template is:
 *   id         slug, and the reference every video keeps
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
 *   beats[]    ordered list of { scene, seconds, autoSeconds, text, caption, tab }
 */

const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");
const { NE_TABS, canonicalTabName } = require("./ne-tabs");
const { DEFAULT_TEMPLATES, DEFAULT_TEMPLATE_IDS } = require("./default-templates");
// The same arithmetic the editor puts in the box, so a beat that follows its
// words is the same length here as it looked there. See public/js/beat-timing.js.
const { suggestSeconds, isSuggested } = require("../public/js/beat-timing");

/*
 * The four looks a beat can have, and what each one draws.
 *
 * There are THREE listing looks, not one, because "their listing page" was
 * doing three different jobs and getting two of them wrong. Bill kept seeing
 * the School Explorer house button - and its "Click here to explore..." label -
 * on the beats whose whole point is a listing with nothing of ours on it yet.
 * The before-and-after scripts open by saying "there's nothing here about
 * schools" over a page that was drawing our button in the corner.
 *
 *   listing         JUST their page. No house button, no label, no popup, no
 *                   scrim. This is the "before" shot and the only scene that is
 *                   purely the customer's own website.
 *   listing-button  Their page with the School Explorer house button on it, and
 *                   nothing else of ours. This is the "the icon is there" beat -
 *                   the button is in frame and being pressed, but the card has
 *                   not opened yet.
 *   se              Their page with the School Explorer popup open over it.
 *   ne              Their page with the Neighborhood Explorer popup open over it.
 *
 * See src/frames.js for what each one hands the frame template, and
 * views/frame.html for the drawing itself.
 */
const SCENES = ["listing", "listing-button", "se", "ne"];
const SCENE_LABELS = {
  listing: "Just their listing page \u2014 nothing of ours on it",
  "listing-button": "Their listing page with the School Explorer button on it",
  se: "Their listing page with the School Explorer popup open",
  ne: "Their listing page with the Neighborhood Explorer popup open",
};
const SCENE_HINTS = {
  listing: "The before shot. No house button, no label, no popup.",
  "listing-button": "The house button is in the bottom right corner and being tapped. The popup has not opened yet.",
  se: "The School Explorer card, photographed at this listing's address.",
  ne: "The Neighborhood Explorer card, photographed at this listing's address.",
};

/*
 * What a scene used to be called.
 *
 * "listing-tap" was the only way to get the house button on screen, so every
 * script that wanted it says that. It is the same look as listing-button now,
 * and a saved script keeps working without anybody re-picking a dropdown.
 */
const SCENE_WAS_CALLED = { "listing-tap": "listing-button" };

/** The scene a saved beat means, whatever it called it. */
function canonicalScene(name) {
  const wanted = String(name == null ? "" : name).trim();
  return SCENE_WAS_CALLED[wanted] || wanted;
}
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
// The bookkeeping file the old on-disk seeding kept beside the scripts. Nothing
// writes it any more; it is named here so the legacy reader skips over it.
const SEED_MARKER = ".seeded.json";

/** Where scripts used to be kept. Read for the one-time import, never written. */
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

  const scene = canonicalScene(raw.scene);
  if (!SCENES.includes(scene)) {
    throw badRequest(`${where} has an unknown scene. Use one of: ${SCENES.join(", ")}.`);
  }

  /*
   * Whether this beat's length follows the words in it.
   *
   * The editor used to work this out by asking "is the saved number the one we
   * would have suggested?" and nothing else, so a beat that had drifted a tenth
   * of a second - or one somebody edited before this existed - came back as
   * held, and then sat there while the words underneath it changed. That is the
   * "it only updates sometimes" Bill was seeing.
   *
   * So the answer is saved with the beat instead of guessed at. Scripts written
   * before it existed still get the old guess, once, and record the answer the
   * next time they are saved.
   */
  const followsText =
    raw.autoSeconds === undefined || raw.autoSeconds === null
      ? isSuggested(raw.seconds, text)
      : Boolean(raw.autoSeconds);

  // A beat that follows the words IS the suggestion, so there is nothing to
  // disagree with: the number cannot go stale behind an edit made anywhere else.
  const seconds = followsText ? suggestSeconds(text) : Number(raw.seconds);
  if (!Number.isFinite(seconds) || seconds < MIN_BEAT_SECONDS || seconds > MAX_BEAT_SECONDS) {
    throw badRequest(`${where} needs a suggested duration between ${MIN_BEAT_SECONDS} and ${MAX_BEAT_SECONDS} seconds.`);
  }

  return {
    scene,
    seconds: Math.round(seconds * 10) / 10,
    autoSeconds: followsText,
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
/* the shipped defaults - read out of code, written nowhere          */
/* ---------------------------------------------------------------- */

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
 * Bring a script written before the chips were renamed up to date.
 *
 * Only used on scripts coming in from somewhere older than this code - the disk
 * files below, or an exported file being imported - because those still name
 * Mobility and Points of Interest in their tab pins, their spoken lines and
 * their captions. The pins would still find the right chip; the voice would
 * name a chip that is no longer on screen.
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
  return touched ? { ...template, beats } : template;
}

/**
 * The scripts this repo ships, as the browser is given them.
 *
 * Built fresh from src/default-templates.js every call and never written to
 * disk, so a deploy updates them and there is nothing for it to overwrite. A
 * copy somebody has edited lives in their browser under the same id and wins
 * there; this is only ever the shipped original.
 */
function listDefaults() {
  return DEFAULT_TEMPLATES.map((template) =>
    cleanTemplate({ ...template, builtIn: true }, { id: template.id })
  );
}

function getDefault(id) {
  const found = listDefaults().find((template) => template.id === String(id || ""));
  if (!found) throw notFound(id);
  return found;
}

function isDefaultId(id) {
  return DEFAULT_TEMPLATE_IDS.includes(String(id || ""));
}

/**
 * A script the browser sent, checked before anything is filmed from it.
 *
 * The browser holds the only copy of a custom script, so it posts the whole
 * thing with the job rather than an id the server could look up. Everything it
 * sends goes through the same validation a shipped script does - the scene
 * names, the tab names, the durations, School Explorer coming first - so a
 * hand-edited localStorage entry cannot get a video made out of it that the
 * Scripts page would have refused to save.
 */
function fromBrowser(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== "object") throw badRequest("That script did not come through. Reload the page and try again.");
  const clean = cleanTemplate({ ...parsed, builtIn: isDefaultId(parsed.id) }, { id: parsed.id });
  return clean;
}

/* ---------------------------------------------------------------- */
/* the scripts that were on disk before scripts moved to the browser */
/* ---------------------------------------------------------------- */

/**
 * The old <dataDir>/templates files, read and never written.
 *
 * These are whatever survived on the box between the last deploy and now. They
 * are offered to the Scripts page as an import, once, so nothing anybody wrote
 * is lost in the move - and they are left exactly where they are afterwards,
 * because this code deleting Bill's scripts is the failure mode it exists to
 * end. On a fresh dyno there are simply none, and the import is not offered.
 *
 * A file that no longer parses, or that no longer validates, is skipped rather
 * than taking the list down; it stays on disk for somebody to look at.
 */
async function legacyTemplates() {
  let names = [];
  try {
    names = await fsp.readdir(dir());
  } catch (_) {
    return [];
  }

  const found = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name === SEED_MARKER) continue;
    const id = name.replace(/\.json$/, "");
    if (!/^[a-z0-9-]{1,60}$/.test(id)) continue;
    let parsed;
    try {
      parsed = JSON.parse(await fsp.readFile(fileFor(id), "utf8"));
    } catch (_) {
      continue;
    }
    try {
      const clean = cleanTemplate(renameTabsIn({ ...parsed, builtIn: false }), { id });
      found.push({
        ...clean,
        createdAt: parsed.createdAt || null,
        updatedAt: parsed.updatedAt || null,
        // Whether this is one of the shipped scripts sitting on disk unchanged,
        // in which case importing it would only clutter somebody's browser with
        // a copy of something they already have.
        matchesShipped: isDefaultId(id) && sameScript(clean, safeDefault(id)),
      });
    } catch (_) {
      continue;
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function safeDefault(id) {
  try {
    return getDefault(id);
  } catch (_) {
    return null;
  }
}

/** Are these two scripts the same words, scenes and timings? */
function sameScript(a, b) {
  if (!a || !b) return false;
  const shape = (template) =>
    JSON.stringify({
      name: template.name,
      explorers: template.explorers,
      listingExplorer: template.listingExplorer,
      notes: template.notes,
      beats: template.beats,
    });
  return shape(a) === shape(b);
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
 *
 * THE CAPTION IS OFF UNLESS THE JOB ASKED FOR IT, and the default here is off.
 *
 * The green bar across the top of every frame is the script's own words burned
 * into the picture, and that made the spoken script unchangeable: Myles cannot
 * reword a line without the words on screen contradicting him, and he is the
 * one writing the lines. So a caption is now something a job opts into on the
 * form, and a script may carry caption text without that text being drawn.
 *
 * Off is the default rather than the exception because a forgotten caller
 * should draw nothing of ours over the customer's page - the same way round as
 * every other piece of furniture in src/frames.js. When it is off the caption
 * comes through empty, which is the `#stage.no-caption` path views/frame.html
 * has always had, so nothing downstream had to learn a new state.
 */
function renderBeats(template, vars = {}, { showCaptions = false } = {}) {
  let neSeen = 0;
  return template.beats.map((beat, index) => {
    const rendered = {
      index,
      scene: beat.scene,
      seconds: beat.seconds,
      text: fill(beat.text, vars),
      caption:
        showCaptions && beat.caption
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

/**
 * What the picker and the Scripts list need, without the whole script.
 *
 * The browser builds the same object for its own scripts, off the same labels,
 * which is why the label maps go out with the session - see
 * public/js/script-store.js.
 */
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
  SCENE_HINTS,
  canonicalScene,
  cleanTemplate,
  EXPLORER_MODES,
  EXPLORER_MODE_LABELS,
  LISTING_EXPLORER_MODES,
  LISTING_EXPLORER_LABELS,
  NE_TABS,
  MIN_BEAT_SECONDS,
  MAX_BEAT_SECONDS,
  dir,
  listDefaults,
  getDefault,
  isDefaultId,
  fromBrowser,
  legacyTemplates,
  renameTabsIn,
  renderBeats,
  beatsToText,
  totalSeconds,
  summary,
  slugify,
};
