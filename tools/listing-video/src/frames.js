"use strict";

const path = require("path");
const { pathToFileURL } = require("url");
const config = require("./config");
const { NE_TABS } = require("./ne-tabs");

/**
 * The scenes that are the customer's own listing page rather than a popup.
 *
 * "listing-tap" is what listing-button used to be called and is still here so a
 * job saved before the rename draws the same picture it always did.
 */
const LISTING_SCENES = new Set(["listing", "listing-button", "listing-tap"]);

/**
 * The scene that is JUST their page.
 *
 * Nothing of ours goes on it: no house button, no label beside it, no popup, no
 * scrim. This is the "before" shot, and it is the one Bill kept finding our
 * School Explorer button on - the beats that say "there's nothing here about
 * schools" were drawing the button that puts schools there.
 */
const BARE_LISTING_SCENES = new Set(["listing"]);

/** The scenes that put the School Explorer house button in the corner. */
const BUTTON_LISTING_SCENES = new Set(["listing-button", "listing-tap"]);

/*
 * What the Neighborhood Explorer looks like in words.
 *
 * Everything in a frame is either a photograph of the real product or something
 * we draw, and this matches the second kind: the popup's own header, and the
 * label beside the house button. It is what the guard below reads the stage for.
 */
const NEIGHBORHOOD_EXPLORER_ON_SCREEN = /neighborhood explorer|explore (the|this) neighborhood/i;

/**
 * The label we draw beside the house button, in the words we draw it in.
 *
 * Only our own button says this, so finding it on a bare listing frame means
 * the button is there whatever the spec asked for.
 */
const EXPLORER_BUTTON_LABEL = /click here to explore the (schools|neighborhood)/i;

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
 * Why a bare listing frame is not bare, or "" if it is.
 *
 * This is Bill's bug caught at the shutter rather than trusted to the spec. A
 * "listing" beat is meant to be a photograph of the customer's page and nothing
 * else, and the three ways that stops being true are all read back off the
 * stage: the house button being displayed, a popup card being displayed, and
 * any words at all inside the chrome we draw over their page. The caption bar
 * is not chrome in this sense - it is the script's own words and belongs on
 * every beat - so it is deliberately not part of what is read.
 *
 * @param {object} args
 * @param {string} args.scene which beat this frame belongs to
 * @param {object} args.chrome what was read back off the stage
 */
