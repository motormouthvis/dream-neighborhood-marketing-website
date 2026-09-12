"use strict";

/*
 * The shipped scripts, and the rules any script has to obey.
 *
 * Creating, editing, duplicating and deleting are not here any more: those
 * happen in the browser now, because keeping them on the Heroku disk is what
 * wiped Bill's work on every deploy. See test/script-store.test.js for that
 * half, and test/script-persistence.test.js for the promise that this side
 * never writes anything.
 *
 * What is here is what the server still owns: the three scripts the repo ships,
 * and cleanTemplate, which is the only thing that decides what a script may
 * contain - wherever it came from.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-templates-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "test-token";

const templates = require("../src/templates");
const { NE_TABS } = require("../src/ne-tabs");

test("the three shipped scripts come out of code, and nothing is written to disk", async () => {
  const list = await templates.listDefaults();
  assert.deepEqual(
    list.map((template) => template.id).sort(),
    ["se-to-ne-upgrade", "vanessa-se-ne-v11", "vanessa-se-only-v11"]
  );
  assert.ok(list.every((template) => template.builtIn));

  // The wipe-on-deploy bug was seeding these onto the dyno's disk. There is no
  // longer anywhere for a deploy to overwrite, because nothing is written.
  assert.equal(fs.existsSync(path.join(dataDir, "templates")), false, "no templates directory is created");
});

test("the school-only script never mentions Neighborhood Explorer", async () => {
  const template = await templates.getDefault("vanessa-se-only-v11");
  assert.equal(template.explorers, "se");
  assert.ok(!template.beats.some((beat) => beat.scene === "ne"));

  const everything = template.beats
    .map((beat) => `${beat.text} ${beat.caption ? `${beat.caption.headline} ${beat.caption.subline}` : ""}`)
    .join(" ");
  assert.ok(!/neighborhood explorer/i.test(everything), "school-only script must not mention Neighborhood Explorer");
});

/*
 * Bill's staging job died on "The Neighborhood Explorer has no 'Mobility' tab
 * any more". No shipped script may ask for a chip the product does not have -
 * not in the chip it pins, not in what the voice says, not in the caption.
 */
test("no shipped script names a chip the product no longer has", async () => {
  for (const template of await templates.listDefaults()) {
    // Captions are off unless a job asks, so they are asked for here: a stale
    // chip name in one still has to be caught for the day somebody turns them on.
    const beats = templates.renderBeats(template, { firstName: "Vanessa", company: "DOMO" }, { showCaptions: true });

    for (const beat of beats) {
      if (beat.scene !== "ne") continue;
      assert.ok(
        NE_TABS.includes(beat.neTabName),
        `${template.id} pins a chip that does not exist: ${JSON.stringify(beat.neTabName)}`
      );
    }

    const written = [
      templates.beatsToText(beats),
      beats.map((beat) => (beat.caption ? `${beat.caption.headline} ${beat.caption.subline}` : "")).join(" "),
    ].join(" ");
    assert.doesNotMatch(written, /Mobility/i, `${template.id} still says Mobility`);
    assert.doesNotMatch(written, /Points of Interest/i, `${template.id} still says Points of Interest`);
  }
});

/*
 * The voice has to name the chip that is on screen while it is said. The chip
 * carries an ampersand because that is what the product draws; the spoken line
 * says "and", because that is how anybody reads it aloud.
 */
