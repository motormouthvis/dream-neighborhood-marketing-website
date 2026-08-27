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
const { launch, closeBrowser } = require("../src/browser");
const { captureListing, CAPTURE_BUDGET_MS, MAX_LISTING_VIEWS, JUNK_HOSTS, DISMISS_LABELS } = require("../src/capture");
const { run } = require("../src/exec");
const fixture = require("./fixture-site");

const noChrome = !config.chromePath;
const options = noChrome ? { skip: "no Chrome or Chromium on this machine" } : {};

/** Run one capture against a fixture site and hand back what it found. */
async function capture(routes, { listingUrl = "", explorerRule = "absent", budgetMs } = {}) {
  const { server, origin, hits } = await fixture.listen(routes);
  const outDir = await fsp.mkdtemp(path.join(dataDir, "shot-"));
  const messages = [];
  const startedAt = Date.now();
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
      ...(budgetMs ? { budgetMs } : {}),
    });
    return { ...result, origin, hits, messages, error: null, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    // A refusal carries what it looked at, so a test can check it stopped early.
    return { origin, hits, messages, error, checked: error.checked || [], elapsedMs: Date.now() - startedAt };
  } finally {
    if (browser) await closeBrowser(browser);
    await new Promise((resolve) => server.close(resolve));
  }
}

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

