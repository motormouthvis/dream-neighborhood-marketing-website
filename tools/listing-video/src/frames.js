"use strict";

const path = require("path");
const { pathToFileURL } = require("url");
const config = require("./config");
const { NE_TABS } = require("./ne-tabs");

/** The scenes that are the customer's own listing page rather than a popup. */
const LISTING_SCENES = new Set(["listing", "listing-tap"]);

/*
 * What the Neighborhood Explorer looks like in words.
 *
 * Everything in a frame is either a photograph of the real product or something
 * we draw, and this matches the second kind: the popup's own header, and the
 * label beside the house button. It is what the guard below reads the stage for.
 */
const NEIGHBORHOOD_EXPLORER_ON_SCREEN = /neighborhood explorer|explore (the|this) neighborhood/i;

/**
 * The label beside the house button on a listing frame.
 *
 * It says schools, not neighborhood.
 *
 * This is the bug Bill reported three times. The button we draw in the corner of
 * their listing is the School Explorer's - templates.js guarantees School
 * Explorer is the first Explorer any script shows, and by the time a
 * Neighborhood Explorer beat runs the popup is open and this label is hidden
 * with the rest of the button. But the label said "Click here to explore the
 * neighborhood around 6031 N Rosemead Dr", so every listing frame of every
 * script carried Neighborhood Explorer wording - including the school-only
 * script, which is documented never to mention it, and including the "before"
 * shot, whose whole point is a listing with no Explorer on it yet.
 *
 * It was drawn the same way whether the listing behind it was photographed off
 * their site or uploaded by hand, which is why re-checking the live page for an
 * Explorer did nothing for the upload.
 */
function tooltipFor(address) {
  const street = address && address.street ? address.street : "";
  if (street) return `Click here to explore the schools around ${street}`;
  return "Click here to explore the schools near this home";
}

/**
 * Why this frame must not be photographed, or "" if it is fine.
 *
 * Read from the stage itself, after the beat has been drawn and before the
 * shutter, so it judges what is actually on screen rather than what was asked
 * for. A caption, a tooltip, a popup header - anything we draw - is caught the
 * same way, on the uploaded-screenshot path exactly as on the live one.
 *
 *   A listing beat is the customer's own page. Our School Explorer popup opens
 *   on an "se" beat and the Neighborhood Explorer's on an "ne" beat; neither
 *   belongs on the page underneath, and a script that is a "before" shot has a
 *   listing with no Explorer on it at all.
 *
 *   A School-Explorer-only script must not mention the Neighborhood Explorer
 *   anywhere. That is the promise the shipped script's own notes make.
 */
function wrongExplorerOnScreen({ scene, explorers, card, onScreen }) {
  const words = String(onScreen == null ? "" : onScreen);
  const schoolOnly = explorers === "se";
  const onTheListing = LISTING_SCENES.has(scene);

  if (card === "ne" && (onTheListing || schoolOnly)) {
    return onTheListing
      ? "a Neighborhood Explorer popup is drawn over a listing beat"
      : "a Neighborhood Explorer popup is drawn in a School-Explorer-only script";
  }

  const said = words.match(NEIGHBORHOOD_EXPLORER_ON_SCREEN);
  if (!said) return "";
  if (onTheListing) return `the listing frame says "${said[0]}"`;
  if (schoolOnly) return `a School-Explorer-only script says "${said[0]}"`;
  return "";
}

/**
 * The School Explorer picture for this beat.
 *
 * A script has more than one School Explorer beat, and the walk photographs the
 * list scrolled a little further each time, so each beat gets its own picture -
 * and a script with more beats than pictures holds the last one rather than
 * running out.
 */
function schoolShotFor(context, position) {
  const shots = (context && context.schoolExplorerShots) || [];
  const files = (Array.isArray(shots) ? shots : [shots]).filter(Boolean);
  if (!files.length) return "";
  return files[Math.min(Math.max(Number(position) || 0, 0), files.length - 1)];
}

function specForBeat(beat, context, { sePosition = 0 } = {}) {
  const base = {
    bg: context.bgUrl,
    caption: beat.caption || { headline: "", subline: "" },
    tooltip: tooltipFor(context.address),
    // The header of each Explorer card names the house it is about.
    address: context.address || null,
    tapping: false,
    hidePopup: false,
    card: null,
    tabImage: "",
    company: context.company,
    year: new Date().getFullYear(),
  };

  if (beat.scene === "listing-tap") return { ...base, tapping: true };
  if (beat.scene === "se") {
    /*
     * The School Explorer card is a photograph of the real product at this
     * listing's address, taken by src/school-explorer.js.
     *
     * It used to be drawn here from a fixed list of Smyrna, Georgia schools, so
     * every video showed that same district whatever address it was about - which
     * is how a Peoria listing went out with Cobb County's schools in it. There is
     * no drawn stand-in to fall back on: a card we made up is the bug.
     */
    const shot = schoolShotFor(context, sePosition);
    if (!shot) {
      throw new Error(
        "There is no School Explorer screenshot for this listing, so that beat cannot be drawn."
      );
    }
    return { ...base, card: "se", hidePopup: true, tabImage: pathToFileURL(shot).toString() };
  }
  if (beat.scene === "ne") {
    // The Neighborhood Explorer card is a photograph of the real tab, taken by
    // src/explorer.js for this listing's address.
    const tab = beat.neTabName || NE_TABS[Number(beat.neTab || 0)];
    const shots = (context.explorerShots && context.explorerShots[tab]) || [];
    // A tab is filmed in one or more shots; this is the first of them.
    const shot = Array.isArray(shots) ? shots[0] : shots;
    if (!shot) {
      throw new Error(
        `There is no Neighborhood Explorer screenshot for the "${tab}" tab, so that beat cannot be drawn.`
      );
    }
    return { ...base, card: "ne", hidePopup: true, tabImage: pathToFileURL(shot).toString() };
  }
  return base;
}

