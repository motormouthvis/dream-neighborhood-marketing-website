"use strict";

/*
 * Filming the real Neighborhood Explorer.
 *
 * The bug this covers: every tab beat used to show the same Map and Summary
 * body, because the card was drawn by us and only the highlighted chip moved.
 * Each beat is now a photograph of that tab in the live product, so the seven
 * shots have to be seven genuinely different pictures.
 *
 * The walk itself needs Chrome and the live Explorer. Those checks skip
 * themselves with a message when either is missing, so the suite still runs
 * offline; the pure parts always run.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-explorer-test-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "test-token";

const config = require("../src/config");
const { captureExplorerTabs, widgetUrlFor } = require("../src/explorer");
const { queriesFor } = require("../src/geocode");
const { NE_TABS } = require("../src/demo-data");

/* ---------------------------------------------------------------- */
/* the bits that need nothing                                       */
/* ---------------------------------------------------------------- */

test("the widget is opened at the listing's own coordinates", () => {
  const url = new URL(widgetUrlFor({ lat: 33.7577337, lng: -118.0939697 }));
  assert.equal(url.origin + url.pathname, config.explorer.widgetUrl.replace(/\/$/, "") + "/");
  assert.equal(url.searchParams.get("lat"), "33.7577337");
  assert.equal(url.searchParams.get("lng"), "-118.0939697");
  // The popup build is the one with the seven tabs; variant=full is one long
  // scrolling report with none.
  assert.equal(url.searchParams.get("popup"), "true");
  assert.equal(url.searchParams.get("partner"), config.explorer.partnerId);
});

test("an address is looked up precisely first, then loosened", () => {
  const queries = queriesFor({ street: "850 E Ocean Boulevard B3", cityState: "Long Beach, CA", zip: "90802" });
  const text = queries.map((entry) => entry.query);

  assert.equal(text[0], "850 E Ocean Boulevard B3, Long Beach, CA 90802");
  // A unit number rarely resolves; the street does.
  assert.ok(text.some((query) => query.startsWith("850 E Ocean Boulevard,")), JSON.stringify(text));
  // Last resorts are the neighborhood and the town, and they are marked as such
  // so the job can say the Explorer was only centred nearby.
  assert.equal(queries[queries.length - 1].precision, "town");
  assert.ok(queries.some((entry) => entry.precision === "neighborhood"));
  assert.ok(queries.every((entry) => entry.query.trim().length > 0));
});

test("with no address there is nothing to look up", () => {
  assert.deepEqual(queriesFor({}), []);
  assert.deepEqual(queriesFor(null), []);
});

/* ---------------------------------------------------------------- */
/* the real walk                                                    */
/* ---------------------------------------------------------------- */

async function explorerReachable() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(config.explorer.widgetUrl, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch (_) {
    return false;
  }
}

const noChrome = !config.chromePath;
let liveSkip = noChrome ? "no Chrome or Chromium on this machine" : null;

test("the seven tabs are seven different pictures of the real product", async (t) => {
  if (!liveSkip && !(await explorerReachable())) liveSkip = "the live Neighborhood Explorer is not reachable";
  if (liveSkip) return t.skip(liveSkip);

  const outDir = await fsp.mkdtemp(path.join(dataDir, "walk-"));
  // Smyrna, GA - the neighborhood in the approved v11 cut.
  const walk = await captureExplorerTabs({
    lat: 33.8574,
    lng: -84.5107,
    tabs: NE_TABS,
    outDir,
    log: () => {},
  });

  assert.deepEqual(Object.keys(walk.shots).sort(), [...NE_TABS].sort(), "one shot per tab");

  const sizes = new Map();
  for (const tab of NE_TABS) {
    const file = walk.shots[tab];
    assert.ok(fs.existsSync(file), `${tab} has no screenshot`);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 20000, `${tab}'s screenshot is suspiciously small (${bytes.length} bytes)`);
    sizes.set(tab, bytes.toString("base64").slice(0, 4000));
  }

  // The whole point of the fix: no two tabs may be the same picture.
  const distinct = new Set(sizes.values());
  assert.equal(distinct.size, NE_TABS.length, `only ${distinct.size} distinct pictures across ${NE_TABS.length} tabs`);
});

test("an address the Explorer cannot place is refused, not faked", async (t) => {
  if (!liveSkip && !(await explorerReachable())) liveSkip = "the live Neighborhood Explorer is not reachable";
  if (liveSkip) return t.skip(liveSkip);

  const outDir = await fsp.mkdtemp(path.join(dataDir, "nowhere-"));
  // The middle of the Pacific: the Explorer has no neighborhood there.
  await assert.rejects(
    () =>
      captureExplorerTabs({
        lat: 0,
        lng: -160,
        tabs: ["Map and Summary"],
        outDir,
        log: () => {},
        budgetMs: 45000,
      }),
    (error) => {
      assert.ok(error.isCaptureRefusal, "it has to be a refusal the job can explain");
      assert.match(error.code, /EXPLORER_/);
      return true;
    }
  );
});

test.after(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});
