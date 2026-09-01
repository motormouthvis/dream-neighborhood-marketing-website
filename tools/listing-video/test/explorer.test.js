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

const crypto = require("crypto");
const config = require("../src/config");
const {
  captureExplorerTabs,
  widgetUrlFor,
  TAB_VIEWPORT,
  TAB_PIXEL_RATIO,
  MAX_SHOTS_PER_TAB,
  SINGLE_SHOT_TABS,
} = require("../src/explorer");
const { launchExplorerBrowser, closeBrowser } = require("../src/browser");
const { queriesFor } = require("../src/geocode");
const { NE_TABS, NE_TAB_ALIASES, canonicalTabName } = require("../src/demo-data");

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
  // A ZIP on its own is not something to point the Explorer at either.
  assert.deepEqual(queriesFor({ street: "", cityState: "", zip: "32824" }), []);
});

/*
 * A street with no town used to produce no query at all, and the job died with
 * "The listing page did not give an address to look up" - with the address
 * sitting right there on the page. It is the least trusted query, so it goes
 * last, but a dead end is worse than a loose answer somebody can see on the map.
 */
test("a street with no town is still worth looking up", () => {
  const queries = queriesFor({ street: "14918 Cranes Nest Court", cityState: "", zip: "" });
  assert.ok(queries.length, "a street on its own has to give something to look up");
  assert.equal(queries[queries.length - 1].query, "14918 Cranes Nest Court");
  assert.equal(queries[queries.length - 1].precision, "street-only");

  // With a ZIP as well, the pair is tried before the street alone.
  const withZip = queriesFor({ street: "14918 Cranes Nest Court", cityState: "", zip: "32824" });
  assert.equal(withZip[0].query, "14918 Cranes Nest Court, 32824");
  assert.equal(withZip[withZip.length - 1].precision, "street-only");

  // And when the town is known, street-only is not used at all.
  const full = queriesFor({ street: "14918 Cranes Nest Court", cityState: "Orlando, FL", zip: "32824" });
  assert.equal(full[0].query, "14918 Cranes Nest Court, Orlando, FL 32824");
  assert.ok(!full.some((entry) => entry.precision === "street-only"), JSON.stringify(full));
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

/*
 * The chip labels are matched against the live product, so their spelling is not
 * cosmetic. "Map and Summary" is the word "and"; "Housing & Market Trends" and
 * "Walk & Bike" are ampersands. Mobility was renamed to Walk & Bike and Points
 * of Interest to What's Nearby, and "Ask AI" is not one of the seven.
 */
test("the seven chips are spelled the way the product spells them", () => {
  assert.deepEqual(NE_TABS, [
    "Map and Summary",
    "Demographics",
    "Schools",
    "Housing & Market Trends",
    "Commutes",
    "Walk & Bike",
    "What's Nearby",
  ]);
  assert.equal(NE_TABS.length, 7, "Ask AI is not an eighth chip");
  assert.ok(!NE_TABS.includes("Walk and Bike"), "the chip is an ampersand, not the word and");
  assert.ok(!NE_TABS.some((tab) => /Mobility|Points of Interest/.test(tab)));
});

test("a script written against the old chip names still points at the right chip", () => {
  assert.equal(canonicalTabName("Mobility"), "Walk & Bike");
  assert.equal(canonicalTabName("Points of Interest"), "What's Nearby");
  assert.equal(canonicalTabName("POI"), "What's Nearby");
  // Written either way round, and by the internal key, which did not change.
  assert.equal(canonicalTabName("Walk and Bike"), "Walk & Bike");
  assert.equal(canonicalTabName("Walk & Bike"), "Walk & Bike");
  assert.equal(canonicalTabName("mobility"), "Walk & Bike");
  assert.equal(canonicalTabName("points-of-interest"), "What's Nearby");
  assert.equal(canonicalTabName("Housing and Market Trends"), "Housing & Market Trends");
  assert.equal(canonicalTabName("Map and Summary"), "Map and Summary");
});

test("the internal keys are the ones the product still uses", () => {
  assert.equal(NE_TAB_ALIASES["Walk & Bike"].key, "mobility");
  assert.equal(NE_TAB_ALIASES["What's Nearby"].key, "points-of-interest");
});

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

  assert.deepEqual(Object.keys(walk.shots).sort(), [...NE_TABS].sort(), "every tab is filmed");

  const sizes = new Map();
  for (const tab of NE_TABS) {
    // A tab is filmed in one shot or several, depending on how much it has to
    // show; the first one is the one that has to be its own.
    const files = walk.shots[tab];
    assert.ok(Array.isArray(files) && files.length, `${tab} has no screenshot`);
    const bytes = fs.readFileSync(files[0]);
    assert.ok(bytes.length > 20000, `${tab}'s screenshot is suspiciously small (${bytes.length} bytes)`);
    sizes.set(tab, bytes.toString("base64").slice(0, 4000));
  }

  // The whole point of the fix: no two tabs may be the same picture.
  const distinct = new Set(sizes.values());
  assert.equal(distinct.size, NE_TABS.length, `only ${distinct.size} distinct pictures across ${NE_TABS.length} tabs`);

  // Stronger than comparing pixels, which two tabs could differ on by a stray
  // map tile: what is written on each tab has to be its own content.
  const words = NE_TABS.map((tab) => (walk.texts[tab] || "").replace(NE_TABS.join(" "), "").trim());
  assert.ok(words.every((text) => text.length > 80), "a tab came back with almost nothing on it");
  assert.equal(
    new Set(words).size,
    NE_TABS.length,
    `only ${new Set(words).size} distinct tab bodies:\n${NE_TABS.map((t, i) => `  ${t}: ${words[i].slice(0, 70)}`).join("\n")}`
  );

  // And each one really is the tab it claims to be. These are the phrases the
  // approved Vanessa cut shows on Schools, Commutes and Mobility.
  const signatures = {
    Schools: /nearby schools|public schools/i,
    Commutes: /calculate your commute/i,
    Demographics: /population|education/i,
    "Housing & Market Trends": /housing|market/i,
    // Mobility was renamed to Walk & Bike, Points of Interest to What's Nearby.
    "Walk & Bike": /getting around|walk radius|bike radius/i,
    "What's Nearby": /view route|cafes|restaurants/i,
  };
  for (const [tab, pattern] of Object.entries(signatures)) {
    assert.match(walk.texts[tab] || "", pattern, `the ${tab} tab does not read like ${tab}`);
  }
});

