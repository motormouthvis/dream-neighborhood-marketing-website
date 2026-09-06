"use strict";

/*
 * The QUAL account, on a site that puts its listings behind a login.
 *
 * An account wall is a door with a form on it: the site served us a page and
 * that page asks us to log in. Capture used to refuse those outright. With the
 * QUAL account configured it fills the form in, and if that works it opens the
 * listing again and films it.
 *
 * The line these tests are here to hold is what happens with NO account
 * configured, which is every other box and every other test: the wall still
 * stops the capture, nothing is filled in, and no account is invented. And a
 * site that will not accept the password is a refusal, not a hang.
 *
 * None of this touches a 403. There is no form on a page that was never sent,
 * so there is nothing to sign in to - see src/site-account.js.
 *
 * The email and password below are the fixture server's own. They are not
 * credentials for anything.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-account-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "account-test-token";

const config = require("../src/config");
const { launch, closeBrowser } = require("../src/browser");
const { captureListing } = require("../src/capture");
const siteAccount = require("../src/site-account");
const fixture = require("./fixture-site");

const noChrome = !config.chromePath;
const options = noChrome ? { skip: "no Chrome or Chromium on this machine" } : {};

/**
 * Point the QUAL config at the fixture's account for the duration of one test.
 *
 * config is read once at require time, so the test rewrites the live object and
 * puts it back - which also proves the switch is the config and nothing else.
 */
function withQualAccount(account, work) {
  const before = { ...config.qualAccount };
  Object.assign(config.qualAccount, {
    email: "",
    password: "",
    name: "Motormouth QUAL",
    phone: "",
    registerAllowed: false,
    hosts: [],
    ...account,
  });
  return Promise.resolve()
    .then(work)
    .finally(() => Object.assign(config.qualAccount, before));
}

async function capture(routes, { listingUrl = "" } = {}) {
  const { server, origin, hits } = await fixture.listen(routes);
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
    });
    return { ...result, origin, hits, messages, error: null };
  } catch (error) {
    return { origin, hits, messages, error, checked: error.checked || [] };
  } finally {
    if (browser) await closeBrowser(browser);
    await new Promise((resolve) => server.close(resolve));
  }
}

/* ---------------------------------------------------------------- */
/* the switch                                                       */
/* ---------------------------------------------------------------- */

test("with no email and password, the whole thing is off", () => {
  return withQualAccount({}, () => {
    assert.equal(siteAccount.configured(), false);
    assert.equal(siteAccount.allowedOn("anything.test"), false);
    assert.equal(siteAccount.registerAllowedOn("anything.test"), false);
    assert.equal(siteAccount.describe(), "not configured");
  });
});

test("half a credential is not a credential", () => {
  return withQualAccount({ email: "qual@motormouth.com" }, () => {
    assert.equal(siteAccount.configured(), false, "an email with no password is off");
  }).then(() =>
    withQualAccount({ password: "something" }, () => {
      assert.equal(siteAccount.configured(), false, "a password with no email is off");
    })
  );
});

test("an empty host list means any site, and a list is an allowlist", () => {
  return withQualAccount({ email: "qual@motormouth.com", password: "x" }, () => {
    assert.equal(siteAccount.allowedOn("scottrodgersrealestate.com"), true);
  }).then(() =>
    withQualAccount(
      { email: "qual@motormouth.com", password: "x", hosts: ["fathomrealty.test"] },
      () => {
        assert.equal(siteAccount.allowedOn("fathomrealty.test"), true);
        assert.equal(siteAccount.allowedOn("www.fathomrealty.test"), true, "www is the same site");
        assert.equal(siteAccount.allowedOn("idx.fathomrealty.test"), true, "and so is a subdomain of it");
        assert.equal(siteAccount.allowedOn("someone-else.test"), false);
      }
    )
  );
});

/*
 * Registering is what emails a realtor. Signing in to an account that already
 * exists is quiet; creating one on an IDX site is precisely how that site's
 * agent gets a "you have a new lead" notification. So it is its own switch, and
 * it is off until somebody turns it on for a named site.
 */
test("registering is off even when signing in is on", () => {
  return withQualAccount({ email: "qual@motormouth.com", password: "x" }, () => {
    assert.equal(siteAccount.allowedOn("anywhere.test"), true);
    assert.equal(siteAccount.registerAllowedOn("anywhere.test"), false);
    assert.match(siteAccount.describe(), /sign-in only/);
  }).then(() =>
    withQualAccount({ email: "qual@motormouth.com", password: "x", registerAllowed: true }, () => {
      assert.equal(siteAccount.registerAllowedOn("anywhere.test"), true);
      assert.match(siteAccount.describe(), /may register/);
    })
  );
});

