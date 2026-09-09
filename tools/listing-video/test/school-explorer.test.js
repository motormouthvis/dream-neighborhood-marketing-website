"use strict";

/*
 * Filming the real School Explorer.
 *
 * The bug this covers is Bill's: he uploaded a screenshot of a listing at 6031 N
 * Rosemead Dr, Peoria, IL, typed that address, and the finished video's School
 * Explorer showed "Smyrna, GA - Cobb County School District" with Nickajack
 * Elementary and Griffin Middle in it. It was not the wrong address - the card was
 * not the product at all. It was drawn by us from a fixed list of the schools in
 * the approved reference video, so every video ever made showed that same
 * district whatever address it was about.
 *
 * Now the beat is a photograph of the live School Explorer opened at the
 * listing's own address, the same way the Neighborhood Explorer's tabs already
 * were. The live checks skip themselves with a message when Chrome or the
 * Explorer is missing, so the suite still runs offline; the pure parts always run.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-se-test-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "test-token";

const config = require("../src/config");
const {
  captureSchoolExplorer,
  schoolExplorerUrlFor,
  addressLine,
  SE_VIEWPORT,
  SE_PIXEL_RATIO,
  MAX_SE_SHOTS,
} = require("../src/school-explorer");

/* Bill's listing. */
const ROSEMEAD = { street: "6031 N Rosemead Dr", cityState: "Peoria, IL", zip: "61614" };
const ROSEMEAD_POINT = { lat: 40.76117841579057, lng: -89.61833048148893 };

/* ---------------------------------------------------------------- */
/* the bits that need nothing                                       */
/* ---------------------------------------------------------------- */

test("the School Explorer is opened at the listing's own address", () => {
  const url = new URL(schoolExplorerUrlFor({ ...ROSEMEAD_POINT, address: ROSEMEAD }));

  assert.equal(url.origin + url.pathname, config.schoolExplorer.embedUrl);
  // The popup build, which is what a realtor's page opens from the house button.
  assert.equal(url.searchParams.get("mode"), "popup");
  // The address is what the popup says it is showing; the coordinates are what
  // decide which schools are near. The realtor's own snippet passes both.
  assert.equal(url.searchParams.get("address"), "6031 N Rosemead Dr, Peoria, IL 61614");
  assert.equal(url.searchParams.get("lat"), String(ROSEMEAD_POINT.lat));
  assert.equal(url.searchParams.get("lng"), String(ROSEMEAD_POINT.lng));
  assert.equal(url.searchParams.get("accent"), config.schoolExplorer.accentColor);
});

test("the address chosen from the picker is the one handed to the Explorer", () => {
  const url = new URL(
    schoolExplorerUrlFor({
      ...ROSEMEAD_POINT,
      address: { ...ROSEMEAD, place: "6031 N Rosemead Dr, Peoria, IL 61614" },
    })
  );
  assert.equal(url.searchParams.get("address"), "6031 N Rosemead Dr, Peoria, IL 61614");
});

test("the address goes in as an address is written", () => {
  // The ZIP follows the state with a space, not a fourth comma the geocoder has
  // to see past.
  assert.equal(addressLine(ROSEMEAD), "6031 N Rosemead Dr, Peoria, IL 61614");
  assert.equal(addressLine({ street: "88 Ocean View Dr" }), "88 Ocean View Dr");
  assert.equal(addressLine({ street: "88 Ocean View Dr", cityState: "Peoria, IL" }), "88 Ocean View Dr, Peoria, IL");
  assert.equal(addressLine(null), "");
});

/*
 * Bill, on the Neighborhood Explorer tabs: the popup is a little too small,
 * washed out and hard to read. The School Explorer is the same popup on the same
 * page, so it is filmed at the same size and the same sharpness.
 */
test("the School Explorer is filmed as big and as sharp as the Neighborhood Explorer", () => {
  const { TAB_VIEWPORT, TAB_PIXEL_RATIO } = require("../src/explorer");
  assert.deepEqual(SE_VIEWPORT, TAB_VIEWPORT, "the two popups are the same size in the video");
  assert.equal(SE_PIXEL_RATIO, TAB_PIXEL_RATIO);

  // And the card in the frame template is that shape, so the shot maps one to one
  // rather than being scaled or letterboxed.
  const frame = fs.readFileSync(path.join(config.root, "views", "frame.html"), "utf8");
  const card = (frame.match(/#card\.card--se\s*\{[^}]*\}/) || [""])[0];
  assert.ok(card, "the frame template needs a School Explorer card");
  assert.equal(Number((card.match(/width:\s*(\d+)px/) || [])[1]), SE_VIEWPORT.width);

  const shot = (frame.match(/\.ne__shot,\s*\.se__shot\s*\{[^}]*\}/) || [""])[0];
  assert.equal(Number((shot.match(/height:\s*(\d+)px/) || [])[1]), SE_VIEWPORT.height);
});

/*
 * The Smyrna schools are gone, not merely unused. Left in the tree they are a
 * card somebody could reach for again, and the whole bug was a card we drew.
 */
test("no fixed neighborhood is left anywhere for a card to be drawn from", () => {
  const searched = [];
  for (const dir of ["src", "views"]) {
    for (const name of fs.readdirSync(path.join(config.root, dir))) {
      const file = path.join(config.root, dir, name);
      if (!fs.statSync(file).isFile()) continue;
      searched.push({ name: `${dir}/${name}`, text: fs.readFileSync(file, "utf8") });
    }
  }
  assert.ok(searched.length > 5, "nothing was searched");

  for (const { name, text } of searched) {
    // The comments explaining the bug are allowed to name it; data is not.
    const withoutComments = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*(\/\/|\*).*$/gm, "");
    for (const gone of ["Cobb County", "Nickajack", "Wehunt Commons", "20,613"]) {
      assert.ok(!withoutComments.includes(gone), `${name} still carries "${gone}"`);
    }
  }
  assert.equal(fs.existsSync(path.join(config.root, "src", "demo-data.js")), false);
});

