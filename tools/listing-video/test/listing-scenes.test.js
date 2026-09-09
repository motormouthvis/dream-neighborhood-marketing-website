"use strict";

/*
 * The three listing looks, and the one that has to be empty.
 *
 * Bill has reported the same thing three times: he picks a script whose whole
 * point is a listing with nothing of ours on it, and the video comes back with
 * the School Explorer house button in the corner, its "Click here to explore..."
 * label beside it, and - on the beat he was describing - the popup itself.
 *
 * Each previous fix changed the wording of what gets drawn. This one splits the
 * scene in three, so a beat has to SAY it wants the button, and then reads the
 * drawn page back before the shutter so a beat that did not ask for it cannot
 * get it anyway.
 *
 *   listing         just their page
 *   listing-button  their page with the house button on it
 *   se              their page with the School Explorer popup open on it
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const { pathToFileURL } = require("url");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-scenes-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "scenes-token";

const config = require("../src/config");
const templates = require("../src/templates");
const { run } = require("../src/exec");
const { launch, closeBrowser } = require("../src/browser");
const {
  renderFrames,
  specForBeat,
  bareListingChromeOnScreen,
  BARE_LISTING_SCENES,
  BUTTON_LISTING_SCENES,
} = require("../src/frames");
const { NE_TABS } = require("../src/ne-tabs");

const noChrome = !config.chromePath;
const needsChrome = noChrome ? { skip: "no Chrome or Chromium on this machine" } : {};

const ADDRESS = { street: "6031 N Rosemead Dr", cityState: "Peoria, IL", zip: "61614" };

const context = {
  bgUrl: "file:///their-listing.png",
  address: ADDRESS,
  company: "Scott Rodgers Real Estate",
  schoolExplorerShots: ["/tmp/se-1.jpg", "/tmp/se-2.jpg"],
  explorerShots: Object.fromEntries(NE_TABS.map((tab) => [tab, ["/tmp/ne-1.jpg"]])),
};

/* ---------------------------------------------------------------- */
/* what each of the three asks to be drawn                          */
/* ---------------------------------------------------------------- */

test("the script editor offers three listing looks and names them plainly", () => {
  assert.deepEqual(templates.SCENES, ["listing", "listing-button", "se", "ne"]);

  // The label is the whole fix on the editing side: "Their listing page" was
  // one line for three different pictures, so nobody could pick between them.
  assert.match(templates.SCENE_LABELS.listing, /just their listing page/i);
  assert.match(templates.SCENE_LABELS.listing, /nothing of ours/i);
  assert.match(templates.SCENE_LABELS["listing-button"], /School Explorer button/i);
  assert.match(templates.SCENE_LABELS.se, /School Explorer popup/i);
  assert.match(templates.SCENE_LABELS.ne, /Neighborhood Explorer popup/i);

  // Every scene says something about what it draws, for the hint under the box.
  for (const scene of templates.SCENES) assert.ok(templates.SCENE_HINTS[scene], scene);
});

test("a bare listing beat asks for their page and nothing else", () => {
  const spec = specForBeat({ scene: "listing", seconds: 5, caption: null }, context);

  assert.equal(spec.bare, true, "the frame template is told outright");
  assert.equal(spec.tooltip, "", "no label beside a button that is not there");
  assert.equal(spec.hidePopup, true, "no house button");
  assert.equal(spec.card, null, "no popup card");
  assert.equal(spec.tapping, false);
  assert.equal(spec.bg, context.bgUrl, "their page is still the picture");
});

test("a button beat draws the house and its schools label, with nothing open over it", () => {
  const spec = specForBeat({ scene: "listing-button", seconds: 3, caption: null }, context);

  assert.equal(spec.bare, false);
  assert.equal(spec.hidePopup, false, "the button is on screen");
  assert.equal(spec.tapping, true, "and being pressed");
  assert.equal(spec.card, null, "but the card has not opened yet - that is the se beat");
  assert.match(spec.tooltip, /explore the schools around 6031 N Rosemead Dr/);
});

