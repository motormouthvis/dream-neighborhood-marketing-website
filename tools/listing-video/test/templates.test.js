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

test("first run seeds the two shipped v11 templates", async () => {
  const seeded = await templates.ensureSeeded();
  assert.deepEqual(seeded.sort(), ["vanessa-se-ne-v11", "vanessa-se-only-v11"]);
  assert.ok(fs.existsSync(path.join(dataDir, "templates", "vanessa-se-only-v11.json")));

  const list = await templates.listTemplates();
  assert.equal(list.length, 2);
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

  assert.equal((await templates.listTemplates()).length, 4);

  await templates.deleteTemplate(copy.id);
  await templates.deleteTemplate("quick-20-second-cut");
  assert.equal((await templates.listTemplates()).length, 2);
  assert.ok(!fs.existsSync(path.join(dataDir, "templates", "quick-20-second-cut.json")));
});

test("a deleted shipped template stays deleted until it is asked for back", async () => {
  await templates.deleteTemplate("vanessa-se-only-v11");
  assert.equal((await templates.listTemplates()).length, 1);

  const restored = await templates.restoreDefaults();
  assert.deepEqual(restored.sort(), ["vanessa-se-ne-v11", "vanessa-se-only-v11"]);
  assert.equal((await templates.listTemplates()).length, 2);
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