function bareListingChromeOnScreen({ scene, chrome }) {
  if (!BARE_LISTING_SCENES.has(scene)) return "";
  const drawn = chrome && typeof chrome === "object" ? chrome : {};

  if (drawn.buttonShown) return "the School Explorer house button is drawn on it";
  if (drawn.cardShown) return "an Explorer popup is drawn over it";
  if (drawn.dimmed) return "it is dimmed behind a popup that should not be on it";

  const words = String(drawn.text || "").replace(/\s+/g, " ").trim();
  if (EXPLORER_BUTTON_LABEL.test(words)) return `it says "${words.match(EXPLORER_BUTTON_LABEL)[0]}"`;
  if (words) return `our own chrome is on it, reading "${words.slice(0, 90)}"`;
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

/**
 * The parts of a frame every beat has: their page, and the script's caption.
 *
 * Everything of ours is off by default and switched on by the scene, so a new
 * scene that forgets to say draws the customer's page and nothing else. That is
 * the safe way round: the bug this replaces was the button being on unless a
 * beat remembered to turn it off.
 */
function baseSpec(beat, context) {
  return {
    bg: context.bgUrl,
    caption: beat.caption || { headline: "", subline: "" },
    tooltip: "",
    // The header of each Explorer card names the house it is about.
    address: context.address || null,
    tapping: false,
    hidePopup: true,
    // Their page and nothing else. The frame template refuses to draw the
    // button, a card or the scrim while this is set, whatever else is asked for.
    bare: false,
    card: null,
    tabImage: "",
    company: context.company,
    year: new Date().getFullYear(),
  };
}

function specForBeat(beat, context, { sePosition = 0 } = {}) {
  const base = baseSpec(beat, context);

  if (BARE_LISTING_SCENES.has(beat.scene)) return { ...base, bare: true };
  if (BUTTON_LISTING_SCENES.has(beat.scene)) {
    // The house button, with its label, being pressed. Nothing is open over it.
    return { ...base, tooltip: tooltipFor(context.address), hidePopup: false, tapping: true };
  }
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

  const base = baseSpec(beat, context);
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
  /*
   * What of OURS each still had drawn over their page: the house button, a
   * popup card, the dim behind one, and the words in them. This is what the
   * bare-listing gate judges, and what its tests read.
   */
  const frameChrome = [];
  // Which School Explorer beat this is, so each gets its own picture of the list.
  let sePosition = 0;
  try {
    for (let index = 0; index < beats.length; index += 1) {
      const specs = specsForBeat(beats[index], context, { sePosition });
      if (beats[index].scene === "se") sePosition += 1;
      for (let part = 0; part < specs.length; part += 1) {
        await page.evaluate((value) => window.renderFrame(value), specs[part]);

        /*
         * What the frame will show, read off the stage rather than inferred.
         *
         * `text` is everything a person watching would read: the caption, the
         * popup's header, the label beside the house button, and anything a
         * later change starts drawing.
         *
         * `chrome` is the narrower question of what OF OURS is drawn over their
         * page - the house button and the popup card - so a bare listing beat
         * can be judged on our own furniture without the script's caption, which
         * belongs on every beat, counting against it.
         */
        const read = await page.evaluate(() => {
          const words = (node) => (node && node.innerText ? node.innerText.replace(/\s+/g, " ").trim() : "");
          const shown = (node) => Boolean(node) && node.getClientRects().length > 0;
          const button = document.getElementById("popup");
          const card = document.getElementById("card");
          const scrim = document.getElementById("scrim");
          return {
            text: words(document.getElementById("stage")),
            chrome: {
              buttonShown: shown(button),
              cardShown: shown(card),
              dimmed: Boolean(scrim) && Number(window.getComputedStyle(scrim).opacity) > 0.01,
              text: [shown(button) ? words(button) : "", shown(card) ? words(card) : ""].join(" ").trim(),
            },
          };
        });
        const onScreen = read.text;

        /*
         * A bare listing frame is refused before it is photographed.
         *
         * Bill reported the house button and the "Click here to explore..."
         * label on the "before" beats three times, and each fix was to the spec
         * that asks for the frame rather than to the frame itself. This reads
         * the drawn page back, so it catches the button however it got there.
         */
        const notBare = bareListingChromeOnScreen({ scene: beats[index].scene, chrome: read.chrome });
        if (notBare) {
          const error = new Error(
            `Scene ${index + 1} of this script is a "${beats[index].scene}" beat - just their listing page, with nothing of ours on it - but ${notBare}, so this video was not made. ` +
              `Pick "${
                "Their listing page with the School Explorer button on it"
              }" for that beat if the button is meant to be in frame.`
          );
          error.code = "CHROME_ON_BARE_LISTING";
          throw error;
        }

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
        frameChrome.push(read.chrome);
      }
      if ((index + 1) % 4 === 0 || index === beats.length - 1) {
        log(`Drew ${index + 1} of ${beats.length} scenes`);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return { frames, frameBeats, frameText, frameChrome };
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
  baseSpec,
  specForBeat,
  specsForBeat,
  schoolShotFor,
  spreadDurations,
  wrongExplorerOnScreen,
  bareListingChromeOnScreen,
  LISTING_SCENES,
  BARE_LISTING_SCENES,
  BUTTON_LISTING_SCENES,
  NEIGHBORHOOD_EXPLORER_ON_SCREEN,
  EXPLORER_BUTTON_LABEL,
};