test("a School Explorer beat is worth at most one picture per beat", () => {
  assert.ok(MAX_SE_SHOTS >= 2, "more than one beat means more than one view of the list");
  assert.ok(MAX_SE_SHOTS <= 4, "a sales beat is not a scroll for its own sake");
});

/* ---------------------------------------------------------------- */
/* the real thing                                                   */
/* ---------------------------------------------------------------- */

async function schoolExplorerReachable() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(config.schoolExplorer.embedUrl, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch (_) {
    return false;
  }
}

let liveSkip = config.chromePath ? null : "no Chrome or Chromium on this machine";

/*
 * The whole report, in one check: a job about Bill's Peoria listing has to come
 * back with Peoria's schools in it and nothing of Smyrna's.
 */
test("the schools filmed for a Peoria listing are Peoria's", async (t) => {
  if (!liveSkip && !(await schoolExplorerReachable())) liveSkip = "the live School Explorer is not reachable";
  if (liveSkip) return t.skip(liveSkip);

  const outDir = await fsp.mkdtemp(path.join(dataDir, "peoria-"));
  const filmed = await captureSchoolExplorer({
    ...ROSEMEAD_POINT,
    address: ROSEMEAD,
    shots: 3,
    outDir,
    log: () => {},
  });

  // What the product says it is showing, which is the line that read "Smyrna, GA
  // - Cobb County School District" on the video Bill was sent.
  assert.match(filmed.place, /Peoria/i, `the Explorer says it is showing "${filmed.place}"`);
  assert.doesNotMatch(filmed.place, /Smyrna|Cobb/i, filmed.place);

  // And the schools themselves are that district's.
  assert.match(filmed.text, /School District/i);
  assert.doesNotMatch(filmed.text, /Nickajack|Griffin Middle|Cobb County/i);
  assert.ok(filmed.nearby > 0, "it should have found schools near the address");

  assert.ok(filmed.shots.length >= 1 && filmed.shots.length <= MAX_SE_SHOTS, `${filmed.shots.length} shots`);
  for (const file of filmed.shots) {
    assert.ok(fs.statSync(file).size > 20000, `${file} is suspiciously small`);
  }
  // More than one picture means the list really scrolled, rather than the top of
  // it being photographed twice.
  if (filmed.shots.length > 1) {
    const seen = new Set(
      filmed.shots.map((file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex"))
    );
    assert.equal(seen.size, filmed.shots.length, "the same view was photographed twice");
  }
});

/*
 * Two different addresses have to give two different cards. This is the check the
 * drawn card could never have passed, and the one that would have caught Bill's
 * video before it was sent.
 */
test("two different listings give two different School Explorer cards", async (t) => {
  if (!liveSkip && !(await schoolExplorerReachable())) liveSkip = "the live School Explorer is not reachable";
  if (liveSkip) return t.skip(liveSkip);

  const smyrna = {
    address: { street: "4697 Wehunt Commons Dr SE", cityState: "Smyrna, GA", zip: "30082" },
    lat: 33.84210076814585,
    lng: -84.50691549697841,
  };

  const peoria = await captureSchoolExplorer({
    ...ROSEMEAD_POINT,
    address: ROSEMEAD,
    shots: 1,
    outDir: await fsp.mkdtemp(path.join(dataDir, "two-peoria-")),
    log: () => {},
  });
  const georgia = await captureSchoolExplorer({
    ...smyrna,
    shots: 1,
    outDir: await fsp.mkdtemp(path.join(dataDir, "two-smyrna-")),
    log: () => {},
  });

  assert.match(peoria.place, /Peoria/i);
  assert.match(georgia.place, /Smyrna|Cobb/i, `Smyrna came back as "${georgia.place}"`);
  assert.notEqual(
    crypto.createHash("sha1").update(fs.readFileSync(peoria.shots[0])).digest("hex"),
    crypto.createHash("sha1").update(fs.readFileSync(georgia.shots[0])).digest("hex"),
    "two towns came out as the same picture"
  );
});

test("an address the School Explorer cannot place is refused, not faked", async (t) => {
  if (!liveSkip && !(await schoolExplorerReachable())) liveSkip = "the live School Explorer is not reachable";
  if (liveSkip) return t.skip(liveSkip);

  const outDir = await fsp.mkdtemp(path.join(dataDir, "nowhere-"));
  await assert.rejects(
    () =>
      captureSchoolExplorer({
        address: { street: "zzqq nowhere street", cityState: "Narnia" },
        shots: 1,
        outDir,
        log: () => {},
        budgetMs: 45000,
      }),
    (error) => {
      assert.ok(error.isCaptureRefusal, "it has to be a refusal the job can explain");
      assert.match(error.code, /^SCHOOL_EXPLORER_/);
      // And a picture of what it was showing when it gave up.
      assert.ok(error.screenshot && fs.existsSync(error.screenshot), "no picture of the failure");
      return true;
    }
  );
});

test.after(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});