test("a School Explorer beat opens the popup over their page", () => {
  const spec = specForBeat({ scene: "se", seconds: 4, caption: null }, context);
  assert.equal(spec.bare, false);
  assert.equal(spec.card, "se");
  assert.equal(spec.hidePopup, true, "the card takes the place of the button");
});

/*
 * Scripts saved when there was one listing scene and a tap variant of it still
 * open, still edit and still film. "listing-tap" is the old name for the button
 * beat, and a beat that says it draws exactly what it used to.
 */
test("a script saved as listing-tap becomes the button beat", async () => {
  assert.equal(templates.canonicalScene("listing-tap"), "listing-button");
  assert.ok(BUTTON_LISTING_SCENES.has("listing-tap"), "and old jobs on disk still draw it");

  const saved = templates.cleanTemplate({
    name: "Bill's old cut",
    explorers: "se",
    beats: [
      { scene: "listing", seconds: 6, text: "Here is your listing today." },
      { scene: "listing-tap", seconds: 2, text: "She taps the little house." },
      { scene: "se", seconds: 5, text: "And the schools come up." },
    ],
  });

  assert.deepEqual(saved.beats.map((beat) => beat.scene), ["listing", "listing-button", "se"]);

  const tapped = specForBeat({ scene: "listing-tap", seconds: 2 }, context);
  assert.equal(tapped.hidePopup, false);
  assert.equal(tapped.tapping, true);
  assert.ok(tapped.tooltip);
});

/* ---------------------------------------------------------------- */
/* the gate, on what was really drawn                               */
/* ---------------------------------------------------------------- */

test("the gate reads our own furniture off the stage, not the script's words", () => {
  const bare = { buttonShown: false, cardShown: false, dimmed: false, text: "" };

  assert.equal(bareListingChromeOnScreen({ scene: "listing", chrome: bare }), "");

  assert.match(
    bareListingChromeOnScreen({ scene: "listing", chrome: { ...bare, buttonShown: true } }),
    /house button is drawn on it/
  );
  assert.match(
    bareListingChromeOnScreen({ scene: "listing", chrome: { ...bare, cardShown: true } }),
    /popup is drawn over it/
  );
  assert.match(
    bareListingChromeOnScreen({ scene: "listing", chrome: { ...bare, dimmed: true } }),
    /dimmed behind a popup/
  );
  assert.match(
    bareListingChromeOnScreen({
      scene: "listing",
      chrome: { ...bare, text: "Click here to explore the schools around 6031 N Rosemead Dr" },
    }),
    /Click here to explore the schools/
  );

  // The caption is the script's own words and goes on every beat, so it is not
  // read: a beat may legitimately say "with School Explorer" while showing the
  // page it is about to appear on.
  assert.equal(
    bareListingChromeOnScreen({ scene: "listing", chrome: bare, onScreen: "The same page, with School Explorer." }),
    ""
  );

  // The other two scenes are allowed all of it.
  for (const scene of ["listing-button", "se", "ne"]) {
    assert.equal(
      bareListingChromeOnScreen({ scene, chrome: { buttonShown: true, cardShown: true, dimmed: true, text: "x" } }),
      "",
      scene
    );
  }
});

/* ---------------------------------------------------------------- */
/* and in real Chrome, on real frames                               */
/* ---------------------------------------------------------------- */

async function flatPicture(outDir, name, colour, size) {
  const file = path.join(outDir, name);
  await run(config.ffmpegPath, ["-y", "-f", "lavfi", "-i", `color=c=${colour}:s=${size}`, "-frames:v", "1", file], {
    timeout: 30000,
  });
  return file;
}

/** Draw a script for real and hand back the frames with what was on them. */
async function draw(beats, { explorers = "se-ne" } = {}) {
  const outDir = await fsp.mkdtemp(path.join(dataDir, "draw-"));
  const screenshot = await flatPicture(outDir, "listing.png", "0x2f6fae", "1920x1400");
  const shot = await flatPicture(outDir, "shot.png", "0xfafbfa", "1600x700");

  const browser = await launch();
  try {
    return await renderFrames({
      browser,
      beats,
      screenshot,
      address: ADDRESS,
      company: "Scott Rodgers Real Estate",
      explorers,
      schoolExplorerShots: [shot, shot],
      explorerShots: Object.fromEntries(NE_TABS.map((tab) => [tab, [shot]])),
      outDir,
      log: () => {},
    });
  } finally {
    await closeBrowser(browser);
  }
}

