"use strict";

/**
 * Filming the real Neighborhood Explorer.
 *
 * The Explorer's seven chips each show genuinely different data - Schools has a
 * map of schools and school cards, Commutes has "Calculate Your Commute" with
 * Drive/Transit/Walk/Bike, Walk & Bike has the walk and bike radius sliders with
 * a count of what is inside each. The video used to draw its own card and
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
const { NE_TABS, NE_TAB_ALIASES, canonicalTabName } = require("./demo-data");

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
/**
 * Click a chip. Runs in the page.
 *
 * The visible label is tried first, because that is what the product shows and
 * what the script names. Two chips were renamed - Mobility to "Walk & Bike" and
 * Points of Interest to "What's Nearby" - while their data-view and switch ids
 * stayed put, so the key is the way in when a label is being flaky, and the old
 * labels are still accepted from an older script.
 *
 * "Walk & Bike" is an ampersand and "Map and Summary" is the word, so matching
 * treats the two as the same thing rather than relying on which was written.
 */
function clickTab({ label, key, names }) {
  const tidy = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const wanted = [label].concat(names || []).map(tidy).filter(Boolean);
  const chips = Array.from(
    document.querySelectorAll('.main-tab-item, [data-view], [role="tab"], button[id$="-switch"]')
  );

  // By what it says.
  for (const chip of chips) {
    if (wanted.includes(tidy(chip.innerText))) {
      chip.click();
      return { clicked: true, how: "label" };
    }
  }
  // By the key behind it, which did not change when the labels did.
  if (key) {
    const byKey =
      document.querySelector(`[data-view="${key}"]`) ||
      document.querySelector(`#${key}-switch`) ||
      chips.find((chip) => tidy(chip.getAttribute("data-view")) === tidy(key));
    if (byKey) {
      byKey.click();
      return { clicked: true, how: "key" };
    }
  }
  return {
    clicked: false,
    how: null,
    // What the widget does offer, so a refusal can say.
    offered: chips.map((chip) => (chip.innerText || "").trim()).filter(Boolean).slice(0, 12),
  };
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
  // A script written against the old chip names still walks the right chips.
  const wanted = tabs.map(canonicalTabName).filter((tab) => NE_TABS.includes(tab));
  if (!wanted.length) return { shots: {}, texts: {}, place: "", url: "" };

  const url = widgetUrlFor({ lat, lng });
  const deadline = Date.now() + budgetMs;
  const shots = {};
  // What was written on each tab when it was photographed. Handy for the job log
  // and for checking a tab really loaded its own content.
  const texts = {};
  let browser = null;
  let walkPage = null;
  let place = "";

  try {
    log(`Opening the Neighborhood Explorer for ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    browser = await launchExplorerBrowser();
    const page = await browser.newPage();
    walkPage = page;
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

      const alias = NE_TAB_ALIASES[tab] || { key: "", wasCalled: [] };
      const clicked = await page.evaluate(clickTab, {
        label: tab,
        key: alias.key,
        names: alias.wasCalled,
      });
      if (!clicked.clicked) {
        throw explorerError(
          "EXPLORER_TAB_MISSING",
          `The Neighborhood Explorer has no "${tab}" chip, so that beat cannot be filmed${
            clicked.offered && clicked.offered.length ? `. It offers: ${clicked.offered.join(", ")}` : ""
          }. The script may need updating to match the product.`
        );
      }
      if (clicked.how === "key") log(`Found the ${tab} chip by its id rather than its label`);

      const { text, settled } = await waitForTabContent(page, { previousText, deadline });
      if (!settled) log(`${tab} was still loading, filmed it as it stood`);
      previousText = text;
      texts[tab] = text;

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

    return { shots, texts, place, url };
  } catch (error) {
    /*
     * Photograph the widget as it stood. A refused walk is usually the Explorer
     * showing an empty state or a chip that is not there, and the picture says
     * which far quicker than the message does.
     */
    error.explorerUrl = url;
    error.explorerPlace = place;
    if (walkPage) {
      const shot = path.join(outDir, "explorer-failure.png");
      try {
        await walkPage.screenshot({ path: shot, type: "png", captureBeyondViewport: false });
        error.screenshot = shot;
        log("Saved a picture of the Explorer as it stopped");
      } catch (_) {
        /* nothing to photograph */
      }
    }
    throw error;
  } finally {
    if (browser) await closeBrowser(browser).catch(() => {});
  }
}

module.exports = { captureExplorerTabs, widgetUrlFor, TAB_VIEWPORT, WALK_BUDGET_MS };