/**
 * Every still one beat is worth.
 *
 * Usually one. A Neighborhood Explorer beat is worth one per shot of that tab,
 * because a tab is taller than the card and the walk scrolls through its
 * sections - so the beat's seconds are spread across its own sections rather
 * than held on a still of the top.
 */
function specsForBeat(beat, context, options = {}) {
  if (beat.scene !== "ne") return [specForBeat(beat, context, options)];

  const tab = beat.neTabName || NE_TABS[Number(beat.neTab || 0)];
  const shots = (context.explorerShots && context.explorerShots[tab]) || [];
  const files = Array.isArray(shots) ? shots.filter(Boolean) : [shots].filter(Boolean);
  if (!files.length) {
    throw new Error(
      `There is no Neighborhood Explorer screenshot for the "${tab}" tab, so that beat cannot be drawn.`
    );
  }

  const base = specForBeat({ ...beat, scene: "listing" }, context);
  return files.map((file) => ({
    ...base,
    card: "ne",
    hidePopup: true,
    tabImage: pathToFileURL(file).toString(),
  }));
}

/**
 * Render one 1920x1080 still per beat. JPEG, not PNG: these are kept on disk
 * for the whole life of the job so a re-recorded voice can be re-timed against
 * the same pictures without opening Chrome again.
 */
async function renderFrames({
  browser,
  beats,
  screenshot,
  address,
  company,
  explorerShots,
  schoolExplorerShots,
  // Which Explorers this script is allowed to show at all, off the template.
  explorers = "se-ne",
  outDir,
  log,
}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const templateUrl = pathToFileURL(path.join(config.root, "views", "frame.html")).toString();
  await page.goto(templateUrl, { waitUntil: "load", timeout: 30000 });

  const context = {
    bgUrl: pathToFileURL(screenshot).toString(),
    address,
    company,
    explorerShots: explorerShots || {},
    schoolExplorerShots: schoolExplorerShots || [],
  };

  const frames = [];
  /*
   * Which beat each still belongs to.
   *
   * A tab beat is worth several stills, so the two lists are no longer the same
   * length. This is what lets a beat's seconds be shared out across its own
   * stills later, whatever the voice turns out to be - see spreadDurations.
   */
  const frameBeats = [];
  /*
   * What each still had on it, read off the stage rather than inferred.
   *
   * Kept so the guard below and the tests that police it can both look at the
   * words that were really photographed.
   */
  const frameText = [];
  // Which School Explorer beat this is, so each gets its own picture of the list.
  let sePosition = 0;
  try {
    for (let index = 0; index < beats.length; index += 1) {
      const specs = specsForBeat(beats[index], context, { sePosition });
      if (beats[index].scene === "se") sePosition += 1;
      for (let part = 0; part < specs.length; part += 1) {
        await page.evaluate((value) => window.renderFrame(value), specs[part]);

        /*
         * Everything the frame will show, in the words it will show them in.
         *
         * innerText is what a person watching would read, so the caption, the
         * popup's header and the label beside the house button are all in here -
         * and so is anything a later change starts drawing.
         */
        const onScreen = await page.evaluate(() =>
          (document.getElementById("stage").innerText || "").replace(/\s+/g, " ").trim()
        );
        const wrong = wrongExplorerOnScreen({
          scene: beats[index].scene,
          explorers,
          card: specs[part].card,
          onScreen,
        });
        if (wrong) {
          const error = new Error(
            `Scene ${index + 1} of this script is a "${beats[index].scene}" beat and ${wrong}, so this video was not made. ${
              LISTING_SCENES.has(beats[index].scene)
                ? "A listing beat is the customer's own page: our Explorer popups open on their own beats and nothing about them belongs on the page underneath"
                : "This script is School Explorer only, so the Neighborhood Explorer cannot appear anywhere in it"
            }. Fix the wording on that beat on the Scripts tab, or pick the "SE to NE upgrade" script.`
          );
          error.code = "NE_ON_LISTING_SCENE";
          throw error;
        }

        const filePath = path.join(
          outDir,
          `frame-${String(index).padStart(3, "0")}-${String(part).padStart(2, "0")}.jpg`
        );
        await page.screenshot({
          path: filePath,
          type: "jpeg",
          quality: 95,
          clip: { x: 0, y: 0, width: 1920, height: 1080 },
          captureBeyondViewport: false,
        });
        frames.push(filePath);
        frameBeats.push(index);
        frameText.push(onScreen);
      }
      if ((index + 1) % 4 === 0 || index === beats.length - 1) {
        log(`Drew ${index + 1} of ${beats.length} scenes`);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return { frames, frameBeats, frameText };
}

/**
 * Turn a length per beat into a length per still.
 *
 * A beat worth three stills gives each of them a third of its seconds, so the
 * scenes keep the timing the script asked for however many pictures they are made
 * of - and whether the seconds came from the template or from a recorded voice.
 */
function spreadDurations(beatSeconds, frameBeats) {
  if (!Array.isArray(frameBeats) || !frameBeats.length) return beatSeconds.slice();

  const perBeat = new Map();
  for (const index of frameBeats) perBeat.set(index, (perBeat.get(index) || 0) + 1);

  return frameBeats.map((index) => {
    const seconds = Number(beatSeconds[index]) || 0;
    return seconds / (perBeat.get(index) || 1);
  });
}

module.exports = {
  renderFrames,
  tooltipFor,
  specForBeat,
  specsForBeat,
  schoolShotFor,
  spreadDurations,
  wrongExplorerOnScreen,
  LISTING_SCENES,
  NEIGHBORHOOD_EXPLORER_ON_SCREEN,
};