const beat = (scene, extra) => ({
  scene,
  seconds: 4,
  text: "Words.",
  caption: { headline: "", subline: "" },
  neTab: null,
  neTabName: "",
  ...extra,
});

test("the three looks really are three different pictures", needsChrome, async () => {
  const drawn = await draw([beat("listing"), beat("listing-button"), beat("se")]);
  assert.equal(drawn.frames.length, 3);

  const [plain, button, popup] = drawn.frameChrome;

  assert.deepEqual(
    { buttonShown: plain.buttonShown, cardShown: plain.cardShown, dimmed: plain.dimmed, text: plain.text },
    { buttonShown: false, cardShown: false, dimmed: false, text: "" },
    "a bare listing is their page and nothing else"
  );

  assert.equal(button.buttonShown, true, "the button beat shows the button");
  assert.equal(button.cardShown, false, "and not the card");
  assert.match(button.text, /Click here to explore the schools/);

  assert.equal(popup.cardShown, true, "the se beat opens the popup");
  assert.equal(popup.buttonShown, false, "which takes the place of the button");
  assert.match(popup.text, /School Explorer/);
});

/*
 * The words that were photographed, not the words that were asked for.
 *
 * "Click here to explore the schools around 6031 N Rosemead Dr" is drawn by us
 * and by nothing else, so finding it on a bare listing frame is proof the button
 * was there.
 */
test("nothing of ours is photographed on a bare listing frame", needsChrome, async () => {
  const drawn = await draw([
    beat("listing", { caption: { headline: "A mom opens it.", subline: "There is nothing here about schools." } }),
  ]);

  assert.equal(drawn.frameText.length, 1);
  assert.doesNotMatch(drawn.frameText[0], /Click here to explore/i);
  assert.doesNotMatch(drawn.frameText[0], /School Explorer/i);
  assert.doesNotMatch(drawn.frameText[0], /Neighborhood Explorer/i);
  // The caption is the script's own words, so it is still there.
  assert.match(drawn.frameText[0], /There is nothing here about schools/);
});

/*
 * The gate, rather than the spec, is what stops it.
 *
 * The frame template is asked outright for a bare listing with a card and a
 * tooltip on it - the state the old bug produced - and the frame is refused
 * rather than photographed.
 */
test("a bare listing beat that somehow gets our chrome is refused, not filmed", needsChrome, async () => {
  const outDir = await fsp.mkdtemp(path.join(dataDir, "tamper-"));
  const screenshot = await flatPicture(outDir, "listing.png", "0x2f6fae", "1920x1400");
  const shot = await flatPicture(outDir, "shot.png", "0xfafbfa", "1600x700");

  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(config.root, "views", "frame.html")).toString(), { waitUntil: "load" });

    // What the bug drew: a "listing" beat carrying the button and the popup.
    await page.evaluate((value) => window.renderFrame(value), {
      bg: pathToFileURL(screenshot).toString(),
      caption: { headline: "There is nothing here about schools.", subline: "" },
      bare: true,
      tooltip: "Click here to explore the schools around 6031 N Rosemead Dr",
      hidePopup: false,
      tapping: true,
      card: "se",
      tabImage: pathToFileURL(shot).toString(),
      address: ADDRESS,
    });

    // The template itself refuses: bare wins over everything else in the spec.
    const chrome = await page.evaluate(() => {
      const shown = (node) => Boolean(node) && node.getClientRects().length > 0;
      return {
        buttonShown: shown(document.getElementById("popup")),
        cardShown: shown(document.getElementById("card")),
        text: (document.getElementById("stage").innerText || "").replace(/\s+/g, " ").trim(),
      };
    });
    assert.equal(chrome.buttonShown, false, "frame.html must not draw the button on a bare beat");
    assert.equal(chrome.cardShown, false, "nor the card");
    assert.doesNotMatch(chrome.text, /Click here to explore/i, "nor leave the label in the markup");
  } finally {
    await closeBrowser(browser);
  }
});