test("the voice says Walk and Bike while the Walk & Bike chip is showing", async () => {
  const upgrade = await templates.getDefault("se-to-ne-upgrade");
  const beats = templates.renderBeats(upgrade, { firstName: "Vanessa", company: "DOMO" }, { showCaptions: true });

  const walk = beats.find((beat) => beat.neTabName === "Walk & Bike");
  assert.ok(walk, "the upgrade script walks the Walk & Bike chip");
  assert.match(walk.text, /Walk and Bike/, "the spoken line reads it aloud");
  assert.equal(walk.caption.headline, "Walk & Bike.", "the caption matches the chip");

  const nearby = beats.find((beat) => beat.neTabName === "What's Nearby");
  assert.ok(nearby, "and the What's Nearby chip");
  assert.match(nearby.text, /What's Nearby/);
  assert.equal(nearby.caption.headline, "What's Nearby.");
});

test("a script saved with Bill's spelling points at the same chip", () => {
  const mine = templates.cleanTemplate({
    name: "Bill's spelling",
    explorers: "se-ne",
    beats: [
      { scene: "listing", seconds: 6, text: "Take a look at this one." },
      { scene: "se", seconds: 6, text: "Here it is with School Explorer." },
      { scene: "ne", tab: "Walk and Bike", seconds: 3, text: "Walk and Bike." },
      { scene: "ne", tab: "POI", seconds: 3, text: "What's Nearby." },
    ],
  });

  // Stored under the name the product uses, however it was typed in.
  assert.equal(mine.beats[2].tab, "Walk & Bike");
  assert.equal(mine.beats[3].tab, "What's Nearby");

  const beats = templates.renderBeats(mine, { firstName: "Vanessa", company: "DOMO" });
  const tabs = beats.filter((beat) => beat.scene === "ne").map((beat) => beat.neTabName);
  assert.deepEqual(tabs, ["Walk & Bike", "What's Nearby"]);
});

test("the shipped scripts keep the approved words and the v11 durations", async () => {
  const schoolOnly = await templates.getDefault("vanessa-se-only-v11");
  const spoken = templates.beatsToText(templates.renderBeats(schoolOnly, { firstName: "Vanessa", company: "DOMO" }));
  assert.ok(spoken.startsWith("Hey Vanessa, Claire from Dream Neighborhood. I was looking at DOMO."));
  assert.ok(spoken.includes("You'll save $95 to $800 a month versus other school data providers."));
  assert.ok(spoken.includes("Become not just the home expert, but the school expert as well. Give us a call!"));
  assert.equal(templates.totalSeconds(schoolOnly), 61.7);

  const both = await templates.getDefault("vanessa-se-ne-v11");
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
  const both = await templates.getDefault("vanessa-se-ne-v11");
  const rendered = templates.renderBeats(both, { firstName: "Vanessa", company: "DOMO" });
  const tabs = rendered.filter((beat) => beat.scene === "ne").map((beat) => beat.neTab);
  assert.deepEqual(tabs, [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(rendered.filter((beat) => beat.scene !== "ne").every((beat) => beat.neTab === null));
});

/*
 * Myles cannot reword a spoken line while the old wording is sitting across the
 * top of every frame, and he is the one writing the lines. So the caption is a
 * thing a job asks for, and a script carrying caption text is not the same as a
 * video showing it.
 */
test("a script's captions are not drawn unless the job asks for them", async () => {
  const template = await templates.getDefault("vanessa-se-only-v11");
  assert.ok(
    template.beats.some((beat) => beat.caption && beat.caption.headline),
    "the shipped script still carries caption lines"
  );
  assert.match(template.beats[0].caption.headline, /Your listing format looks really good/);

  // Nobody asked, so nothing is drawn - and this is the default, not a setting.
  const quiet = templates.renderBeats(template, { firstName: "Vanessa", company: "DOMO" });
  for (const beat of quiet) {
    assert.deepEqual(beat.caption, { headline: "", subline: "" }, beat.text.slice(0, 40));
  }
  // The words are still there, which is the point: only the on-screen copy went.
  assert.ok(templates.beatsToText(quiet).includes("Claire from Dream Neighborhood"));

  // And asked for, they come through filled in as they always did.
  const loud = templates.renderBeats(template, { firstName: "Vanessa", company: "DOMO" }, { showCaptions: true });
  assert.equal(loud[0].caption.headline, "Your listing format looks really good.");
});

test("placeholders are filled in, with fallbacks when a field is blank", async () => {
  const template = await templates.getDefault("vanessa-se-only-v11");
  const blank = templates.renderBeats(template, {});
  assert.ok(blank[0].text.startsWith("Hey there, Claire from Dream Neighborhood."));
  assert.ok(blank[0].text.includes("I was looking at your website."));
});

/*
 * A script the browser holds, on its way to being filmed.
 *
 * The browser keeps the only copy, so it posts the whole script with the job.
 * fromBrowser is the door that takes it, and it applies the same validation a
 * shipped script goes through - a hand-edited localStorage entry gets exactly
 * the treatment the Scripts page would have given it.
 */
test("a script the browser sends is tidied and checked like any other", () => {
  const sent = templates.fromBrowser({
    id: "quick-20-second-cut",
    name: "Quick 20 second cut",
    explorers: "se",
    notes: "Trade show version.",
    beats: [
      { scene: "listing", seconds: 6, text: "Hey {firstName}, this is the short one for {company}.", caption: { headline: "Short cut.", subline: "" } },
      { scene: "listing-tap", seconds: 2, text: "She taps the house." },
      { scene: "se", seconds: 6, text: "Schools, right on your site." },
    ],
  });

  assert.equal(sent.id, "quick-20-second-cut");
  assert.equal(sent.builtIn, false, "it is not one of ours, whatever it claims");
  assert.equal(templates.totalSeconds(sent), 14);
  assert.equal(sent.beats.length, 3);
  assert.equal(sent.beats[1].caption, null);
  // The old scene name is understood, so a script written before the three
  // listing looks existed still films.
  assert.equal(sent.beats[1].scene, "listing-button");

  // It arrives as JSON text on the multipart path, and that works too.
  assert.deepEqual(templates.fromBrowser(JSON.stringify(sent)), sent);
});

test("a browser cannot pass its own script off as a shipped one", () => {
  const faked = templates.fromBrowser({
    id: "bills-own",
    name: "Bill's own",
    explorers: "se",
    builtIn: true,
    beats: [{ scene: "listing", seconds: 4, text: "Hello." }],
  });
  assert.equal(faked.builtIn, false);

  // A script sent under a shipped id keeps the badge, because an edited default
  // is what that is - and it is checked exactly the same way.
  const edited = templates.fromBrowser({
    id: "vanessa-se-only-v11",
    name: "School only (v11), Bill's cut",
    explorers: "se",
    beats: [{ scene: "listing", seconds: 4, text: "Hello." }],
  });
  assert.equal(edited.builtIn, true);
  assert.equal(edited.name, "School only (v11), Bill's cut");
});

test("a script the browser sends that breaks a rule is refused, not filmed", () => {
  assert.throws(
    () =>
      templates.fromBrowser({
        id: "sneaky",
        name: "Sneaky",
        explorers: "se",
        beats: [{ scene: "ne", seconds: 3, text: "Neighborhood Explorer." }],
      }),
    /cannot contain a Neighborhood Explorer beat/
  );
  assert.throws(() => templates.fromBrowser(null), /did not come through/);
});

test("the upgrade script opens on School Explorer, then walks every tab in order", async () => {
  const template = await templates.getDefault("se-to-ne-upgrade");
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
  const pinned = templates.cleanTemplate({
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

  const v11 = await templates.getDefault("vanessa-se-ne-v11");
  assert.ok(v11.beats.filter((beat) => beat.scene === "ne").every((beat) => beat.tab === null));
  assert.deepEqual(
    templates.renderBeats(v11, {}).filter((beat) => beat.scene === "ne").map((beat) => beat.neTab),
    [0, 1, 2, 3, 4, 5, 6]
  );
});

test("a tab that does not exist is refused by name", () => {
  assert.throws(
    () =>
      templates.cleanTemplate({
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

test("bad templates are refused with a message a person can act on", () => {
  assert.throws(() => templates.cleanTemplate({ name: "", explorers: "se", beats: [] }), /Give the template a name/);

  assert.throws(
    () => templates.cleanTemplate({ name: "No beats", explorers: "se", beats: [] }),
    /at least one beat/
  );

  assert.throws(
    () =>
      templates.cleanTemplate({
        name: "Bad scene",
        explorers: "se",
        beats: [{ scene: "drone-flyover", seconds: 4, text: "Hello." }],
      }),
    /unknown scene/
  );

  assert.throws(
    () =>
      templates.cleanTemplate({
        name: "Too fast",
        explorers: "se",
        beats: [{ scene: "listing", seconds: 0.1, text: "Hello." }],
      }),
    /suggested duration between/
  );

  assert.throws(
    () =>
      templates.cleanTemplate({
        name: "Sneaky NE",
        explorers: "se",
        beats: [{ scene: "ne", seconds: 3, text: "Neighborhood Explorer." }],
      }),
    /cannot contain a Neighborhood Explorer beat/
  );

  assert.throws(
    () =>
      templates.cleanTemplate({
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
