"use strict";

/**
 * Filming the real School Explorer.
 *
 * Bill's report from staging: he uploaded a screenshot of a Peoria listing, typed
 * the Peoria address, and the School Explorer in the finished video showed
 * Smyrna, Georgia - "Peoria, IL" nowhere in it, Cobb County School District and
 * Nickajack Elementary instead. The video went out claiming to be about a house
 * in Illinois while showing another state's schools.
 *
 * The reason was that the School Explorer card was not the product at all. It was
 * drawn by us in views/frame.html from a fixed list of Smyrna schools - the
 * neighborhood from the approved reference video - so every video ever made
 * showed those same eight schools whatever address it was about. The
 * Neighborhood Explorer had already been through this and been fixed the same
 * way (src/explorer.js); this is the other half of it.
 *
 * So the live embed is opened at the listing's own address and photographed, the
 * same way the Neighborhood Explorer's tabs are. Nothing here draws a school, a
 * rating or a district, and there is no stand-in to fall back on: an Explorer that
 * will not load its schools is a refusal, because the alternative is a video that
 * is wrong and looks right.
 */

const path = require("path");
const { launchExplorerBrowser, closeBrowser } = require("./browser");
const { scrollPanel } = require("./explorer");
const config = require("./config");

/*
 * The same size and sharpness as the Neighborhood Explorer's shots, because they
 * are the same popup on the same page and the finished video cuts between them.
 * See src/explorer.js for why it is 2x: sixteen-pixel text photographed at one
 * pixel per pixel reads as soft and washed out after H.264.
 */
const SE_VIEWPORT = { width: 1600, height: 700 };
const SE_PIXEL_RATIO = 2;

/*
 * How many pictures the popup is worth.
 *
 * The list is taller than the card, so one still of the top hides most of it.
 * Each School Explorer beat gets its own picture, scrolled a little further down
 * the list, up to this many - enough that a viewer sees there are more schools
 * than fit, without the beat becoming a scroll for its own sake.
 */
const MAX_SE_SHOTS = 3;
const SCROLL_SETTLE_MS = 650;

const LOAD_TIMEOUT_MS = 45000;
const SE_BUDGET_MS = 75000;
const SETTLE_MS = 800;
const READY_MAX_WAIT_MS = 30000;

/*
 * What the embed shows before it has an address: its own front door, with the
 * search box. While this is up there are no schools on screen.
 */
const EMPTY_STATE_RE = /Find the Best Schools in Your New Neighborhood/i;
// What it says when it was given an address it cannot place.
const NO_DATA_RE = /Could not geocode that address|no schools were found nearby/i;
// The schools list, which is the thing the video is about.
const READY_RE = /Schools near you/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function schoolExplorerError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.isCaptureRefusal = true;
  return error;
}

/**
 * The listing address as one line, which is what the embed takes.
 *
 * "6031 N Rosemead Dr, Peoria, IL 61614" - the ZIP after the state with a space,
 * the way an address is written and the way the picker's own descriptions come
 * back, rather than a fourth comma the geocoder has to see past.
 */
function addressLine(address) {
  if (!address) return "";
  if (address.place) return String(address.place);
  const town = [address.cityState, address.zip].filter(Boolean).join(" ").trim();
  return [address.street, town].filter(Boolean).join(", ");
}

/**
 * The embed, at this listing's address.
 *
 * The address and the coordinates are both passed, which is what the popup
 * snippet on a realtor's page does when it has placed the listing itself: the
 * coordinates decide which schools are near, and the address is what the popup
 * says it is showing.
 */
function schoolExplorerUrlFor({ lat, lng, address, accentColor } = {}) {
  const url = new URL(config.schoolExplorer.embedUrl);
  url.searchParams.set("mode", "popup");
  url.searchParams.set("accent", accentColor || config.schoolExplorer.accentColor);

  const line = addressLine(address);
  if (line) url.searchParams.set("address", line);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lng", String(lng));
  }
  return url.toString();
}

/* eslint-disable no-undef */
/**
 * What the embed is showing right now. Runs in the page.
 *
 * The place is read off the location row rather than assumed from what we asked
 * for, so the job log records where the Explorer actually landed - which is the
 * whole thing Bill could not see when it landed in Georgia.
 */
function readSchoolExplorer() {
  const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
  const between = text.match(/\bHome\b\s*(?:[^A-Za-z0-9]+\s*)?(.{3,90}?)\s+Change\b/);
  const nearest = text.match(/(\d+)\s+of\s+(\d+)\s+nearest/);
  return {
    text,
    place: (between && between[1] ? between[1] : "").replace(/^[^A-Za-z0-9]+/, "").trim(),
    // How many schools it found near the address, which no drawing could know.
    nearby: nearest ? Number(nearest[2]) : 0,
  };
}
/* eslint-enable no-undef */

/**
 * Wait until the schools have arrived and stopped changing.
 *
 * "The same twice in a row" is the signal it has finished loading, the same way
 * the Neighborhood Explorer's tabs are judged.
 */
