"use strict";

/*
 * The server's half of "deploys stop wiping Bill's scripts".
 *
 * The browser keeps the scripts now (test/script-store.test.js). This is the
 * other side of that promise: the server must not write scripts anywhere, must
 * not delete the ones already on the box, and must accept a script the browser
 * posts with a job - because that is the only copy there is.
 *
 * These drive the real HTTP routes.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-persist-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "persist-token";

const templates = require("../src/templates");
const app = require("../server");

const TOOL = "/tools/listing-video";
const templatesDir = path.join(dataDir, "templates");

let origin = null;
let cookie = null;
let server = null;

test.before(async () => {
  server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  origin = `http://127.0.0.1:${server.address().port}`;

  const signin = await fetch(`${origin}${TOOL}/api/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "persist-token" }),
  });
  cookie = signin.headers.getSetCookie()[0].split(";")[0];
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

function call(method, url, body) {
  return fetch(`${origin}${TOOL}${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json", cookie } : { cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function json(method, url, body) {
  const response = await call(method, url, body);
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

/** Every file under the data dir, so a write anywhere shows up. */
function everythingOnDisk() {
  const out = [];
  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dataDir, full));
    }
  };
  if (fs.existsSync(dataDir)) walk(dataDir);
  return out.sort();
}

/* ---------------------------------------------------------------- */
/* the server ships defaults and keeps nothing                       */
/* ---------------------------------------------------------------- */

test("the templates route serves the shipped scripts and writes nothing", async () => {
  const before = everythingOnDisk();

  const listed = await json("GET", "/api/templates");
  assert.equal(listed.status, 200);
  assert.deepEqual(
    listed.body.templates.map((template) => template.id).sort(),
    ["se-to-ne-upgrade", "vanessa-se-ne-v11", "vanessa-se-only-v11"]
  );
  assert.equal(listed.body.storage, "browser", "and it says where custom ones live");
  // Whole scripts, so the editor can open a shipped one without a second call.
  assert.ok(listed.body.templates.every((template) => Array.isArray(template.beats) && template.beats.length));

  assert.deepEqual(everythingOnDisk(), before, "listing the scripts wrote nothing");
});

test("there is no route left that writes, edits or deletes a script", async () => {
  const gone = [
    ["POST", "/api/templates"],
    ["PUT", "/api/templates/vanessa-se-only-v11"],
    ["DELETE", "/api/templates/vanessa-se-only-v11"],
    ["POST", "/api/templates/vanessa-se-only-v11/duplicate"],
    // This one is the reason for the whole exercise: one button that rewrote
    // every shipped script on the box, for everybody, in one go.
    ["POST", "/api/templates-restore-defaults"],
  ];

  for (const [method, url] of gone) {
    const response = await call(method, url, {});
    assert.equal(response.status, 404, `${method} ${url} is still there`);
  }
});

test("boot does not create a templates directory to be wiped later", async () => {
  // Seeding onto the dyno's disk was the whole mechanism of the bug: it wrote
  // the shipped scripts to a disk that a deploy replaces, so "seed what is
  // missing" meant "seed everything, every time".
  assert.equal(fs.existsSync(templatesDir), false);
  await json("GET", "/api/templates");
  await json("GET", "/api/templates/se-to-ne-upgrade");
  assert.equal(fs.existsSync(templatesDir), false);
});

/* ---------------------------------------------------------------- */
/* validation still belongs to the server                            */
/* ---------------------------------------------------------------- */

test("a script is checked before the browser keeps it, and comes back tidy", async () => {
  const checked = await json("POST", "/api/templates-validate", {
    id: "bills-cut",
    name: "  Bill's cut  ",
    explorers: "se",
    beats: [
      { scene: "listing", seconds: 6, text: "  Here is your listing   today.  " },
      { scene: "listing-tap", seconds: 2, text: "She taps the house." },
      { scene: "se", seconds: 5, text: "Schools, right on your site." },
    ],
  });

  assert.equal(checked.status, 200);
  assert.equal(checked.body.template.name, "Bill's cut");
  assert.equal(checked.body.template.beats[0].text, "Here is your listing today.");
  assert.equal(checked.body.template.beats[1].scene, "listing-button", "the old scene name is understood");
  assert.equal(checked.body.template.builtIn, false);
  assert.equal(checked.body.summary.beatCount, 3);
  assert.equal(checked.body.totalSeconds, 13);
});