/*
 * The failure Bill hit on staging:
 *
 *   "The Neighborhood Explorer has no 'Mobility' tab any more, so that beat
 *    cannot be filmed."
 *
 * It cannot come back for any of these, because the chip is found by the current
 * label, by what it used to be called, or by the key behind it - and the key did
 * not change with the labels. Staging and production are not always on the same
 * build, so both spellings have to work.
 */
test("no name a script might use brings back the missing-tab failure", async (t) => {
  if (!liveSkip && !(await explorerReachable())) liveSkip = "the live Neighborhood Explorer is not reachable";
  if (liveSkip) return t.skip(liveSkip);

  const naming = {
    "what the product says now": ["Walk & Bike", "What's Nearby"],
    "what Bill wrote": ["Walk and Bike", "What's Nearby"],
    "what they used to be called": ["Mobility", "Points of Interest"],
    "the short form": ["Mobility", "POI"],
  };

  for (const [how, tabs] of Object.entries(naming)) {
    const outDir = await fsp.mkdtemp(path.join(dataDir, "naming-"));
    const walk = await captureExplorerTabs({
      lat: 33.8574,
      lng: -84.5107,
      tabs,
      outDir,
      log: () => {},
    });

    // Whatever they were asked for by, the shots come back under the current
    // names, so the frames and the captions cannot disagree with the product.
    assert.deepEqual(
      Object.keys(walk.shots),
      ["Walk & Bike", "What's Nearby"],
      `asking by ${how} did not reach both chips`
    );
    for (const files of Object.values(walk.shots)) {
      for (const file of files) {
        assert.ok(fs.statSync(file).size > 1000, `${how}: the shot is empty`);
      }
    }
  }
});

test("the chips are named with an ampersand, because that is what the product shows", async (t) => {
  if (!liveSkip && !(await explorerReachable())) liveSkip = "the live Neighborhood Explorer is not reachable";
  if (liveSkip) return t.skip(liveSkip);

  // Read off the live widget rather than trusted from a note, because a chip is
  // clicked by what it says.
  const browser = await launchExplorerBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(widgetUrlFor({ lat: 33.8574, lng: -84.5107 }), {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await page.waitForFunction(() => document.querySelectorAll(".main-tab-item").length > 0, {
      timeout: 30000,
      polling: 500,
    });
    const chips = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".main-tab-item")).map((el) => ({
        label: (el.innerText || "").trim(),
        key: el.getAttribute("data-view") || "",
      }))
    );

    assert.deepEqual(chips.map((chip) => chip.label), NE_TABS, "the live chips are not what NE_TABS says");
    assert.ok(
      chips.some((chip) => chip.label === "Walk & Bike"),
      `the live chip is an ampersand, not the word "and": ${JSON.stringify(chips.map((c) => c.label))}`
    );
    assert.ok(!chips.some((chip) => /Mobility|Points of Interest/.test(chip.label)));

    // The keys behind them did not change when the labels did, which is what
    // makes the fallback safe.
    const keyed = Object.fromEntries(chips.map((chip) => [chip.label, chip.key]));
    assert.equal(keyed["Walk & Bike"], NE_TAB_ALIASES["Walk & Bike"].key);
    assert.equal(keyed["What's Nearby"], NE_TAB_ALIASES["What's Nearby"].key);
  } finally {
    await closeBrowser(browser);
  }
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

/* ---------------------------------------------------------------- */
/* how big and how sharp the popup is                                */
/* ---------------------------------------------------------------- */