async function waitForSchools(page, { deadline }) {
  let last = "";
  const until = Math.min(Date.now() + READY_MAX_WAIT_MS, deadline);

  while (Date.now() < until) {
    const state = await page.evaluate(readSchoolExplorer).catch(() => null);
    const text = state ? state.text : "";
    if (NO_DATA_RE.test(text)) return { ...state, settled: true, hasSchools: false };
    if (READY_RE.test(text) && !EMPTY_STATE_RE.test(text) && text === last) {
      return { ...state, settled: true, hasSchools: true };
    }
    last = text;
    await sleep(SETTLE_MS);
  }
  return { text: last, place: "", nearby: 0, settled: false, hasSchools: READY_RE.test(last) };
}

/**
 * Open the School Explorer at these coordinates and photograph it.
 *
 * Returns { shots: [pngPath], place, nearby, url }.
 *
 * `shots` asks for one picture per School Explorer beat, so a script with three
 * of them gets three different views of the list rather than the same still held
 * for twenty seconds. Fewer come back when the list is short enough to fit.
 */
async function captureSchoolExplorer({
  lat,
  lng,
  address,
  shots: wanted = MAX_SE_SHOTS,
  outDir,
  log = () => {},
  budgetMs = SE_BUDGET_MS,
  expect = null,
}) {
  const url = schoolExplorerUrlFor({ lat, lng, address });
  const deadline = Date.now() + budgetMs;
  const want = Math.max(1, Math.min(MAX_SE_SHOTS, Number(wanted) || 1));
  const taken = [];
  let browser = null;
  let walkPage = null;
  let place = "";

  try {
    log(`Opening the School Explorer for ${addressLine(address) || `${lat}, ${lng}`}`);
    browser = await launchExplorerBrowser();
    const page = await browser.newPage();
    walkPage = page;
    await page.setViewport({ ...SE_VIEWPORT, deviceScaleFactor: SE_PIXEL_RATIO });
    page.setDefaultNavigationTimeout(LOAD_TIMEOUT_MS);
    page.on("error", () => {});

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
    await page.waitForNetworkIdle({ idleTime: 1200, timeout: 20000 }).catch(() => {});

    const state = await waitForSchools(page, { deadline });
    place = (state.place || "").trim();

    if (NO_DATA_RE.test(state.text || "")) {
      throw schoolExplorerError(
        "SCHOOL_EXPLORER_NO_DATA",
        "The School Explorer could not place that listing's address, so it has no schools to show for it. Check the address and try again."
      );
    }
    if (!state.hasSchools) {
      throw schoolExplorerError(
        "SCHOOL_EXPLORER_WOULD_NOT_LOAD",
        "The School Explorer did not load any schools for that listing's address, so it cannot be filmed. Try again in a minute."
      );
    }

    log(`The School Explorer is showing ${place || "the listing's neighborhood"}${state.nearby ? ` and ${state.nearby} schools nearby` : ""}`);

    /*
     * It landed somewhere other than the town on the form.
     *
     * Said out loud rather than refused: the coordinates came from the Explorer's
     * own geocoder and were already checked against this town, and a listing in
     * an unincorporated area is genuinely named after its neighbour. But this is
     * the exact line that would have shown "Smyrna, GA" for a Peoria listing, so
     * it belongs in the job log where the review can see it.
     */
    if (expect && expect.city && place && !place.toLowerCase().includes(String(expect.city).toLowerCase())) {
      log(`The School Explorer calls this "${place}" rather than ${expect.city} - check it in the review`);
    }

    await page.evaluate(scrollPanel, { to: 0 });
    await sleep(SCROLL_SETTLE_MS);

    for (let shot = 0; shot < want; shot += 1) {
      if (Date.now() > deadline) break;
      const file = path.join(outDir, `se-${shot + 1}.jpg`);
      // JPEG for the same reason the Explorer's tabs are: a 2x screenshot of a
      // page of text is several megabytes as a PNG, on a small dyno.
      await page.screenshot({ path: file, type: "jpeg", quality: 92, captureBeyondViewport: false });
      taken.push(file);

      if (shot === want - 1) break;
      // Move on by most of a panel, so no school card is cut in half across two
      // pictures, and stop as soon as the list will not go any further.
      const moved = await page.evaluate(scrollPanel, { by: 0.8 });
      if (!moved) break;
      await sleep(SCROLL_SETTLE_MS);
    }

    if (!taken.length) {
      throw schoolExplorerError(
        "SCHOOL_EXPLORER_TOO_SLOW",
        "The School Explorer took too long to photograph. Try again."
      );
    }

    log(`Filmed the School Explorer in ${taken.length} ${taken.length === 1 ? "shot" : "shots"}`);
    return { shots: taken, place, nearby: state.nearby || 0, text: state.text || "", url };
  } catch (error) {
    // A picture of the popup as it stood says why far quicker than the message
    // does - an empty front door means it never got the address.
    error.schoolExplorerUrl = url;
    error.schoolExplorerPlace = place;
    if (walkPage && !error.screenshot) {
      const shot = path.join(outDir, "school-explorer-failure.png");
      try {
        await walkPage.screenshot({ path: shot, type: "png", captureBeyondViewport: false });
        error.screenshot = shot;
        log("Saved a picture of the School Explorer as it stopped");
      } catch (_) {
        /* nothing to photograph */
      }
    }
    throw error;
  } finally {
    if (browser) await closeBrowser(browser).catch(() => {});
  }
}

module.exports = {
  captureSchoolExplorer,
  schoolExplorerUrlFor,
  addressLine,
  SE_VIEWPORT,
  SE_PIXEL_RATIO,
  MAX_SE_SHOTS,
  SE_BUDGET_MS,
};