test("what gets logged about the account never includes the password", () => {
  return withQualAccount(
    { email: "qual@motormouth.com", password: "hunter2-not-a-real-password", hosts: ["a.test"] },
    () => {
      const said = siteAccount.describe();
      assert.equal(said.includes("hunter2"), false, `the password must not be printed: ${said}`);
      assert.match(said, /qual@motormouth\.com/);
      assert.match(said, /a\.test/);
    }
  );
});

/* ---------------------------------------------------------------- */
/* the wall itself                                                  */
/* ---------------------------------------------------------------- */

test("with no account configured, a login wall is still the end of the capture", options, async () => {
  const shot = await withQualAccount({}, () => capture(fixture.LOGIN_WALL_SITE));
  assert.ok(shot.error, "a wall with no key has to stop the capture");
  assert.equal(shot.error.code, "REGISTRATION_WALL");
  // Nothing was filled in and nothing was posted.
  assert.equal(shot.hits["/account/login"], undefined, "no login was attempted");
  assert.equal(shot.hits["/account/register"], undefined, "and certainly no account was created");
});

test("with the QUAL account, capture signs in and films the listing behind it", options, async () => {
  const shot = await withQualAccount(
    { email: fixture.ACCOUNT.email, password: fixture.ACCOUNT.password },
    () => capture(fixture.LOGIN_WALL_SITE, { listingUrl: "/listings/123-main-st" })
  );

  assert.equal(shot.error, null, shot.error ? shot.error.message : "");
  assert.equal(new URL(shot.pageUrl).pathname, "/listings/123-main-st");
  assert.equal(shot.address.street, "123 Main St");

  // It signed in rather than registering.
  assert.equal(shot.account.how, "signin");
  assert.ok(shot.hits["/account/login"] >= 1, "the sign-in form was actually posted");
  assert.equal(shot.hits["/account/register"], undefined, "no account was created");

  /*
   * The video has to say so. A page a signed-in visitor sees is not always the
   * page the public sees, and whoever reviews this should know which they have.
   */
  assert.match(shot.notes.join(" "), /signed in with the QUAL account/i);
  assert.match(shot.notes.join(" "), /looks the way a visitor's would/i);
});

test("a site that will not accept the password is a refusal, not a hang", options, async () => {
  const shot = await withQualAccount(
    { email: fixture.ACCOUNT.email, password: "the-wrong-password" },
    () => capture(fixture.LOGIN_WALL_REFUSES, { listingUrl: "/listings/123-main-st" })
  );

  assert.ok(shot.error, "a door that stays shut is still shut");
  assert.equal(shot.error.code, "REGISTRATION_WALL");
  // It says the key was tried and did not turn, which is a different problem to
  // there being no key at all.
  assert.match(shot.error.message, /QUAL account could not get past it/i);
  // And the way through that does not depend on their site is offered.
  assert.match(shot.error.message, /upload a screenshot/i);
});

test("the QUAL account is not used on a site it was not switched on for", options, async () => {
  const shot = await withQualAccount(
    { email: fixture.ACCOUNT.email, password: fixture.ACCOUNT.password, hosts: ["somebody-else.test"] },
    () => capture(fixture.LOGIN_WALL_SITE, { listingUrl: "/listings/123-main-st" })
  );

  assert.ok(shot.error, "the host was not on the list, so the wall stands");
  assert.equal(shot.error.code, "REGISTRATION_WALL");
  assert.equal(shot.hits["/account/login"], undefined, "nothing was posted to a site it is not switched on for");
});

/*
 * The honest limit, written down as a test so it cannot quietly stop being true.
 *
 * A 403 is bot protection refusing to send the page. There is no form on a page
 * that was never sent, so the QUAL account cannot help, and it must not be tried
 * either - posting credentials at a site that is already refusing us would be
 * the worst of both.
 */
test("a 403 is not an account wall, so the QUAL account is not tried on one", options, async () => {
  const shot = await withQualAccount(
    { email: fixture.ACCOUNT.email, password: fixture.ACCOUNT.password },
    () => capture(fixture.DETAIL_URL_SITE_FORBIDDEN, { listingUrl: fixture.ROSEMEAD_PATH })
  );

  assert.ok(shot.error);
  assert.equal(shot.error.code, "SITE_BLOCKED");
  assert.equal(shot.hits["/account/login"], undefined, "there is no form on a page that was never served");
  // What actually works there is named instead.
  assert.match(shot.error.message, /upload a screenshot/i);
});
