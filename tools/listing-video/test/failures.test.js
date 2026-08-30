"use strict";

/*
 * When a capture fails, the job has to survive and say why.
 *
 * Bill only ever sees the red box in the browser, and by the time he asks about
 * it the dyno has moved on. So a failed job stays in the library with its error,
 * a picture of the page Chrome actually stopped on is kept beside it, and a line
 * goes into a log the app can list back.
 *
 * There is no Slack from here. This app has no bot token; the log and the
 * failures API are the report.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-failures-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "failures-test-token";

const config = require("../src/config");
const { launch, closeBrowser } = require("../src/browser");
const store = require("../src/store");
const templates = require("../src/templates");
const { renderSilent } = require("../src/render");
const fixture = require("./fixture-site");
const app = require("../server");

const TOOL = "/tools/listing-video";
const noChrome = !config.chromePath;
const options = noChrome ? { skip: "no Chrome or Chromium on this machine" } : {};

/** Run a job that is going to fail, and hand back the job as it was left. */
async function failingJob(routes, { company = "Fixture Realty", listingPath = "" } = {}) {
  const { server, origin } = await fixture.listen(routes);
  const template = await templates.getTemplate("vanessa-se-only-v11");
  const input = {
    templateId: template.id,
    firstName: "Bill",
    company,
    websiteUrl: origin,
    listingUrl: listingPath ? `${origin}${listingPath}` : "",
    customerEmail: "fixture@example.test",
    fromId: "bill",
  };
  const job = await store.createJob({ input, template, beats: templates.renderBeats(template, input) });
  try {
    await renderSilent(job);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  return store.getJob(job.id);
}

/** The tool, signed in, so the API can be called the way the page calls it. */
async function signedIn() {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const signin = await fetch(`${origin}${TOOL}/api/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "failures-test-token" }),
  });
  const cookie = (signin.headers.getSetCookie ? signin.headers.getSetCookie() : [])
    .map((value) => value.split(";")[0])
    .join("; ");
  return {
    origin,
    get: (url) => fetch(`${origin}${url}`, { headers: { cookie } }),
    plain: (url) => fetch(`${origin}${url}`),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test.after(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

test("a failed job stays in the library, with its reason and a picture", options, async () => {
  const job = await failingJob(fixture.WALLED_SITE, { company: "Walled Realty" });

  assert.equal(job.status, "failed");
  assert.match(job.error, /asks for an account/i);
  assert.equal(job.errorCode, "REGISTRATION_WALL");

  // Still listed, rather than quietly thrown away.
  const listed = (await store.listJobs()).map((entry) => entry.id);
  assert.ok(listed.includes(job.id), "a failed job is not deleted");

  const row = store.libraryView(job);
  assert.equal(row.status, "failed");
  assert.match(row.error, /asks for an account/i);
  assert.equal(row.failure.errorCode, "REGISTRATION_WALL");
  assert.equal(row.failure.pageKind, "wall");
  assert.equal(row.failure.hasScreenshot, true);

  // The picture is of the page it stopped on, taken before the browser closed.
  assert.ok(fs.existsSync(job.failure.screenshot), "the screenshot is on disk");
  assert.ok(fs.statSync(job.failure.screenshot).size > 1000, "and it is a real picture");
  assert.ok(
    job.failure.screenshot.startsWith(store.jobDir(job.id)),
    "it lives with the job, so deleting the job takes it too"
  );
});

test("a 403 is written down as a 403, and a refusal that had no status has none", options, async () => {
  const blocked = await failingJob(fixture.FORBIDDEN_SITE, { company: "Forbidden Realty" });
  assert.equal(blocked.failure.errorCode, "SITE_BLOCKED");
  assert.equal(blocked.failure.httpStatus, 403);
  assert.doesNotMatch(blocked.failure.reason, /no page there/i);

  // "No listing found" was not caused by a status, so it does not claim one -
  // the last page to load might have been a 404 on a path we guessed at.
  const nothing = await failingJob(fixture.NO_LISTINGS, { company: "No Listings Realty" });
  assert.equal(nothing.failure.errorCode, "NO_LISTING_FOUND");
  assert.equal(nothing.failure.httpStatus, null);
  assert.equal(nothing.failure.pageKind, "marketing");
});

test("a search page we would not film is recorded as a search page", options, async () => {
  const job = await failingJob(fixture.SEARCH_WITH_NO_LISTINGS, { company: "Search Only Realty" });
  assert.equal(job.failure.errorCode, "SITE_IS_SEARCH_ONLY");
  assert.equal(job.failure.pageKind, "search");
  assert.equal(job.failure.hasScreenshot, undefined, "the job's own record keeps the path, not the flag");
  assert.ok(fs.existsSync(job.failure.screenshot));
});

test("the log lists failures newest first, with what anybody would ask next", async () => {
  const log = store.failureLogPath();
  await fsp.rm(log, { force: true });

  await store.recordFailure({
    jobId: "aaa111",
    firstName: "Bill",
    company: "First Realty",
    websiteUrl: "https://first.test",
    errorCode: "NO_LISTING_FOUND",
    reason: "No single listing page could be found.",
  });
  await store.recordFailure({
    jobId: "bbb222",
    firstName: "Myles",
    company: "Second Realty",
    websiteUrl: "https://second.test",
    listingUrl: "https://second.test/idx/details/listing/b001/9",
    errorCode: "SITE_BLOCKED",
    reason: "That site blocked the capture.",
    httpStatus: 403,
    pageKind: "search",
    pageUrl: "https://second.test/idx/search",
    checked: [{ url: "x" }, { url: "y" }],
    screenshot: "/tmp/nowhere/failure.png",
  });

  const failures = await store.listFailures({ limit: 10 });
  assert.equal(failures.length, 2);
  assert.equal(failures[0].jobId, "bbb222", "newest first");
  assert.equal(failures[1].jobId, "aaa111");

  const newest = failures[0];
  assert.ok(newest.at, "when it happened");
  assert.equal(newest.company, "Second Realty");
  assert.equal(newest.websiteUrl, "https://second.test");
  assert.equal(newest.listingUrl, "https://second.test/idx/details/listing/b001/9");
  assert.equal(newest.httpStatus, 403);
  assert.equal(newest.errorCode, "SITE_BLOCKED");
  assert.equal(newest.pageKind, "search");
  assert.equal(newest.pagesChecked, 2);
  assert.equal(newest.screenshot, "/tmp/nowhere/failure.png");
  assert.equal(newest.stage, "capture");

  // One JSON object per line, so a half-written line costs one record.
  const lines = fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, 2);
  for (const line of lines) JSON.parse(line);
});

test("a long reason is cut to one readable line", async () => {
  const record = await store.recordFailure({
    jobId: "ccc333",
    reason: `x${" y".repeat(400)}`,
  });
  assert.ok(record.reason.length <= 200, `reason was ${record.reason.length} characters`);
  assert.match(record.reason, /\.\.\.$/);
});

test("a half-written line does not break the list", async () => {
  const log = store.failureLogPath();
  await fsp.rm(log, { force: true });
  await store.recordFailure({ jobId: "ddd444", reason: "fine" });
  await fsp.appendFile(log, '{"jobId":"eee555","reason":"cut off mid-w\n', "utf8");
  await store.recordFailure({ jobId: "fff666", reason: "also fine" });

  const failures = await store.listFailures({ limit: 10 });
  assert.deepEqual(failures.map((entry) => entry.jobId), ["fff666", "ddd444"]);
});

test("no failures yet is an empty list, not an error", async () => {
  await fsp.rm(store.failureLogPath(), { force: true });
  assert.deepEqual(await store.listFailures(), []);
});

/* ---------------------------------------------------------------- */
/* the API the tool can poll                                        */
/* ---------------------------------------------------------------- */

test("GET /api/failures needs the password, like everything else", async () => {
  const tool = await signedIn();
  try {
    const refused = await tool.plain(`${TOOL}/api/failures`);
    assert.equal(refused.status, 401);
  } finally {
    await tool.close();
  }
});

test("GET /api/failures lists them newest first, with a URL for the picture", options, async () => {
  await fsp.rm(store.failureLogPath(), { force: true });
  const job = await failingJob(fixture.WALLED_SITE, { company: "Polled Realty" });

  const tool = await signedIn();
  try {
    const response = await tool.get(`${TOOL}/api/failures`);
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.ok(Array.isArray(body.failures));
    const newest = body.failures[0];
    assert.equal(newest.jobId, job.id);
    assert.equal(newest.company, "Polled Realty");
    assert.equal(newest.errorCode, "REGISTRATION_WALL");
    assert.equal(newest.pageKind, "wall");
    assert.ok(newest.at);

    // A URL a browser can open, not a path on the dyno's disk.
    assert.equal(newest.screenshotUrl, `${TOOL}/api/jobs/${job.id}/failure.png`);
    assert.equal(newest.screenshot, undefined, "the absolute path is not handed out");

    const picture = await tool.get(newest.screenshotUrl);
    assert.equal(picture.status, 200);
    assert.match(picture.headers.get("content-type") || "", /image\/png/);
    assert.ok(Number(picture.headers.get("content-length")) > 1000);
  } finally {
    await tool.close();
  }
});

test("the picture needs the password too, and cannot be talked into reading other files", options, async () => {
  const job = await failingJob(fixture.WALLED_SITE, { company: "Guarded Realty" });
  const tool = await signedIn();
  try {
    assert.equal((await tool.plain(`${TOOL}/api/jobs/${job.id}/failure.png`)).status, 401);

    // A job whose recorded screenshot is somewhere else entirely is refused: the
    // route only ever serves a file inside that job's own directory.
    job.failure.screenshot = "/etc/hostname";
    await store.persist(job);
    assert.equal((await tool.get(`${TOOL}/api/jobs/${job.id}/failure.png`)).status, 404);

    assert.equal((await tool.get(`${TOOL}/api/jobs/nosuchjob/failure.png`)).status, 404);
  } finally {
    await tool.close();
  }
});

test("how many come back can be asked for, within reason", async () => {
  await fsp.rm(store.failureLogPath(), { force: true });
  for (let index = 0; index < 5; index += 1) {
    await store.recordFailure({ jobId: `job${index}`, reason: `number ${index}` });
  }
  const tool = await signedIn();
  try {
    const two = await (await tool.get(`${TOOL}/api/failures?limit=2`)).json();
    assert.equal(two.failures.length, 2);
    assert.equal(two.failures[0].jobId, "job4", "newest first");

    // Nonsense and greed both land somewhere sensible rather than erroring.
    const silly = await (await tool.get(`${TOOL}/api/failures?limit=banana`)).json();
    assert.equal(silly.failures.length, 5);
    const greedy = await (await tool.get(`${TOOL}/api/failures?limit=99999`)).json();
    assert.equal(greedy.failures.length, 5);
  } finally {
    await tool.close();
  }
});

/*
 * And it is on the Library card, not only in the log. A failed job is worth
 * keeping precisely because somebody will come back to it later.
 */
test("the Library card says what went wrong and links to the picture", options, async () => {
  const job = await failingJob(fixture.WALLED_SITE, { company: "Shown Realty" });

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const signin = await fetch(`${origin}${TOOL}/api/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "failures-test-token" }),
  });
  const cookie = signin.headers.getSetCookie()[0].split(";")[0];

  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000 });
    await page.setCookie({
      name: cookie.split("=")[0],
      value: cookie.split("=").slice(1).join("="),
      domain: "127.0.0.1",
      path: "/",
    });
    await page.goto(`${origin}${TOOL}`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => window.DNLV && window.DNLV.library, { timeout: 15000 });
    await page.evaluate(() => window.DNLV.library.load());
    await page.waitForFunction(() => document.querySelector(".card__failure"), { timeout: 15000 });

    const shown = await page.evaluate(() => {
      const box = document.querySelector(".card__failure");
      const link = Array.from(box.querySelectorAll("a")).find((anchor) =>
        /failure\.png$/.test(anchor.getAttribute("href") || "")
      );
      return {
        text: box.innerText.replace(/\s+/g, " "),
        pictureHref: link ? link.getAttribute("href") : "",
        pillText: (document.querySelector(".pill--bad") || {}).textContent || "",
      };
    });

    assert.match(shown.text, /did not finish/i);
    assert.match(shown.text, /asks for an account/i);
    assert.match(shown.text, /REGISTRATION_WALL/);
    assert.match(shown.text, /read as wall/);
    assert.equal(shown.pictureHref, `${TOOL}/api/jobs/${job.id}/failure.png`);
    assert.match(shown.pillText, /did not finish/i);

    // And the link really serves the picture.
    const picture = await page.evaluate(async (href) => {
      const response = await fetch(href);
      const blob = await response.blob();
      return { status: response.status, type: blob.type, size: blob.size };
    }, shown.pictureHref);
    assert.equal(picture.status, 200);
    assert.equal(picture.type, "image/png");
    assert.ok(picture.size > 1000);
  } finally {
    await closeBrowser(browser);
    await new Promise((resolve) => server.close(resolve));
  }
});

test("deleting a failed job takes its picture with it", options, async () => {
  const job = await failingJob(fixture.WALLED_SITE, { company: "Tidied Realty" });
  const shot = job.failure.screenshot;
  assert.ok(fs.existsSync(shot));

  await store.deleteJob(job.id);
  assert.equal(fs.existsSync(shot), false, "the job directory went, and the picture with it");

  // The log line stays - it is the record of what happened - but says the
  // picture is gone by way of the job having gone.
  const tool = await signedIn();
  try {
    const body = await (await tool.get(`${TOOL}/api/failures`)).json();
    const mine = body.failures.find((entry) => entry.jobId === job.id);
    assert.ok(mine, "the failure is still in the log");
    assert.equal((await tool.get(mine.screenshotUrl)).status, 404);
  } finally {
    await tool.close();
  }
});
