"use strict";

/*
 * The regression Bill hit twice: a video built on a marketing homepage.
 *
 * This drives the real capture in real Chrome against test/fixture-site.js,
 * whose homepage is the Fathom Realty page from his last run - hero photo,
 * "Search Long Beach Homes" and "Market Report" buttons, the office address at
 * 2135 Bellflower Blvd in the footer, and a cookie banner that only goes away
 * when Accept is pressed.
 *
 * Starting there, capture has to end up on /listings/123-main-st with the cookie
 * banner gone. Needs Chrome; skipped with a message if there is none.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-capture-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "test-token";

const config = require("../src/config");
const { launch } = require("../src/browser");
const { captureListing } = require("../src/capture");
const { run } = require("../src/exec");
const fixture = require("./fixture-site");

const noChrome = !config.chromePath;
const options = noChrome ? { skip: "no Chrome or Chromium on this machine" } : {};

/** Run one capture against a fixture site and hand back what it found. */
async function capture(routes, { listingUrl = "", explorerRule = "absent" } = {}) {
  const { server, origin } = await fixture.listen(routes);
  const outDir = await fsp.mkdtemp(path.join(dataDir, "shot-"));
  const messages = [];
  let browser;
  try {
    browser = await launch();
    const result = await captureListing({
      browser,
      url: origin,
      listingUrl: listingUrl ? `${origin}${listingUrl}` : "",
      outDir,
      log: (message) => messages.push(message),
      explorerRule,
    });
    return { ...result, origin, messages, error: null };
  } catch (error) {
    return { origin, messages, error };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

test("from a marketing homepage, capture walks to the listing and accepts the cookies", options, async () => {
  const shot = await capture(fixture.ROUTES);
  assert.equal(shot.error, null, shot.error ? `capture refused: ${shot.error.message}` : "");

  // The whole point: not the homepage, not the market report, not the search page.
  assert.equal(
    new URL(shot.pageUrl).pathname,
    "/listings/123-main-st",
    `filmed ${shot.pageUrl} instead of the listing\n${shot.messages.join("\n")}`
  );
  assert.equal(shot.address.street, "123 Main St");
  assert.ok(shot.address.isSubject, "the address has to be the page's own subject, not scraped text");

  // The office address in the footer must never become the listing address.
  assert.notEqual(shot.address.street, "2135 Bellflower Blvd");

  // The homepage was seen and turned down for the right reason.
  const homepage = shot.checked.find((entry) => new URL(entry.url).pathname === "/");
  assert.ok(homepage, `the homepage should have been checked: ${JSON.stringify(shot.checked)}`);
  assert.equal(homepage.kind, "marketing");

  // Cookies were accepted rather than just clicked at.
  assert.ok(
    shot.messages.some((message) => /cookie banner accepted and gone/i.test(message)),
    `expected the cookie banner to be accepted:\n${shot.messages.join("\n")}`
  );

  assert.ok(fs.existsSync(shot.screenshot), "a screenshot was written");
  assert.ok(fs.statSync(shot.screenshot).size > 10000, "the screenshot is not blank");
});

/** Average brightness of a strip of the screenshot, 0 (black) to 255 (white). */
async function stripBrightness(file, crop) {
  const { stdout } = await run(
    config.ffmpegPath,
    ["-v", "error", "-i", file, "-vf", `crop=${crop},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer" }
  );
  const pixel = Buffer.from(stdout, "binary");
  return (pixel[0] + pixel[1] + pixel[2]) / 3;
}

test("no cookie banner is anywhere in the finished frame", options, async () => {
  const shot = await capture(fixture.ROUTES);
  assert.equal(shot.error, null, shot.error ? shot.error.message : "");

  // The fixture's banner is a near-black bar pinned across the bottom of every
  // page. The listing behind it is white there, so the bottom strip of the
  // screenshot says whether the banner made it into the frame. This is also
  // where the house button goes, so it has to be clear.
  const bottom = await stripBrightness(shot.screenshot, "iw:70:0:ih-70");
  assert.ok(bottom > 170, `the bottom of the frame is dark (${bottom.toFixed(0)}/255), so the cookie bar is still in it`);
});

test("a cookie banner that cannot be got rid of is a failed capture, not a bad video", options, async () => {
  const shot = await capture(fixture.UNCLOSEABLE_COOKIES, { listingUrl: "/listings/123-main-st" });
  assert.ok(shot.error, "a banner that survives everything has to stop the capture");
  assert.equal(shot.error.code, "COOKIE_BANNER_IN_THE_WAY");
  assert.match(shot.error.message, /cookie banner/i);
});

test("a pasted listing URL is used as-is, after the cookies are accepted", options, async () => {
  const shot = await capture(fixture.ROUTES, { listingUrl: "/listings/123-main-st" });
  assert.equal(shot.error, null, shot.error ? shot.error.message : "");
  assert.equal(new URL(shot.pageUrl).pathname, "/listings/123-main-st");
  assert.equal(shot.address.street, "123 Main St");
});

test("a pasted homepage is not filmed; capture walks off it to a real listing", options, async () => {
  const shot = await capture(fixture.ROUTES, { listingUrl: "/" });
  assert.equal(shot.error, null, shot.error ? shot.error.message : "");
  assert.equal(new URL(shot.pageUrl).pathname, "/listings/123-main-st");
});

test("a pasted market report is not filmed either", options, async () => {
  const shot = await capture(fixture.ROUTES, { listingUrl: "/market-report" });
  assert.equal(shot.error, null, shot.error ? shot.error.message : "");
  assert.equal(new URL(shot.pageUrl).pathname, "/listings/123-main-st");
});

test("a site with nothing but marketing pages is refused, not rendered", options, async () => {
  const shot = await capture(fixture.NO_LISTINGS);
  assert.ok(shot.error, "a site with no listings has to be refused");
  assert.equal(shot.error.code, "NO_LISTING_FOUND");
  assert.match(shot.error.message, /never used as a stand-in/);
  assert.match(shot.error.message, /Paste one listing URL/);
});

test("the before-and-after scripts skip a listing that already has an Explorer", options, async () => {
  const shot = await capture(fixture.ROUTES, { listingUrl: "/listings/88-ocean-view" });
  assert.ok(shot.error, "88 Ocean View Dr already has our embed on it");
  assert.equal(shot.error.code, "LISTING_HAS_EXPLORER");
});

test("the upgrade script prefers the listing that already has School Explorer", options, async () => {
  const shot = await capture(fixture.ROUTES, { explorerRule: "prefer-present" });
  assert.equal(shot.error, null, shot.error ? shot.error.message : "");
  assert.equal(new URL(shot.pageUrl).pathname, "/listings/88-ocean-view");
  assert.equal(shot.address.street, "88 Ocean View Dr");
});

test.after(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});
