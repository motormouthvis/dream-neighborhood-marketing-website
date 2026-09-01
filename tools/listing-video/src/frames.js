"use strict";

const path = require("path");
const { pathToFileURL } = require("url");
const config = require("./config");
const { DEMO_NEIGHBORHOOD, DEMO_SCHOOLS, NE_TABS } = require("./demo-data");

function tooltipFor(address) {
  const street = address && address.street ? address.street : "";
  if (street) return `Click here to explore the neighborhood around ${street}`;
  return "Click here to explore this neighborhood";
}

function specForBeat(beat, context) {
  const base = {
    bg: context.bgUrl,
    caption: beat.caption || { headline: "", subline: "" },
    tooltip: tooltipFor(context.address),
    tapping: false,
    hidePopup: false,
    card: null,
    tabImage: "",
    company: context.company,
    demo: DEMO_NEIGHBORHOOD,
    schools: DEMO_SCHOOLS,
    year: new Date().getFullYear(),
  };

  if (beat.scene === "listing-tap") return { ...base, tapping: true };
  if (beat.scene === "se") return { ...base, card: "se", hidePopup: true };
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
function specsForBeat(beat, context) {
  if (beat.scene !== "ne") return [specForBeat(beat, context)];

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
async function renderFrames({ browser, beats, screenshot, address, company, explorerShots, outDir, log }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const templateUrl = pathToFileURL(path.join(config.root, "views", "frame.html")).toString();
  await page.goto(templateUrl, { waitUntil: "load", timeout: 30000 });

  const context = {
    bgUrl: pathToFileURL(screenshot).toString(),
    address,
    company,
    explorerShots: explorerShots || {},
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
  try {
    for (let index = 0; index < beats.length; index += 1) {
      const specs = specsForBeat(beats[index], context);
      for (let part = 0; part < specs.length; part += 1) {
        await page.evaluate((value) => window.renderFrame(value), specs[part]);
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
      }
      if ((index + 1) % 4 === 0 || index === beats.length - 1) {
        log(`Drew ${index + 1} of ${beats.length} scenes`);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return { frames, frameBeats };
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

module.exports = { renderFrames, tooltipFor, specForBeat, specsForBeat, spreadDurations };
