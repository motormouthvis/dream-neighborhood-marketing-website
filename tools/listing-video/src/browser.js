"use strict";

const puppeteer = require("puppeteer-core");
const config = require("./config");

async function launch() {
  if (!config.chromePath) {
    throw new Error(
      "No Chrome found. Install Google Chrome or Chromium, or set LISTING_VIDEO_CHROME to its path."
    );
  }
  return puppeteer.launch({
    executablePath: config.chromePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--font-render-hinting=none",
    ],
    defaultViewport: { width: 1920, height: 1080 },
    protocolTimeout: 120000,
  });
}

module.exports = { launch };
