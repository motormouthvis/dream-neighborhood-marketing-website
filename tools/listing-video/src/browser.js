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
      // A realtor site's voice widget asking for the microphone and being told
      // no is what put a "Microphone access denied" panel in the middle of a
      // finished video. Answer yes with a fake device instead, and suppress the
      // other prompts that draw bars across the page.
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--deny-permission-prompts",
      "--disable-notifications",
      "--disable-features=Translate,MediaRouter",
    ],
    defaultViewport: { width: 1920, height: 1080 },
    protocolTimeout: 120000,
  });
}

module.exports = { launch };
