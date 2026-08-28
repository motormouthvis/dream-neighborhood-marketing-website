"use strict";

/**
 * Filming the real Neighborhood Explorer.
 *
 * The Explorer's seven tabs each show genuinely different data - Schools has a
 * map of schools and school cards, Commutes has "Calculate Your Commute" with
 * Drive/Transit/Walk/Bike, Mobility has "What's within reach" and the walk and
 * bike sliders. The video used to draw its own Neighborhood Explorer card and
 * only move the highlighted tab chip, so every tab beat showed the same Map and
 * Summary body. That is what this replaces.
 *
 * Nothing here invents a tab's contents. The live widget is opened at the
 * listing's coordinates, each tab is clicked, and each is photographed once its
 * own content has arrived and stopped moving. If the Explorer will not load the
 * address, this refuses; there is no drawn-by-us fallback.
 *
 * It runs in its own browser, after the listing capture has closed its one:
 *
 *   - the listing capture browser is deliberately starved (no GPU, low-end
 *     device mode) to survive a small dyno, and the Explorer's map needs WebGL.
 *     Without it the widget sits on "Loading location..." forever.
 *   - only one browser is ever alive at a time, so the peak is unchanged.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { launchExplorerBrowser, closeBrowser } = require("./browser");
const config = require("./config");
const { NE_TABS } = require("./demo-data");

// The card the shots are dropped into is 1340x764, so they are taken at exactly
// that size and need no scaling.
const TAB_VIEWPORT = { width: 1340, height: 764 };

const LOAD_TIMEOUT_MS = 45000;
// Enough for seven tabs to fetch and draw, and no more.
const WALK_BUDGET_MS = 150000;
const TAB_SETTLE_MS = 900;
const TAB_MAX_WAIT_MS = 18000;

// Shown until the widget has a location. While this is up there is no data.
const EMPTY_STATE_RE = /Choose an address using the map/i;
// What it reports when the coordinates are not anywhere it has data for.
const UNKNOWN_PLACE_RE = /^(unknown location|loading location)/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function explorerError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.isCaptureRefusal = true;
  return error;
}

function widgetUrlFor({ lat, lng }) {
  const { widgetUrl, partnerId, widgetNumber } = config.explorer;
  const url = new URL(widgetUrl);
  url.searchParams.set("partner", partnerId);
  url.searchParams.set("widget_number", widgetNumber);
  url.searchParams.set("popup", "true");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  return url.toString();
}

/* eslint-disable no-undef */
/** Click a tab by its label. Runs in the page. */
function clickTab(label) {
  const tab = Array.from(document.querySelectorAll(".main-tab-item")).find(
    (el) => (el.innerText || "").trim().toLowerCase() === String(label).toLowerCase()
  );
  if (!tab) return false;
  tab.click();
  return true;
}

/** What the widget is showing right now. Runs in the page. */
function readWidget() {
  const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
  const tabs = Array.from(document.querySelectorAll(".main-tab-item"));
  return {
    text,
    tabs: tabs.map((el) => (el.innerText || "").trim()),
    active: tabs
      .filter((el) => /bg-accent/.test(String(el.className)))
      .map((el) => (el.innerText || "").trim()),
    // The location the widget resolved the coordinates to, which is what the
    // video will be about.
    place: (text.match(/Current location\s*([^]{0,40}?)\s*(?:View Neighborhood Data|Map|Satellite)/) || [])[1] || "",
  };
}
/* eslint-enable no-undef */

/**
 * Wait until this tab's own content has arrived and stopped changing.
 *
 * "Different from the last tab" is the signal that the click did something, and
 * "the same twice in a row" is the signal it has finished loading.
 */
async function waitForTabContent(page, { previousText, deadline }) {
  let last = "";
  const until = Math.min(Date.now() + TAB_MAX_WAIT_MS, deadline);
  let changed = false;

  while (Date.now() < until) {
    const state = await page.evaluate(readWidget).catch(() => null);
    const text = state ? state.text : "";
    if (text && text !== previousText) changed = true;
    if (changed && text === last && text.length > 120) return { text, settled: true };
    last = text;
    await sleep(TAB_SETTLE_MS);
  }
  return { text: last, settled: false };
}

/**
 * Open the Explorer at these coordinates and photograph each tab.
 *
 * Returns { shots: { [tab]: pngPath }, place, url }.
 */
