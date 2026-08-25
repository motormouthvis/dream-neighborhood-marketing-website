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

function specForSegment(segment, context) {
  const base = {
    bg: context.bgUrl,
    caption: segment.caption,
    tooltip: tooltipFor(context.address),
    tapping: false,
    hidePopup: false,
    card: null,
    company: context.company,
    demo: DEMO_NEIGHBORHOOD,
    schools: DEMO_SCHOOLS,
    tabs: NE_TABS,
    summary: NE_SUMMARY,
    year: new Date().getFullYear(),
    placeholder: context.placeholder,
  };

  if (segment.scene === "listing-tap") return { ...base, tapping: true };
  if (segment.scene === "se") return { ...base, card: "se", hidePopup: true };
  if (segment.scene === "ne") return { ...base, card: "ne", hidePopup: true };
  return base;
}

/**
 * Render one 1920x1080 PNG per narration segment.
 */
async function renderFrames({ browser, segments, screenshot, address, company, placeholder, outDir, log }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const templateUrl = pathToFileURL(path.join(config.root, "views", "frame.html")).toString();
  await page.goto(templateUrl, { waitUntil: "load", timeout: 30000 });

  const context = {
    bgUrl: pathToFileURL(screenshot).toString(),
    address,
    company,
    placeholder: placeholder || null,
  };

  const frames = [];
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const spec = specForSegment(segment, context);
      await page.evaluate((value) => window.renderFrame(value), spec);
      const filePath = path.join(outDir, `frame-${String(index).padStart(3, "0")}.png`);
      await page.screenshot({
        path: filePath,
        type: "png",
        clip: { x: 0, y: 0, width: 1920, height: 1080 },
        captureBeyondViewport: false,
      });
      frames.push(filePath);
      if ((index + 1) % 4 === 0 || index === segments.length - 1) {
        log(`Drew ${index + 1} of ${segments.length} scenes`);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return frames;
}

module.exports = { renderFrames, tooltipFor };
