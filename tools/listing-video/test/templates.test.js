"use strict";

/* Templates are the thing Bill and Myles edit, so load/save/duplicate/delete
   and the two shipped v11 scripts are checked here. */

const os = require("os");
const path = require("path");
const fs = require("fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-templates-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "test-token";

const templates = require("../src/templates");

test("first run seeds all three shipped templates", async () => {
  const seeded = await templates.ensureSeeded();
  assert.deepEqual(seeded.sort(), ["se-to-ne-upgrade", "vanessa-se-ne-v11", "vanessa-se-only-v11"]);
  assert.ok(fs.existsSync(path.join(dataDir, "templates", "vanessa-se-only-v11.json")));
  assert.ok(fs.existsSync(path.join(dataDir, "templates", "se-to-ne-upgrade.json")));

  const list = await templates.listTemplates();
  assert.equal(list.length, 3);
  assert.ok(list.every((template) => template.builtIn));
});

test("the school-only script never mentions Neighborhood Explorer", async () => {
  const template = await templates.getTemplate("vanessa-se-only-v11");
  assert.equal(template.explorers, "se");
  assert.ok(!template.beats.some((beat) => beat.scene === "ne"));

  const everything = template.beats
    .map((beat) => `${beat.text} ${beat.caption ? `${beat.caption.headline} ${beat.caption.subline}` : ""}`)
    .join(" ");
  assert.ok(!/neighborhood explorer/i.test(everything), "school-only script must not mention Neighborhood Explorer");
});

test("the shipped scripts keep the approved words and the v11 durations", async () => {
  const schoolOnly = await templates.getTemplate("vanessa-se-only-v11");
  const spoken = templates.beatsToText(templates.renderBeats(schoolOnly, { firstName: "Vanessa", company: "DOMO" }));
  assert.ok(spoken.startsWith("Hey Vanessa, Claire from Dream Neighborhood. I was looking at DOMO."));
  assert.ok(spoken.includes("You'll save $95 to $800 a month versus other school data providers."));
  assert.ok(spoken.includes("Become not just the home expert, but the school expert as well. Give us a call!"));
  assert.equal(templates.totalSeconds(schoolOnly), 61.7);

  const both = await templates.getTemplate("vanessa-se-ne-v11");
  assert.equal(both.explorers, "se-ne");
  assert.equal(templates.totalSeconds(both), 65.4);

  const neBeats = both.beats.filter((beat) => beat.scene === "ne");
  assert.equal(neBeats.length, 7, "seven Neighborhood Explorer tab beats");
  assert.ok(neBeats.every((beat) => beat.seconds === 2.6));

  // School Explorer is always the first explorer on screen.
  const firstExplorer = both.beats.find((beat) => beat.scene === "se" || beat.scene === "ne");
  assert.equal(firstExplorer.scene, "se");
});

test("Neighborhood Explorer beats get the tabs in order", async () => {
  const both = await templates.getTemplate("vanessa-se-ne-v11");
  const rendered = templates.renderBeats(both, { firstName: "Vanessa", company: "DOMO" });
  const tabs = rendered.filter((beat) => beat.scene === "ne").map((beat) => beat.neTab);
  assert.deepEqual(tabs, [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(rendered.filter((beat) => beat.scene !== "ne").every((beat) => beat.neTab === null));
});

test("placeholders are filled in, with fallbacks when a field is blank", async () => {
  const template = await templates.getTemplate("vanessa-se-only-v11");
  const blank = templates.renderBeats(template, {});
  assert.ok(blank[0].text.startsWith("Hey there, Claire from Dream Neighborhood."));
  assert.ok(blank[0].text.includes("I was looking at your website."));
});

test("a third custom script can be created, edited, duplicated and deleted", async () => {
  const created = await templates.createTemplate({
    name: "Quick 20 second cut",
    explorers: "se",
    notes: "Trade show version.",
    beats: [
      { scene: "listing", seconds: 6, text: "Hey {firstName}, this is the short one for {company}.", caption: { headline: "Short cut.", subline: "" } },
      { scene: "listing-tap", seconds: 2, text: "She taps the house." },
      { scene: "se", seconds: 6, text: "Schools, right on your site." },
    ],
  });
  assert.equal(created.id, "quick-20-second-cut");
  assert.equal(created.builtIn, false);
  assert.equal(templates.totalSeconds(created), 14);

  const reloaded = await templates.getTemplate("quick-20-second-cut");
  assert.equal(reloaded.beats.length, 3);
  assert.equal(reloaded.beats[1].caption, null);

  const edited = await templates.updateTemplate("quick-20-second-cut", {
    ...reloaded,
    name: "Quick cut, renamed",
    beats: reloaded.beats.map((beat, index) => (index === 0 ? { ...beat, seconds: 7.5 } : beat)),
  });
  assert.equal(edited.id, "quick-20-second-cut", "renaming keeps the id every video refers to");
  assert.equal(edited.name, "Quick cut, renamed");
  assert.equal(edited.beats[0].seconds, 7.5);

  const copy = await templates.duplicateTemplate("quick-20-second-cut");
  assert.equal(copy.id, "quick-cut-renamed-copy");
  assert.equal(copy.name, "Quick cut, renamed copy");

  assert.equal((await templates.listTemplates()).length, 5);

  await templates.deleteTemplate(copy.id);
  await templates.deleteTemplate("quick-20-second-cut");
  assert.equal((await templates.listTemplates()).length, 3);
  assert.ok(!fs.existsSync(path.join(dataDir, "templates", "quick-20-second-cut.json")));
});

test("a deleted shipped template stays deleted, even across another boot", async () => {
  await templates.deleteTemplate("vanessa-se-only-v11");
  assert.equal((await templates.listTemplates()).length, 2);

  // Booting again must not quietly put it back.
  assert.deepEqual(await templates.ensureSeeded(), []);
  assert.equal((await templates.listTemplates()).length, 2);

  const restored = await templates.restoreDefaults();
  assert.deepEqual(restored.sort(), ["se-to-ne-upgrade", "vanessa-se-ne-v11", "vanessa-se-only-v11"]);
  assert.equal((await templates.listTemplates()).length, 3);
});

test("the upgrade script opens on School Explorer, then walks every tab in order", async () => {
  const template = await templates.getTemplate("se-to-ne-upgrade");
  assert.equal(template.explorers, "se-ne");
  // This one is pitched at customers who already have School Explorer, so the
  // listing it films is allowed to have it.
  assert.equal(template.listingExplorer, "prefer-present");
  assert.equal(templates.totalSeconds(template), 60);

  const beats = templates.renderBeats(template, { firstName: "Patty", company: "Patty Realty" });

  // School Explorer is what they have today, so it is on screen first.
  const firstExplorer = beats.find((beat) => beat.scene === "se" || beat.scene === "ne");
  assert.equal(firstExplorer.scene, "se");

  const spoken = templates.beatsToText(beats);
  assert.ok(spoken.startsWith("Hey Patty, Claire from Dream Neighborhood. I was looking at Patty Realty."));
  assert.ok(spoken.includes("You already have School Explorer on your listings."));
  assert.ok(spoken.includes("the same button upgrades to Neighborhood Explorer. No new install."));
  assert.ok(spoken.includes("Become not just the school expert, but the neighborhood expert as well. Give us a call!"));

  // Every tab gets a beat, in the official order.
  const tabBeats = beats.filter((beat) => beat.scene === "ne");
  const walked = tabBeats.slice(0, 7);
  assert.deepEqual(walked.map((beat) => beat.neTabName), [
    "Map and Summary",
    "Demographics",
    "Schools",
    "Housing & Market Trends",
    "Commutes",
    "Walk & Bike",
    "What's Nearby",
  ]);
  assert.deepEqual(walked.map((beat) => beat.neTab), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(walked.every((beat) => beat.seconds >= 2.5 && beat.seconds <= 3.5));

  // The words name the tab that is on screen while they are said.
  for (const beat of walked) {
    const spokenTab = beat.text.split(":")[0].replace(/&/g, "and");
    assert.equal(
      spokenTab.toLowerCase(),
      beat.neTabName.replace(/&/g, "and").toLowerCase(),
      `beat "${beat.text}" should be showing ${beat.neTabName}`
    );
  }

  // The closing beats stay on the last tab rather than jumping somewhere new.
  assert.ok(tabBeats.slice(7).every((beat) => beat.neTabName === "What's Nearby"));
});

test("a beat can pin its Neighborhood Explorer tab, and the v11 script still runs in order", async () => {
  const pinned = await templates.createTemplate({
    name: "Tabs out of order",
    explorers: "se-ne",
    beats: [
      { scene: "se", seconds: 3, text: "Schools first." },
      { scene: "ne", seconds: 3, text: "Commutes.", tab: "Commutes" },
      { scene: "ne", seconds: 3, text: "Housing and market trends.", tab: "Housing and Market Trends" },
      { scene: "ne", seconds: 3, text: "Back to the map." },
    ],
  });
  // "and" instead of "&" is accepted and stored as the official tab name.
  assert.equal(pinned.beats[2].tab, "Housing & Market Trends");

  const beats = templates.renderBeats(pinned, {});
  assert.deepEqual(
    beats.filter((beat) => beat.scene === "ne").map((beat) => beat.neTabName),
    // The pinned ones win; the unpinned one falls back to its place in the order.
    ["Commutes", "Housing & Market Trends", "Schools"]
  );

  // A tab on a beat that is not a Neighborhood Explorer beat is meaningless.
  assert.equal(beats[0].neTab, null);
  await templates.deleteTemplate(pinned.id);

  const v11 = await templates.getTemplate("vanessa-se-ne-v11");
  assert.ok(v11.beats.filter((beat) => beat.scene === "ne").every((beat) => beat.tab === null));
  assert.deepEqual(
    templates.renderBeats(v11, {}).filter((beat) => beat.scene === "ne").map((beat) => beat.neTab),
    [0, 1, 2, 3, 4, 5, 6]
  );
});

test("a tab that does not exist is refused by name", async () => {
  await assert.rejects(
    () =>
      templates.createTemplate({
        name: "Made up tab",
        explorers: "se-ne",
        beats: [
          { scene: "se", seconds: 3, text: "Schools." },
          { scene: "ne", seconds: 3, text: "Crime scores.", tab: "Crime" },
        ],
      }),
    /names a Neighborhood Explorer tab that does not exist/
  );
});

test("bad templates are refused with a message a person can act on", async () => {
  await assert.rejects(() => templates.createTemplate({ name: "", explorers: "se", beats: [] }), /Give the template a name/);

  await assert.rejects(
    () => templates.createTemplate({ name: "No beats", explorers: "se", beats: [] }),
    /at least one beat/
  );

  await assert.rejects(
    () =>
      templates.createTemplate({
        name: "Bad scene",
        explorers: "se",
        beats: [{ scene: "drone-flyover", seconds: 4, text: "Hello." }],
      }),
    /unknown scene/
  );

  await assert.rejects(
    () =>
      templates.createTemplate({
        name: "Too fast",
        explorers: "se",
        beats: [{ scene: "listing", seconds: 0.1, text: "Hello." }],
      }),
    /suggested duration between/
  );

  await assert.rejects(
    () =>
      templates.createTemplate({
        name: "Sneaky NE",
        explorers: "se",
        beats: [{ scene: "ne", seconds: 3, text: "Neighborhood Explorer." }],
      }),
    /cannot contain a Neighborhood Explorer beat/
  );

  await assert.rejects(
    () =>
      templates.createTemplate({
        name: "NE before SE",
        explorers: "se-ne",
        beats: [
          { scene: "ne", seconds: 3, text: "Neighborhood first." },
          { scene: "se", seconds: 3, text: "Schools second." },
        ],
      }),
    /School Explorer has to be shown before/
  );
});
