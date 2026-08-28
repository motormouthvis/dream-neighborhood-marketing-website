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
const { specForBeat, tooltipFor } = require("../src/frames");
const { NE_TABS } = require("../src/demo-data");

/** A screenshot for every tab, as the Explorer walk hands them over. */
const explorerShots = Object.fromEntries(
  NE_TABS.map((tab) => [tab, `/tmp/shots/${tab.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`])
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
