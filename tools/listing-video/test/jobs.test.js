"use strict";

/* Jobs on disk: created, listed in the library, and deleted for good. */

const os = require("os");
const path = require("path");
const fs = require("fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-jobs-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "test-token";

const store = require("../src/store");
const templates = require("../src/templates");
const mail = require("../src/mail");
const { normalizeUrl } = require("../src/capture");

async function makeJob(overrides = {}) {
  const template = await templates.getTemplate(overrides.templateId || "vanessa-se-only-v11");
  const input = {
    firstName: "Vanessa",
    company: "DOMO Realty",
    websiteUrl: "https://example.test/",
    listingUrl: "",
    // A fixture address on a reserved test domain: nothing here ever sends mail.
    customerEmail: "fixture@example.test",
    templateId: template.id,
    fromId: "marketing",
    ...overrides.input,
  };
  return store.createJob({ input, template, beats: templates.renderBeats(template, input) });
}

test("a job is written to disk with its beats baked in", async () => {
  const job = await makeJob();
  assert.equal(job.status, "queued");
  assert.equal(job.review.reviewed, false);
  assert.equal(job.template.id, "vanessa-se-only-v11");
  assert.equal(job.beats.length, job.template.beatCount);
  assert.ok(job.beats[0].text.includes("Vanessa"));
  assert.ok(fs.existsSync(path.join(store.jobDir(job.id), "job.json")));

  const reloaded = await store.getJob(job.id);
  assert.equal(reloaded.id, job.id);
});

test("the library lists jobs newest first and hides server paths", async () => {
  const first = await makeJob();
  const second = await makeJob({ input: { firstName: "Bill", company: "Second Co" } });
  second.createdAt = new Date(Date.now() + 60000).toISOString();
  await store.persist(second);

  const listed = await store.listJobs();
  const ids = listed.map((job) => job.id);
  assert.ok(ids.indexOf(second.id) < ids.indexOf(first.id));

  const row = store.libraryView(second);
  assert.equal(row.firstName, "Bill");
  assert.equal(row.templateName, "School only (v11)");
  assert.equal(row.hasVideo, false);
  assert.equal(row.emailSent, false);

  const view = store.publicView(second);
  assert.equal(JSON.stringify(view).includes(dataDir), false, "no server file paths in what the browser gets");
});

test("deleting a job removes its files, so the watch page has nothing to serve", async () => {
  const job = await makeJob();
  const dir = store.jobDir(job.id);
  const mp4 = path.join(dir, "video.mp4");
  fs.writeFileSync(mp4, "not really an mp4");
  assert.ok(fs.existsSync(mp4));

  assert.equal(await store.deleteJob(job.id), true);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.existsSync(mp4), false);
  assert.equal(await store.getJob(job.id), null);
  assert.equal(await store.deleteJob(job.id), false);

  const remaining = await store.listJobs();
  assert.ok(!remaining.some((entry) => entry.id === job.id));
});

test("a review has to be recorded before anything can be sent", async () => {
  const job = await makeJob();
  assert.equal(job.review.reviewed, false);
  await store.markReviewed(job, "played");
  assert.equal(job.review.reviewed, true);
  assert.equal(job.review.how, "played");
  assert.ok(job.review.at);
});

test("the email copy only mentions Neighborhood Explorer when the script did", async () => {
  const schoolOnly = await makeJob();
  const draft = mail.buildEmail({ job: schoolOnly, watchUrl: "https://staging.test/v/abc" });
  assert.ok(draft.text.includes("https://staging.test/v/abc"));
  assert.ok(draft.subject.includes("Vanessa"));
  assert.ok(!/Neighborhood Explorer/i.test(draft.text));

  const both = await makeJob({ templateId: "vanessa-se-ne-v11" });
  const draftBoth = mail.buildEmail({ job: both, watchUrl: "https://staging.test/v/def" });
  assert.ok(/Neighborhood Explorer/i.test(draftBoth.text));
});

test("with no SMTP set, sending refuses instead of pretending", async () => {
  assert.equal(mail.mailStatus().connected, false);
  const job = await makeJob();
  await assert.rejects(
    () => mail.sendVideoEmail({ job, fromId: "marketing", watchUrl: "https://staging.test/v/abc", to: "fixture@example.test" }),
    (error) => error.code === "MAIL_NOT_CONNECTED"
  );
});

test("website addresses are tidied up, and rubbish is rejected", () => {
  assert.equal(normalizeUrl("domorealty.com"), "https://domorealty.com/");
  assert.equal(normalizeUrl(" http://domorealty.com/listings "), "http://domorealty.com/listings");
  assert.throws(() => normalizeUrl(""), /required/);
  assert.throws(() => normalizeUrl("ftp://domorealty.com"), /http or https/);
});
