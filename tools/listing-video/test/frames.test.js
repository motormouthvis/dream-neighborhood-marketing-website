"use strict";

/* What each beat asks the frame template to draw. */

const os = require("os");
const path = require("path");
const fs = require("fs");
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.LISTING_VIDEO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-frames-"));
process.env.LISTING_VIDEO_TOKEN = "test-token";

const templates = require("../src/templates");
const { specForBeat, specsForBeat, spreadDurations, tooltipFor } = require("../src/frames");
const { NE_TABS } = require("../src/demo-data");

/** A screenshot for every tab, as the Explorer walk hands them over. */
const explorerShots = Object.fromEntries(
  NE_TABS.map((tab) => {
    const slug = tab.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    // What's Nearby is one shot on purpose; the others may be scrolled.
    const count = tab === "What's Nearby" ? 1 : 3;
    return [tab, Array.from({ length: count }, (_, i) => `/tmp/shots/${slug}-${i + 1}.jpg`)];
  })
);
const context = {
  bgUrl: "file:///site.png",
  address: { street: "815 Larkspur Lane" },
  company: "Patty Realty",
  explorerShots,
};

test("every Neighborhood Explorer beat draws the real screenshot of its own tab", async () => {
  const template = await templates.getTemplate("se-to-ne-upgrade");
  const beats = templates.renderBeats(template, { firstName: "Patty", company: "Patty Realty" });
  const specs = beats.map((beat) => ({ scene: beat.scene, tab: beat.neTabName, ...specForBeat(beat, context) }));

  const cards = specs.filter((spec) => spec.card).map((spec) => spec.card);
  assert.equal(cards[0], "se", "School Explorer is what they already have, so it is on screen first");
  assert.ok(cards.includes("ne"));

  // The body of each tab beat is that tab's own photograph. This is the bug:
  // every beat used to get the same drawn Map and Summary card.
  const neSpecs = specs.filter((spec) => spec.card === "ne");
  const walked = neSpecs.slice(0, 7);
  assert.deepEqual(walked.map((spec) => spec.tab), NE_TABS, "every tab gets its own beat, in the official order");
  for (const spec of walked) {
    assert.ok(spec.tabImage.startsWith("file://"), `${spec.tab} needs a real screenshot`);
    assert.ok(
      spec.tabImage.includes(spec.tab.replace(/[^a-z0-9]+/gi, "-").toLowerCase()),
      `${spec.tab} is showing ${spec.tabImage}`
    );
  }
  assert.equal(new Set(walked.map((spec) => spec.tabImage)).size, 7, "seven tabs, seven different pictures");

  // An explorer card takes the place of the popup button rather than sitting
  // next to it.
  assert.ok(specs.filter((spec) => spec.card).every((spec) => spec.hidePopup));
});

test("a tab beat with no screenshot is refused rather than drawn from stand-in data", () => {
  assert.throws(
    () => specForBeat({ scene: "ne", neTabName: "Commutes", caption: null }, { ...context, explorerShots: {} }),
    /no Neighborhood Explorer screenshot for the "Commutes" tab/
  );
});

test("the popup tooltip uses the address that was filmed, or says nothing about one", () => {
  assert.equal(tooltipFor({ street: "815 Larkspur Lane" }), "Click here to explore the neighborhood around 815 Larkspur Lane");
  assert.equal(tooltipFor({ street: "" }), "Click here to explore this neighborhood");
  assert.equal(tooltipFor(null), "Click here to explore this neighborhood");
});

/* ---------------------------------------------------------------- */
/* how the upgrade video is filmed                                  */
/* ---------------------------------------------------------------- */

/*
 * Bill: on the upgrade video the Neighborhood Explorer button is never seen.
 *
 * The line about the same button upgrading used to play over a School Explorer
 * card, which covers the button - so the button the line is about was never on
 * screen, and the popup arrived from nowhere.
 */
test("the house button is in frame right before the first Neighborhood Explorer popup", async () => {
  const template = await templates.getTemplate("se-to-ne-upgrade");
  const beats = templates.renderBeats(template, { firstName: "Vanessa", company: "DOMO Realty" });

  const firstPopup = beats.findIndex((beat) => beat.scene === "ne");
  assert.ok(firstPopup > 0, "there is a popup to lead into");

  const before = beats[firstPopup - 1];
  assert.equal(before.scene, "listing-tap", "the beat before the popup shows the button being pressed");

  // The words are the ones that were approved; only the scene changed.
  assert.match(before.text, /the same button upgrades to Neighborhood Explorer/i);

  // And that beat really draws the button, uncovered.
  const spec = specForBeat(before, context);
  assert.equal(spec.tapping, true, "the button is shown being tapped");
  assert.equal(spec.hidePopup, false, "and it is not hidden");
  assert.equal(spec.card, null, "nothing is drawn over it");
  assert.ok(spec.tooltip, "with its tooltip beside it");
});

test("a tab beat is worth one still per shot of that tab", () => {
  const beat = { scene: "ne", neTabName: "Schools", seconds: 3 };
  const specs = specsForBeat(beat, context);

  assert.equal(specs.length, 3, "Schools was filmed in three shots, so it is three stills");
  for (const spec of specs) {
    assert.equal(spec.card, "ne");
    assert.equal(spec.hidePopup, true);
  }
  // Each still is a different shot: the tab scrolled between them.
  const drawn = specs.map((spec) => spec.tabImage);
  assert.equal(new Set(drawn).size, 3, JSON.stringify(drawn));
});

test("What's Nearby is one still, because three places make the point", () => {
  const specs = specsForBeat({ scene: "ne", neTabName: "What's Nearby", seconds: 3 }, context);
  assert.equal(specs.length, 1, "a long list is not scrolled through");
});

test("a beat with no shot for its tab is still refused", () => {
  assert.throws(
    () => specsForBeat({ scene: "ne", neTabName: "Schools" }, { ...context, explorerShots: {} }),
    /no Neighborhood Explorer screenshot/i
  );
  // An empty list counts as no shot.
  assert.throws(
    () => specsForBeat({ scene: "ne", neTabName: "Schools" }, { ...context, explorerShots: { Schools: [] } }),
    /no Neighborhood Explorer screenshot/i
  );
});

test("every other scene is still one still", () => {
  for (const scene of ["listing", "listing-tap", "se"]) {
    assert.equal(specsForBeat({ scene, seconds: 4 }, context).length, 1, scene);
  }
});

/*
 * A beat worth three stills shares its seconds between them, so scrolling a tab
 * does not change how long the scene lasts or push the voice out of time.
 */
test("a beat's seconds are shared out across its own stills", () => {
  // Beat 0 is one still, beat 1 is three, beat 2 is two.
  const frameBeats = [0, 1, 1, 1, 2, 2];
  const perStill = spreadDurations([6, 3, 5], frameBeats);

  assert.deepEqual(perStill, [6, 1, 1, 1, 2.5, 2.5]);
  assert.equal(
    perStill.reduce((sum, value) => sum + value, 0),
    14,
    "the total length of the video does not change"
  );
});

test("a job made before tabs were scrolled still lines up", () => {
  // No mapping recorded, so the stills are one per beat as they used to be.
  assert.deepEqual(spreadDurations([4, 5, 6], undefined), [4, 5, 6]);
  assert.deepEqual(spreadDurations([4, 5, 6], []), [4, 5, 6]);
});
