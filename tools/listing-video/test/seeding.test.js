"use strict";

/*
 * Staging already has a data dir with the two v11 scripts in it and a seed
 * marker that names only those two. A newly shipped default has to turn up
 * there on the next boot, without resurrecting anything somebody deleted.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-seeding-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "test-token";

const templates = require("../src/templates");
const { DEFAULT_TEMPLATES } = require("../src/default-templates");

const templatesDir = path.join(dataDir, "templates");
const marker = path.join(templatesDir, ".seeded.json");

/** A data dir as it looked before the upgrade script existed. */
function pretendOldStagingDir() {
  fs.rmSync(templatesDir, { recursive: true, force: true });
  fs.mkdirSync(templatesDir, { recursive: true });
  const old = ["vanessa-se-only-v11", "vanessa-se-ne-v11"];
  for (const id of old) {
    const template = DEFAULT_TEMPLATES.find((entry) => entry.id === id);
    fs.writeFileSync(
      path.join(templatesDir, `${id}.json`),
      JSON.stringify({ ...template, builtIn: true, createdAt: "2026-08-01T00:00:00.000Z" }, null, 2),
      "utf8"
    );
  }
  fs.writeFileSync(marker, JSON.stringify({ seededAt: "2026-08-01T00:00:00.000Z", ids: old }, null, 2), "utf8");
}

test("an existing staging data dir picks up a newly shipped script", async () => {
  pretendOldStagingDir();
  assert.equal((await templates.listTemplates()).length, 3, "listing seeds on demand too");

  const seeded = await templates.ensureSeeded();
  assert.deepEqual(seeded, [], "the second call has nothing left to do");

  const ids = (await templates.listTemplates()).map((template) => template.id).sort();
  assert.deepEqual(ids, ["se-to-ne-upgrade", "vanessa-se-ne-v11", "vanessa-se-only-v11"]);

  // The two that were already there keep the date they were first written.
  const kept = await templates.getTemplate("vanessa-se-only-v11");
  assert.equal(kept.createdAt, "2026-08-01T00:00:00.000Z");

  // The marker now names all three, so nothing gets offered twice.
  const recorded = JSON.parse(fs.readFileSync(marker, "utf8")).ids.sort();
  assert.deepEqual(recorded, ["se-to-ne-upgrade", "vanessa-se-ne-v11", "vanessa-se-only-v11"]);
});

test("a default deleted after it was seeded is not put back on the next boot", async () => {
  pretendOldStagingDir();
  await templates.ensureSeeded();
  await templates.deleteTemplate("se-to-ne-upgrade");
  assert.equal((await templates.listTemplates()).length, 2);

  assert.deepEqual(await templates.ensureSeeded(), []);
  const ids = (await templates.listTemplates()).map((template) => template.id).sort();
  assert.deepEqual(ids, ["vanessa-se-ne-v11", "vanessa-se-only-v11"]);
});

/*
 * Staging's scripts were written when the chips were called Mobility and Points
 * of Interest. Seeding never overwrites a saved script, so booting has to bring
 * those two names up to date or the voice will name a chip that is not there.
 */
test("a script saved before the chips were renamed is brought up to date on boot", async () => {
  fs.rmSync(templatesDir, { recursive: true, force: true });
  await templates.ensureSeeded();

  // Wind the saved script back to how it read before the rename.
  const file = path.join(templatesDir, "se-to-ne-upgrade.json");
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, "utf8")
      .replace(/Walk & Bike/g, "Mobility")
      .replace(/Walk and Bike/g, "Mobility")
      .replace(/What's Nearby/g, "Points of Interest"),
    "utf8"
  );

  await templates.ensureSeeded();

  const loaded = await templates.getTemplate("se-to-ne-upgrade");
  const tabBeats = loaded.beats.filter((beat) => beat.scene === "ne");
  assert.deepEqual(
    [...new Set(tabBeats.map((beat) => beat.tab))],
    ["Map and Summary", "Demographics", "Schools", "Housing & Market Trends", "Commutes", "Walk & Bike", "What's Nearby"]
  );

  const walkBeat = tabBeats.find((beat) => beat.tab === "Walk & Bike");
  // The chip is an ampersand; the spoken line reads "and", as anybody would.
  assert.equal(walkBeat.caption.headline, "Walk & Bike.");
  assert.match(walkBeat.text, /^Walk and Bike:/);
  assert.doesNotMatch(walkBeat.text, /Mobility/);

  const nearbyBeat = tabBeats.find((beat) => beat.tab === "What's Nearby");
  assert.match(nearbyBeat.text, /^What's Nearby:/);
  assert.doesNotMatch(nearbyBeat.text, /Points of Interest/);

  const asText = templates.beatsToText(loaded.beats);
  assert.doesNotMatch(asText, /Mobility|Points of Interest/);
});

test("a script somebody already reworded by hand is left alone", async () => {
  fs.rmSync(templatesDir, { recursive: true, force: true });
  await templates.ensureSeeded();

  const mine = await templates.createTemplate({
    name: "Bill's own cut",
    explorers: "se-ne",
    beats: [
      { scene: "listing", seconds: 6, text: "Take a look at this one." },
      { scene: "se", seconds: 6, text: "Here it is with the School Explorer." },
      { scene: "ne", tab: "Walk & Bike", seconds: 3, text: "Getting around town, however you travel." },
    ],
  });

  await templates.ensureSeeded();

  const after = await templates.getTemplate(mine.id);
  assert.equal(after.beats[2].text, "Getting around town, however you travel.");
  assert.equal(after.beats[2].tab, "Walk & Bike");
  assert.equal(after.updatedAt, mine.updatedAt, "an untouched script is not rewritten");
});

test("a data dir with no marker at all seeds everything", async () => {
  fs.rmSync(templatesDir, { recursive: true, force: true });
  const seeded = await templates.ensureSeeded();
  assert.deepEqual(seeded.sort(), ["se-to-ne-upgrade", "vanessa-se-ne-v11", "vanessa-se-only-v11"]);
  assert.ok(fs.existsSync(marker));
});