test("a sign-up form that appears after the page settles is cleared before the shot", options, async () => {
  // The listing here throws up "Create Your Free Account" over a dimming
  // backdrop 1.5s in, and again on scroll. Loading the photos scrolls the page,
  // so checking for popups only once was not enough.
  const shot = await capture(fixture.LEAD_CAPTURE, { listingUrl: "/listings/123-main-st" });
  assert.equal(shot.error, null, shot.error ? shot.error.message : "");
  assert.equal(new URL(shot.pageUrl).pathname, "/listings/123-main-st");

  // The backdrop dims the whole page, so the middle of the frame being bright
  // is proof neither it nor the form is in the picture.
  const middle = await stripBrightness(shot.screenshot, "iw/2:ih/3:iw/4:ih/3");
  assert.ok(middle > 150, `the middle of the frame is dark (${middle.toFixed(0)}/255), so the sign-up form is in it`);
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

test("the upgrade script takes the one listing it opens and adds School Explorer", options, async () => {
  // It used to hunt for a listing that already had School Explorer on it, which
  // meant opening several. Only one listing may be opened now, so it takes that
  // one and says School Explorer was drawn on for the opening shot.
  const shot = await capture(fixture.ROUTES, { explorerRule: "prefer-present" });
  assert.equal(shot.error, null, shot.error ? shot.error.message : "");
  assert.equal(shot.checked.filter((entry) => entry.kind === "detail").length, 1);
  assert.ok(shot.address.street, "it still knows which house it filmed");
  assert.ok(
    shot.notes.join(" ").includes("does not have School Explorer on it yet") || shot.pageUrl.includes("88-ocean-view"),
    `expected either the listing with School Explorer, or a note that it was added: ${JSON.stringify(shot.notes)}`
  );
});

test("a pasted listing that already has School Explorer suits the upgrade script", options, async () => {
  const shot = await capture(fixture.ROUTES, {
    explorerRule: "prefer-present",
    listingUrl: "/listings/88-ocean-view",
  });
  assert.equal(shot.error, null, shot.error ? shot.error.message : "");
  assert.equal(new URL(shot.pageUrl).pathname, "/listings/88-ocean-view");
  assert.deepEqual(shot.notes, [], "nothing was added; that listing already has it");
});

/* ---------------------------------------------------------------- */
/* the budget, and letting go of Chrome                             */
/* ---------------------------------------------------------------- */

test("the capture budget is a minute, and only one listing is ever opened", () => {
  assert.equal(CAPTURE_BUDGET_MS, 60000);
  // The number that matters: IDX sites count listing views and put up an
  // account wall after a few.
  assert.equal(MAX_LISTING_VIEWS, 1);
});

/* ---------------------------------------------------------------- */
/* the IDX account wall                                             */
/* ---------------------------------------------------------------- */

test("an account wall stops the capture instead of being worked around", options, async () => {
  const shot = await capture(fixture.WALLED_SITE);
  assert.ok(shot.error, "a registration wall has to stop the capture");
  assert.equal(shot.error.code, "REGISTRATION_WALL");
  assert.equal(
    shot.error.message,
    "This site asks for an account after a few listing views. Paste a listing URL."
  );

  // It stopped at the wall rather than trying the next listing.
  const walls = shot.checked.filter((entry) => entry.kind === "wall");
  assert.equal(walls.length, 1, `opened ${walls.length} walled pages; one is enough to know`);
  assert.ok(
    shot.messages.some((message) => /wants an account/i.test(message)),
    `expected the log to say so:\n${shot.messages.join("\n")}`
  );
});

test("a pasted URL that is behind the wall is refused, not filled in", options, async () => {
  const shot = await capture(fixture.WALL_OVER_LISTING, { listingUrl: "/listings/123-main-st" });
  assert.ok(shot.error);
  assert.equal(shot.error.code, "REGISTRATION_WALL");
});

test("only one listing is opened when starting from the homepage", options, async () => {
  const shot = await capture(fixture.ROUTES);
  assert.equal(shot.error, null, shot.error ? shot.error.message : "");

  const listings = shot.checked.filter((entry) => entry.kind === "detail");
  assert.equal(listings.length, 1, `opened ${listings.length} listings: ${JSON.stringify(listings.map((l) => l.url))}`);
});

test("a pasted listing is filmed without following any more listing links", options, async () => {
  const shot = await capture(fixture.ROUTES, { listingUrl: "/listings/123-main-st" });
  assert.equal(shot.error, null, shot.error ? shot.error.message : "");
  assert.equal(new URL(shot.pageUrl).pathname, "/listings/123-main-st");

  // One page opened, full stop. No index, no second listing.
  assert.equal(shot.checked.length, 1, `checked ${JSON.stringify(shot.checked.map((c) => c.url))}`);
  const pagesFetched = Object.keys(shot.hits).filter(
    (path) => path !== "/photo.svg" && path !== "/favicon.ico"
  );
  assert.deepEqual(pagesFetched, ["/listings/123-main-st"]);
});

test("a slow site runs out of budget and is refused, not waited on forever", options, async () => {
  // Every candidate here takes three seconds, so a four second budget has to
  // stop the crawl rather than the page count.
  const shot = await capture(fixture.SLOW_SITE, { budgetMs: 4000 });

  assert.ok(shot.error, "a site that cannot be searched in time has to be refused");
  assert.equal(shot.error.code, "CAPTURE_TIMED_OUT");
  assert.match(shot.error.message, /paste one listing url/i);

  // The point of the budget: it gives up in seconds, not the three-plus minutes
  // that let Chrome grow past a gigabyte.
  assert.ok(shot.elapsedMs < 30000, `capture took ${Math.round(shot.elapsedMs / 1000)}s, which is not a budget`);

  // And it said so as it went, so the wait is never silent.
  assert.ok(
    shot.messages.some((message) => /could not find a listing in time/i.test(message)),
    `expected the log to say it ran out of time:\n${shot.messages.join("\n")}`
  );
});

test("progress keeps moving while it looks", options, async () => {
  const shot = await capture(fixture.ROUTES);
  assert.equal(shot.error, null, shot.error ? shot.error.message : "");

  const expected = [/^Opening /i, /looking for one of their listing pages/i, /^Checking /i, /^Filmed /i];
  for (const pattern of expected) {
    assert.ok(
      shot.messages.some((message) => pattern.test(message)),
      `no progress line matching ${pattern}:\n${shot.messages.join("\n")}`
    );
  }
  // Something to read every few seconds, not one line for the whole minute.
  assert.ok(shot.messages.length >= 5, `only ${shot.messages.length} progress lines`);
  assert.ok(shot.tookSeconds <= 60, `capture reported ${shot.tookSeconds}s`);
});

test("a browser that will not close is killed", async () => {
  // Chrome that has just run out of memory does not answer close(), and a leaked
  // one on a small dyno is the next crash.
  const child = { killed: false, exitCode: null, kill() { child.killed = true; } };
  const wedged = { close: () => new Promise(() => {}), process: () => child };

  const how = await closeBrowser(wedged, { graceMs: 60 });
  assert.equal(how, "killed");
  assert.equal(child.killed, true, "the Chrome process has to actually be killed");
});

test("closing a real browser leaves no Chrome behind", options, async () => {
  const browser = await launch();
  const child = browser.process();
  assert.ok(child && child.pid, "a real Chrome process");

  const how = await closeBrowser(browser);
  assert.match(how, /closed|killed/);

  // Nothing answering on that pid any more.
  let alive = true;
  for (let attempt = 0; attempt < 40 && alive; attempt += 1) {
    try {
      process.kill(child.pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (_) {
      alive = false;
    }
  }
  assert.equal(alive, false, "Chrome is still running after closeBrowser");
});

test("photos are not downloaded while hunting, only for the shot", options, async () => {
  const shot = await capture(fixture.ROUTES);
  assert.equal(shot.error, null, shot.error ? shot.error.message : "");

  // Three pages are opened on the way to the listing, and the listing carries
  // four photos. With images blocked during the crawl, the only page that pays
  // for them is the one that gets photographed.
  const pagesOpened = Object.keys(shot.hits).filter((path) => path !== "/photo.svg").length;
  assert.ok(pagesOpened >= 3, `expected a crawl, saw ${pagesOpened} pages`);

  const photoHits = shot.hits["/photo.svg"] || 0;
  assert.ok(photoHits >= 1, "the page being photographed must load its photos");
  assert.ok(
    photoHits <= 4,
    `photos were fetched ${photoHits} times; they should only load for the final screenshot, not on every page`
  );

  // And the classifier still saw the photos, even with them blocked.
  const listing = shot.checked.find((entry) => new URL(entry.url).pathname === "/listings/123-main-st");
  assert.equal(listing.kind, "detail");
});

test("nothing we click could advance a registration form", () => {
  // We do not create accounts and we do not fill forms in, so no label we press
  // may be a step in one. "Continue" was in this list and is now not.
  for (const label of [
    "Continue",
    "Next",
    "Submit",
    "Create an account",
    "Create Account",
    "Sign up",
    "Sign in",
    "Register",
    "Log in",
    "Yes, create my account",
  ]) {
    assert.equal(DISMISS_LABELS.test(label), false, `"${label}" must never be clicked`);
  }
  // The ones that genuinely close things still work.
  for (const label of ["Accept all cookies", "Close", "No thanks", "Dismiss", "Not now", "Got it"]) {
    assert.equal(DISMISS_LABELS.test(label), true, `"${label}" should still be pressed`);
  }
});

test("analytics and session recording are blocked, consent tools are not", () => {
  for (const host of [
    "https://www.googletagmanager.com/gtm.js",
    "https://static.hotjar.com/c/hotjar-1.js",
    "https://cdn.mouseflow.com/projects/x.js",
    "https://www.google-analytics.com/analytics.js",
  ]) {
    assert.ok(JUNK_HOSTS.test(host), `${host} should be blocked`);
  }
  // Blocking these would leave a cookie banner half drawn and unacceptable.
  for (const host of [
    "https://cdn.cookielaw.org/scripttemplates/otSDKStub.js",
    "https://consent.cookiebot.com/uc.js",
    "https://cmp.osano.com/x/osano.js",
    "https://cdn.iubenda.com/cs/cs.js",
    "https://cdn.cookieyes.com/client_data/x/script.js",
  ]) {
    assert.equal(JUNK_HOSTS.test(host), false, `${host} must not be blocked`);
  }
});

test.after(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});