/*
 * Bill: on all the tab screens the popup is a little too small, washed out and
 * hard to read.
 *
 * It was taken at 1340x764 at one device pixel per CSS pixel and dropped into a
 * card that size inside a 1920x1080 frame, so sixteen-pixel text stayed sixteen
 * pixels and went soft through H.264.
 */
test("the popup is filmed bigger than the frame it lands in, and at twice the pixels", () => {
  assert.ok(TAB_PIXEL_RATIO >= 2, `taken at ${TAB_PIXEL_RATIO}x, which will not read on a screen`);
  assert.ok(TAB_VIEWPORT.width >= 1500, `only ${TAB_VIEWPORT.width} wide`);

  // The card in the frame template has to be the same shape, or the shot is
  // cropped or letterboxed instead of mapping one to one.
  const frame = fs.readFileSync(path.join(config.root, "views", "frame.html"), "utf8");
  const card = frame.match(/#card\.card--ne\s*\{[^}]*\}/);
  assert.ok(card, "the frame template needs a Neighborhood Explorer card");
  const width = Number((card[0].match(/width:\s*(\d+)px/) || [])[1]);
  const height = Number((card[0].match(/height:\s*(\d+)px/) || [])[1]);

  assert.equal(width, TAB_VIEWPORT.width, "the card is the width the shot is taken at");
  assert.equal(height, TAB_VIEWPORT.height, "and the height");

  // Bigger than the old 1340x764, and still inside a 1920x1080 frame.
  assert.ok(width > 1340, `the card is ${width} wide, which is not bigger than it was`);
  assert.ok(width <= 1920 && height <= 1080 - 112, "it still fits under the caption bar");

  // And it must not cover the house button in the bottom right corner.
  const left = Number((card[0].match(/left:\s*(\d+)px/) || [])[1]);
  assert.ok(left + width < 1920 - 86 - 40, "the card stops short of the house button");
});

test("nothing is faded or tinted over the popup", () => {
  const frame = fs.readFileSync(path.join(config.root, "views", "frame.html"), "utf8");
  const card = (frame.match(/#card\.card--ne\s*\{[^}]*\}/) || [""])[0];
  // No opacity, no filter, no translucent wash on the card itself.
  assert.doesNotMatch(card, /opacity\s*:/, card);
  assert.doesNotMatch(card, /filter\s*:/, card);
  // The scrim over the listing is painted before the card, so it cannot wash it.
  const scrimAt = frame.indexOf('<div id="scrim">');
  const cardAt = frame.indexOf('<div id="card">');
  assert.ok(scrimAt > 0 && cardAt > scrimAt, "the card is painted after the scrim, so it stays crisp");
});

test("What's Nearby is the one tab that is not scrolled", () => {
  assert.ok(SINGLE_SHOT_TABS.has("What's Nearby"), "three places make the point without scrolling");
  assert.ok(MAX_SHOTS_PER_TAB >= 2, "the other tabs get more than one shot when they have more to show");
  for (const tab of NE_TABS) {
    if (tab === "What's Nearby") continue;
    assert.ok(!SINGLE_SHOT_TABS.has(tab), `${tab} should be free to scroll`);
  }
});

test("each tab is filmed in shots of its own sections, and What's Nearby in one", async (t) => {
  if (!liveSkip && !(await explorerReachable())) liveSkip = "the live Neighborhood Explorer is not reachable";
  if (liveSkip) return t.skip(liveSkip);

  const outDir = await fsp.mkdtemp(path.join(dataDir, "sections-"));
  const walk = await captureExplorerTabs({
    lat: 33.8574,
    lng: -84.5107,
    outDir,
    log: () => {},
  });

  // Every tab hands back a list, so a beat can be spread across its sections.
  for (const tab of NE_TABS) {
    const shots = walk.shots[tab];
    assert.ok(Array.isArray(shots), `${tab} should hand back a list of shots`);
    assert.ok(shots.length >= 1 && shots.length <= MAX_SHOTS_PER_TAB, `${tab} gave ${shots.length}`);
    for (const file of shots) {
      assert.ok(fs.statSync(file).size > 5000, `${tab} has an empty shot`);
    }
  }

  // A list does not need scrolling to be read: three places is the point.
  assert.equal(walk.shots["What's Nearby"].length, 1, "What's Nearby is one shot");

  // At least one tab really did scroll, and its shots differ from each other -
  // otherwise this is photographing the top of the tab three times.
  const scrolled = NE_TABS.filter((tab) => (walk.shots[tab] || []).length > 1);
  assert.ok(scrolled.length, `no tab scrolled: ${JSON.stringify(NE_TABS.map((t2) => (walk.shots[t2] || []).length))}`);
  for (const tab of scrolled) {
    const seen = new Set(
      walk.shots[tab].map((file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex"))
    );
    assert.equal(seen.size, walk.shots[tab].length, `${tab} photographed the same section twice`);
  }
});
