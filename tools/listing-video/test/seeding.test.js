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

test("a data dir with no marker at all seeds everything", async () => {
  fs.rmSync(templatesDir, { recursive: true, force: true });
  const seeded = await templates.ensureSeeded();
  assert.deepEqual(seeded.sort(), ["se-to-ne-upgrade", "vanessa-se-ne-v11", "vanessa-se-only-v11"]);
  assert.ok(fs.existsSync(marker));
});
