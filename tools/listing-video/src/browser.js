"use strict";

const puppeteer = require("puppeteer-core");
const config = require("./config");

/**
 * Chrome, kept as small as it can be.
 *
 * The staging box is a 512MB dyno, and a capture there once climbed to 1012MB
 * and took the whole web process down with it. Everything here is about keeping
 * one browser with one page from doing that again.
 */
const LOW_MEMORY_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  // /dev/shm is tiny in a container, so Chrome must not try to use it.
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-software-rasterizer",
  // A cap per V8 heap. A page that blows through it fails on its own instead of
  // taking the dyno with it.
  "--js-flags=--max-old-space-size=128",
  // Chrome's own budget for a small machine: smaller caches and tighter memory
  // limits throughout. This is the single biggest saving here.
  "--enable-low-end-device-mode",
  "--disk-cache-size=1",
  "--media-cache-size=1",
  "--aggressive-cache-discard",
  // Fewer renderer processes. --single-process saves more but crashes on real
  // sites, so this is the version that survives.
  "--disable-features=IsolateOrigins,site-per-process,Translate,MediaRouter,BackForwardCache,AcceptCHFrame",
  "--disable-site-isolation-trials",
  "--process-per-site",
  "--renderer-process-limit=1",
  "--disable-accelerated-2d-canvas",
  "--disable-gpu-compositing",
  "--disable-partial-raster",
  // A separate GPU process costs about 50MB and does nothing useful headless.
  "--in-process-gpu",
  "--disable-gpu-program-cache",
  "--disable-extensions",
  "--disable-component-extensions-with-background-pages",
  "--disable-default-apps",
  "--disable-background-networking",
  "--disable-backgrounding-occluded-windows",
  "--disable-breakpad",
  "--disable-crash-reporter",
  "--disable-sync",
  "--mute-audio",
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--font-render-hinting=none",
  // A realtor site's voice widget asking for the microphone and being told no is
  // what put a "Microphone access denied" panel in the middle of a finished
  // video. Answer yes with a fake device instead.
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--deny-permission-prompts",
  "--disable-notifications",
];

async function launch() {
  if (!config.chromePath) {
    throw new Error(
      "No Chrome found. Install Google Chrome or Chromium, or set LISTING_VIDEO_CHROME to its path."
    );
  }
  return puppeteer.launch({
    executablePath: config.chromePath,
    headless: true,
    args: LOW_MEMORY_ARGS,
    // Small while crawling. The page that actually gets photographed is resized
    // to 1920x1080 for the shot.
    defaultViewport: { width: 1024, height: 768 },
    protocolTimeout: 30000,
  });
}

/**
 * The blank page Chrome opens with. It is an idle renderer we never use, so it
 * gets closed before any real work starts.
 */
async function closeStartupPage(browser) {
  try {
    const pages = await browser.pages();
    for (const page of pages) {
      if (page.url() === "about:blank" || page.url() === "") await page.close().catch(() => {});
    }
  } catch (_) {
    /* not worth failing over */
  }
}

/**
 * Shut Chrome down and be sure it is really gone.
 *
 * A browser that has just run out of memory often will not answer close(), and
 * a leaked Chrome on a 512MB dyno is the next crash. So close() gets a few
 * seconds and then the process is killed outright.
 */
async function closeBrowser(browser, { graceMs = 5000 } = {}) {
  if (!browser) return "nothing to close";
  const child = typeof browser.process === "function" ? browser.process() : null;

  const closed = await Promise.race([
    browser
      .close()
      .then(() => true)
      .catch(() => false),
    new Promise((resolve) => setTimeout(() => resolve(false), graceMs)),
  ]);

  if (closed && (!child || child.killed || child.exitCode !== null)) return "closed";

  if (child) {
    try {
      child.kill("SIGKILL");
    } catch (_) {
      /* already gone */
    }
    return closed ? "closed, process killed to be sure" : "killed";
  }
  return closed ? "closed" : "would not close";
}

module.exports = { launch, closeBrowser, closeStartupPage, LOW_MEMORY_ARGS };