/*
 * The gate is the belt to frame.html's braces.
 *
 * frame.html is made to ignore `bare` - which is exactly what a future change
 * that forgets about this scene would do - and the frame is refused rather than
 * photographed. Without the gate, that change would ship the bug again quietly.
 */
test("the gate refuses the frame even if the template starts drawing it again", needsChrome, async () => {
  const outDir = await fsp.mkdtemp(path.join(dataDir, "gate-"));
  const screenshot = await flatPicture(outDir, "listing.png", "0x2f6fae", "1920x1400");

  const browser = await launch();
  try {
    const page = await browser.newPage();
    // Installed before any of the page's own scripts, so it survives the
    // navigation renderFrames does and wraps whatever frame.html defines.
    await page.evaluateOnNewDocument(() => {
      let real = null;
      Object.defineProperty(window, "renderFrame", {
        configurable: true,
        get() {
          return (spec) =>
            real({ ...spec, bare: false, hidePopup: false, tooltip: "Click here to explore the schools" });
        },
        set(fn) {
          real = fn;
        },
      });
    });

    await assert.rejects(
      () =>
        renderFrames({
          browser: { newPage: async () => page },
          beats: [beat("listing")],
          screenshot,
          address: ADDRESS,
          company: "Scott Rodgers Real Estate",
          explorers: "se",
          schoolExplorerShots: [],
          explorerShots: {},
          outDir,
          log: () => {},
        }),
      (error) => {
        assert.equal(error.code, "CHROME_ON_BARE_LISTING");
        assert.match(error.message, /just their listing page/);
        assert.match(error.message, /house button is drawn on it|Click here to explore/);
        assert.match(error.message, /School Explorer button/, "and it says which scene to pick instead");
        return true;
      }
    );
  } finally {
    await closeBrowser(browser);
  }
});

/* ---------------------------------------------------------------- */
/* the shipped scripts use the right one of the three               */
/* ---------------------------------------------------------------- */

/*
 * The before-and-after only works if the "before" beats are bare. These are the
 * lines Bill was watching when he reported the bug: a mom opens the page and
 * there is nothing about schools on it, said over a page with our schools
 * button sitting in the corner.
 */
test("the before-shot scripts open on a page with nothing of ours on it", async () => {
  for (const id of ["vanessa-se-only-v11", "vanessa-se-ne-v11"]) {
    const template = await templates.getDefault(id);
    assert.equal(template.listingExplorer, "absent", `${id} is the before shot`);

    const before = template.beats.slice(0, 3);
    for (const entry of before) {
      assert.ok(BARE_LISTING_SCENES.has(entry.scene), `${id}: "${entry.text.slice(0, 40)}..." is ${entry.scene}`);
    }
    assert.match(before[1].text, /nothing here about schools/);

    // The button turns up with the line that introduces it, and not before.
    const introduces = template.beats.findIndex((entry) => /the popup icon hovers/i.test(entry.text));
    assert.ok(introduces > 0, `${id} introduces the button`);
    assert.equal(template.beats[introduces].scene, "listing-button");
    assert.ok(
      template.beats.slice(0, introduces).every((entry) => entry.scene === "listing"),
      `${id}: nothing of ours is on screen before the line that introduces it`
    );
  }
});

/*
 * The upgrade script is the exception, and it is the exception on purpose: it
 * is pitched at somebody who already has the button, so its opening line is
 * about the button and the button is on screen for it.
 */
test("the upgrade script opens with the button on, because that is the pitch", async () => {
  const template = await templates.getDefault("se-to-ne-upgrade");
  assert.equal(template.listingExplorer, "prefer-present");
  assert.equal(template.beats[0].scene, "listing-button");
  assert.match(template.beats[0].text, /You already have School Explorer/);
  assert.ok(
    !template.beats.some((entry) => entry.scene === "listing"),
    "there is no before shot in an upgrade pitch"
  );
});
