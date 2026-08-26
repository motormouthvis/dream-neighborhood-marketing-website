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

const context = { bgUrl: "file:///site.png", address: { street: "815 Larkspur Lane" }, company: "Patty Realty" };

test("the upgrade script draws School Explorer first, then each tab in turn", async () => {
  const template = await templates.getTemplate("se-to-ne-upgrade");
  const specs = templates.renderBeats(template, { firstName: "Patty", company: "Patty Realty" }).map((beat) => ({
    scene: beat.scene,
    ...specForBeat(beat, context),
  }));

  const cards = specs.filter((spec) => spec.card).map((spec) => spec.card);
  assert.equal(cards[0], "se", "School Explorer is what they already have, so it is on screen first");
  assert.ok(cards.includes("ne"));

  const tabsShown = specs.filter((spec) => spec.card === "ne").map((spec) => NE_TABS[spec.activeTab]);
  assert.deepEqual(tabsShown.slice(0, 7), NE_TABS, "every tab gets its own beat, in the official order");

  // An explorer card takes the place of the popup button rather than sitting
  // next to it.
  assert.ok(specs.filter((spec) => spec.card).every((spec) => spec.hidePopup));
  // The tab strip is always the full seven.
  assert.ok(specs.filter((spec) => spec.card === "ne").every((spec) => spec.tabs.length === 7));
});

test("a beat with no tab of its own still lands on a real tab", () => {
  const spec = specForBeat({ scene: "ne", neTab: null, caption: null }, context);
  assert.equal(spec.activeTab, 0);
  assert.equal(spec.card, "ne");
});

test("the popup tooltip uses the address that was filmed, or says nothing about one", () => {
  assert.equal(tooltipFor({ street: "815 Larkspur Lane" }), "Click here to explore the neighborhood around 815 Larkspur Lane");
  assert.equal(tooltipFor({ street: "" }), "Click here to explore this neighborhood");
  assert.equal(tooltipFor(null), "Click here to explore this neighborhood");
});