test("a script that breaks a rule is refused with something Bill can act on", async () => {
  const refused = await json("POST", "/api/templates-validate", {
    id: "sneaky",
    name: "Sneaky",
    explorers: "se",
    beats: [{ scene: "ne", seconds: 3, text: "Neighborhood Explorer." }],
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /cannot contain a Neighborhood Explorer beat/);

  const nameless = await json("POST", "/api/templates-validate", { name: "", explorers: "se", beats: [] });
  assert.equal(nameless.status, 400);
  assert.match(nameless.body.error, /Give the template a name/);
});

test("validating a script does not save it anywhere", async () => {
  const before = everythingOnDisk();
  await json("POST", "/api/templates-validate", {
    id: "not-kept",
    name: "Not kept",
    explorers: "se",
    beats: [{ scene: "listing", seconds: 4, text: "Hello." }],
  });
  assert.deepEqual(everythingOnDisk(), before);

  const listed = await json("GET", "/api/templates");
  assert.ok(!listed.body.templates.some((template) => template.id === "not-kept"));
});

/* ---------------------------------------------------------------- */
/* the scripts that were already on the box                          */
/* ---------------------------------------------------------------- */

/*
 * Staging has a dyno with Bill's scripts on its disk right now. The move to the
 * browser must not be the thing that finally loses them, so they are readable
 * and importable - and nothing here deletes them.
 */
test("scripts already on this box are offered as an import, and left alone", async () => {
  await fsp.mkdir(templatesDir, { recursive: true });
  const his = {
    id: "bills-staging-script",
    name: "Bill's staging script",
    explorers: "se-ne",
    listingExplorer: "absent",
    notes: "Written on staging months ago.",
    createdAt: "2026-07-04T00:00:00.000Z",
    beats: [
      { scene: "listing", seconds: 6, text: "Here is your listing today." },
      { scene: "se", seconds: 5, text: "Schools, right on your site." },
      // Written before the chips were renamed, as the staging ones were.
      { scene: "ne", tab: "Mobility", seconds: 3, text: "Mobility: getting around." },
    ],
  };
  const file = path.join(templatesDir, "bills-staging-script.json");
  await fsp.writeFile(file, JSON.stringify(his, null, 2), "utf8");
  const asWritten = await fsp.readFile(file, "utf8");

  const found = await json("GET", "/api/legacy-templates");
  assert.equal(found.status, 200);

  const mine = found.body.templates.find((template) => template.id === "bills-staging-script");
  assert.ok(mine, "his script is offered");
  assert.equal(mine.name, "Bill's staging script");
  assert.equal(mine.createdAt, "2026-07-04T00:00:00.000Z");
  // Brought up to date on the way out, because the product renamed those chips
  // and a script naming one the voice cannot point at is a broken script.
  assert.equal(mine.beats[2].tab, "Walk & Bike");
  assert.match(mine.beats[2].text, /Walk and Bike/);
  assert.ok(found.body.importable.includes("bills-staging-script"));

  // And the file is exactly as it was. This code deleting Bill's scripts is the
  // failure this whole change exists to end.
  assert.equal(await fsp.readFile(file, "utf8"), asWritten);
});

test("a shipped script sitting on disk untouched is not offered as a duplicate", async () => {
  await fsp.mkdir(templatesDir, { recursive: true });
  const shipped = templates.getDefault("vanessa-se-only-v11");
  await fsp.writeFile(
    path.join(templatesDir, "vanessa-se-only-v11.json"),
    JSON.stringify(shipped, null, 2),
    "utf8"
  );

  const found = await json("GET", "/api/legacy-templates");
  const seeded = found.body.templates.find((template) => template.id === "vanessa-se-only-v11");
  assert.equal(seeded.matchesShipped, true, "it is the shipped one, so importing it would only clutter the browser");
  assert.ok(!found.body.importable.includes("vanessa-se-only-v11"));
});

test("a file nobody can parse is skipped rather than taking the list down", async () => {
  await fsp.mkdir(templatesDir, { recursive: true });
  await fsp.writeFile(path.join(templatesDir, "broken.json"), "{ this is not json", "utf8");

  const found = await json("GET", "/api/legacy-templates");
  assert.equal(found.status, 200);
  assert.ok(found.body.templates.some((template) => template.id === "bills-staging-script"));
  assert.ok(!found.body.templates.some((template) => template.id === "broken"));
  // Still on disk for somebody to look at.
  assert.ok(fs.existsSync(path.join(templatesDir, "broken.json")));
});

/* ---------------------------------------------------------------- */
/* making a video from a script only the browser has                 */
/* ---------------------------------------------------------------- */

const customer = {
  firstName: "Bill",
  company: "Scott Rodgers Real Estate",
  websiteUrl: "https://example.com",
  customerEmail: "bill@example.com",
};

test("a job can be started from a script the browser is holding", async () => {
  const template = {
    id: "bills-own",
    name: "Bill's own",
    explorers: "se",
    listingExplorer: "absent",
    beats: [
      { scene: "listing", seconds: 6, text: "Here is your listing today." },
      { scene: "listing-button", seconds: 3, text: "And here it is with the button." },
      { scene: "se", seconds: 5, text: "Schools, right on your site." },
    ],
  };

  const started = await json("POST", "/api/jobs", { ...customer, templateId: template.id, template });
  assert.equal(started.status, 202, JSON.stringify(started.body));

  const job = await json("GET", `/api/jobs/${started.body.id}`);
  assert.equal(job.body.template.id, "bills-own");
  assert.equal(job.body.template.name, "Bill's own");
  assert.deepEqual(
    job.body.beats.map((beat) => beat.scene),
    ["listing", "listing-button", "se"],
    "the job carries the script it was made from, so the render never needs to look it up"
  );
});

test("a script the browser sends is validated before anything is filmed", async () => {
  const refused = await json("POST", "/api/jobs", {
    ...customer,
    templateId: "hand-edited",
    template: {
      id: "hand-edited",
      name: "Hand edited",
      explorers: "se",
      beats: [{ scene: "ne", seconds: 3, text: "Neighborhood Explorer." }],
    },
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /cannot contain a Neighborhood Explorer beat/);
});

test("a script that arrives mangled says so rather than failing a minute later", async () => {
  const refused = await json("POST", "/api/jobs", {
    ...customer,
    templateId: "bills-own",
    template: "{ half a script",
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /did not come through in one piece/);
});

test("a shipped script is still started by id alone", async () => {
  const started = await json("POST", "/api/jobs", { ...customer, templateId: "vanessa-se-only-v11" });
  assert.equal(started.status, 202, JSON.stringify(started.body));

  const job = await json("GET", `/api/jobs/${started.body.id}`);
  assert.equal(job.body.template.id, "vanessa-se-only-v11");
  assert.equal(job.body.template.name, "School only (v11)");
});

test("an id nothing ships, with no script attached, is a clear refusal", async () => {
  const refused = await json("POST", "/api/jobs", { ...customer, templateId: "was-in-another-browser" });
  assert.equal(refused.status, 404);
  assert.match(refused.body.error, /no script template called/i);
});