async function captureExplorerTabs({ lat, lng, tabs = NE_TABS, outDir, log = () => {}, budgetMs = WALK_BUDGET_MS }) {
  const wanted = tabs.filter((tab) => NE_TABS.includes(tab));
  if (!wanted.length) return { shots: {}, place: "", url: "" };

  const url = widgetUrlFor({ lat, lng });
  const deadline = Date.now() + budgetMs;
  const shots = {};
  let browser = null;
  let place = "";

  try {
    log(`Opening the Neighborhood Explorer for ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    browser = await launchExplorerBrowser();
    const page = await browser.newPage();
    await page.setViewport({ ...TAB_VIEWPORT, deviceScaleFactor: 1 });
    page.setDefaultNavigationTimeout(LOAD_TIMEOUT_MS);
    page.on("error", () => {});

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
    await page.waitForNetworkIdle({ idleTime: 1200, timeout: 20000 }).catch(() => {});

    // The empty state clearing is how we know it actually placed the address.
    try {
      await page.waitForFunction(
        (source) => !new RegExp(source, "i").test(document.body.innerText || ""),
        { timeout: Math.max(5000, Math.min(30000, deadline - Date.now())), polling: 500 },
        EMPTY_STATE_RE.source
      );
    } catch (_) {
      throw explorerError(
        "EXPLORER_WOULD_NOT_LOAD",
        "The Neighborhood Explorer did not load any data for that listing's address, so its tabs cannot be filmed. Try a different listing."
      );
    }

    const first = await page.evaluate(readWidget);
    place = (first.place || "").trim();
    if (!first.tabs.length) {
      throw explorerError(
        "EXPLORER_WOULD_NOT_LOAD",
        "The Neighborhood Explorer opened but showed no tabs, so there is nothing to film. Try again in a minute."
      );
    }
    // It says this when the coordinates are not anywhere it has data for. Its
    // tabs then come out blank and identical, which is the very thing we are
    // fixing, so stop here.
    if (!place || UNKNOWN_PLACE_RE.test(place)) {
      throw explorerError(
        "EXPLORER_NO_DATA",
        `The Neighborhood Explorer has no neighborhood data for that listing's address${
          place ? ` (it reported "${place}")` : ""
        }, so its tabs would be empty. Try a different listing.`
      );
    }
    log(`Explorer is showing ${place}`);
    await sleep(1500);

    let previousText = "";
    for (const tab of wanted) {
      if (Date.now() > deadline) {
        throw explorerError(
          "EXPLORER_TOO_SLOW",
          `The Neighborhood Explorer took too long to walk its tabs (stopped after ${Object.keys(shots).length} of ${wanted.length}). Try again.`
        );
      }

      const clicked = await page.evaluate(clickTab, tab);
      if (!clicked) {
        throw explorerError(
          "EXPLORER_TAB_MISSING",
          `The Neighborhood Explorer has no "${tab}" tab any more, so that beat cannot be filmed. The script may need updating to match the product.`
        );
      }

      const { text, settled } = await waitForTabContent(page, { previousText, deadline });
      if (!settled) log(`${tab} was still loading, filmed it as it stood`);
      previousText = text;

      const file = path.join(outDir, `ne-tab-${tab.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
      await page.screenshot({ path: file, type: "png", captureBeyondViewport: false });
      shots[tab] = file;
      log(`Filmed the ${tab} tab (${Object.keys(shots).length} of ${wanted.length})`);
    }

    /*
     * The whole point of filming the real product is that the tabs differ. If
     * they all came out the same picture, something is wrong with the Explorer
     * or with this walk, and shipping it would quietly recreate the bug where
     * every tab showed Map and Summary.
     */
    if (wanted.length > 1) {
      const fingerprints = new Set(
        Object.values(shots).map((file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex"))
      );
      if (fingerprints.size < 2) {
        throw explorerError(
          "EXPLORER_TABS_IDENTICAL",
          "Every Neighborhood Explorer tab came out as the same picture, so the walk did not really load each tab. Nothing was rendered. Try again."
        );
      }
    }

    return { shots, place, url };
  } finally {
    if (browser) await closeBrowser(browser).catch(() => {});
  }
}

module.exports = { captureExplorerTabs, widgetUrlFor, TAB_VIEWPORT, WALK_BUDGET_MS };
