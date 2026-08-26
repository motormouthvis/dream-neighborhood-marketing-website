"use strict";

const path = require("path");
const { pathToFileURL } = require("url");
const config = require("./config");
const { DEMO_NEIGHBORHOOD, DEMO_SCHOOLS, NE_TABS, NE_SUMMARY } = require("./demo-data");

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
    activeTab: 0,
    company: context.company,
    demo: DEMO_NEIGHBORHOOD,
    schools: DEMO_SCHOOLS,
    tabs: NE_TABS,
    summary: NE_SUMMARY,
    year: new Date().getFullYear(),
  };

  if (beat.scene === "listing-tap") return { ...base, tapping: true };
  if (beat.scene === "se") return { ...base, card: "se", hidePopup: true };
  if (beat.scene === "ne") {
    return { ...base, card: "ne", hidePopup: true, activeTab: Number(beat.neTab || 0) };
  }
  return base;
}

/**
 * Render one 1920x1080 still per beat. JPEG, not PNG: these are kept on disk
 * for the whole life of the job so a re-recorded voice can be re-timed against
 * the same pictures without opening Chrome again.
 */
async function renderFrames({ browser, beats, screenshot, address, company, outDir, log }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const templateUrl = pathToFileURL(path.join(config.root, "views", "frame.html")).toString();
  await page.goto(templateUrl, { waitUntil: "load", timeout: 30000 });

  const context = {
    bgUrl: pathToFileURL(screenshot).toString(),
    address,
    company,
  };

  const frames = [];
  try {
    for (let index = 0; index < beats.length; index += 1) {
      const spec = specForBeat(beats[index], context);
      await page.evaluate((value) => window.renderFrame(value), spec);
      const filePath = path.join(outDir, `frame-${String(index).padStart(3, "0")}.jpg`);
      await page.screenshot({
        path: filePath,
        type: "jpeg",
        quality: 95,
        clip: { x: 0, y: 0, width: 1920, height: 1080 },
        captureBeyondViewport: false,
      });
      frames.push(filePath);
      if ((index + 1) % 4 === 0 || index === beats.length - 1) {
        log(`Drew ${index + 1} of ${beats.length} scenes`);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return frames;
}

module.exports = { renderFrames, tooltipFor };
