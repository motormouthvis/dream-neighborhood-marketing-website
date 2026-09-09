"use strict";

/*
 * The Neighborhood Explorer on the listing frames. Bill's bug, three times over.
 *
 * He picked the School Explorer script - "A listing with no Explorer on it yet
 * (the before shot)" - uploaded a screenshot of the listing page, and the
 * finished video still had the Neighborhood Explorer on the listing frames.
 *
 * It was the label beside the house button we draw in the corner: "Click here to
 * explore the neighborhood around 6031 N Rosemead Dr", on every listing frame of
 * every script. The fix before this one re-checked the live page for an Explorer
 * as the shutter went, which does nothing at all here - there is no page on the
 * upload path, and the label was never about the page anyway. It was ours.
 *
 * So these tests are about the frames themselves, on the path Bill actually
 * took: an "absent" script, a screenshot uploaded by hand, and real Chrome
 * drawing the real scenes. What is asserted is the words that were photographed,
 * read off the stage the way somebody watching would read them.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-before-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "before-shot-token";

const config = require("../src/config");
const templates = require("../src/templates");
const { run } = require("../src/exec");
const { launch, closeBrowser } = require("../src/browser");
const { prepareListingImage } = require("../src/listing-image");
const {
  renderFrames,
  specForBeat,
  specsForBeat,
  wrongExplorerOnScreen,
  LISTING_SCENES,
  NEIGHBORHOOD_EXPLORER_ON_SCREEN,
} = require("../src/frames");
const { NE_TABS } = require("../src/ne-tabs");

const noChrome = !config.chromePath;
const needsChrome = noChrome ? { skip: "no Chrome or Chromium on this machine" } : {};

/* Bill's listing. */
const ADDRESS = { street: "6031 N Rosemead Dr", cityState: "Peoria, IL", zip: "61614" };

/** A picture standing in for the screenshot he took of the listing page. */
async function uploadedScreenshot(outDir) {
  const source = path.join(outDir, "his-screenshot.png");
  await run(
    config.ffmpegPath,
    ["-y", "-f", "lavfi", "-i", "color=c=0x2f6fae:s=1024x576", "-frames:v", "1", source],
    { timeout: 30000 }
  );
  // Through the same preparation a real upload goes through, so what is behind
  // the scenes here is the same file a real job would have drawn on.
  const prepared = await prepareListingImage({ sourcePath: source, outDir });
  return prepared.file;
}

/** A photograph for every Explorer beat, as the two walks hand them over. */
async function explorerShotsFor(outDir) {
  const shot = path.join(outDir, "explorer-shot.png");
  await run(
    config.ffmpegPath,
    ["-y", "-f", "lavfi", "-i", "color=c=0xfafbfa:s=1600x700", "-frames:v", "1", shot],
    { timeout: 30000 }
  );
  return {
    schoolExplorerShots: [shot, shot],
    explorerShots: Object.fromEntries(NE_TABS.map((tab) => [tab, [shot]])),
  };
}

/**
 * Draw a whole script for real and hand back what each frame ended up saying.
 *
 * This is renderFrames itself - the same function a job runs - so the words come
 * off the same stage that is photographed, not from a spec that was on its way
 * there.
 */
async function drawTheScript(templateId, { beats } = {}) {
  const template = await templates.getTemplate(templateId);
  const outDir = await fsp.mkdtemp(path.join(dataDir, `${templateId}-`));
  const screenshot = await uploadedScreenshot(outDir);
  const shots = await explorerShotsFor(outDir);

  const browser = await launch();
  try {
    const drawn = await renderFrames({
      browser,
      beats: beats || templates.renderBeats(template, { firstName: "Bill", company: "Scott Rodgers Real Estate" }),
      screenshot,
      address: ADDRESS,
      company: "Scott Rodgers Real Estate",
      explorers: template.explorers,
      ...shots,
      outDir,
      log: () => {},
    });
    return { template, drawn, beats: beats || templates.renderBeats(template, { firstName: "Bill", company: "Scott Rodgers Real Estate" }) };
  } finally {
    await closeBrowser(browser);
  }
}

/* ---------------------------------------------------------------- */
/* the bug, on the path Bill took                                   */
/* ---------------------------------------------------------------- */

/*
 * The regression test. This fails if an "absent" job drawn on an uploaded
 * screenshot puts any Neighborhood Explorer wording on a listing-scene frame.
 */
test(
  "an uploaded before-shot listing has no Neighborhood Explorer on its listing frames",
  needsChrome,
  async () => {
    for (const templateId of ["vanessa-se-only-v11", "vanessa-se-ne-v11"]) {
      const { template, drawn, beats } = await drawTheScript(templateId);

      assert.equal(template.listingExplorer, "absent", `${templateId} is the before shot`);
      assert.ok(drawn.frames.length > 0);
      assert.equal(drawn.frameText.length, drawn.frames.length, "every frame's words were read");

      const listingFrames = drawn.frameText.filter((_, at) => LISTING_SCENES.has(beats[drawn.frameBeats[at]].scene));
      assert.ok(listingFrames.length >= 2, `${templateId} has listing frames to check`);

      for (const words of listingFrames) {
        assert.doesNotMatch(
          words,
          NEIGHBORHOOD_EXPLORER_ON_SCREEN,
          `${templateId}: a listing frame was photographed saying "${words}"`
        );
      }
    }
  }
);

/*
 * And on the school-only script it is not just the listing frames: that script's
 * own notes promise the Neighborhood Explorer is not in it anywhere.
 */
test(
  "a School-Explorer-only script has no Neighborhood Explorer on any frame at all",
  needsChrome,
  async () => {
    const { drawn } = await drawTheScript("vanessa-se-only-v11");
    for (const words of drawn.frameText) {
      assert.doesNotMatch(words, NEIGHBORHOOD_EXPLORER_ON_SCREEN, `photographed: "${words}"`);
    }
    // The School Explorer is in it, though - it is the product being sold.
    assert.ok(
      drawn.frameText.some((words) => /School Explorer/i.test(words)),
      "the School Explorer popup still has its header"
    );
  }
);

/*
 * The upgrade script does show the Neighborhood Explorer - that is what it is
 * pitching - but only on its own beats, and never on the listing underneath.
 */
test("on the upgrade script the Neighborhood Explorer is on its own beats only", needsChrome, async () => {
  const { template, drawn, beats } = await drawTheScript("se-to-ne-upgrade");
  assert.equal(template.explorers, "se-ne");

  const seen = { listing: 0, ne: 0 };
  drawn.frameText.forEach((words, at) => {
    const scene = beats[drawn.frameBeats[at]].scene;
    if (LISTING_SCENES.has(scene)) {
      assert.doesNotMatch(words, NEIGHBORHOOD_EXPLORER_ON_SCREEN, `a "${scene}" frame said "${words}"`);
      seen.listing += 1;
    }
    if (scene === "ne") {
      assert.match(words, /Neighborhood Explorer/i, "an ne beat is the Neighborhood Explorer popup");
      seen.ne += 1;
    }
  });
  assert.ok(seen.listing >= 3 && seen.ne >= 7, JSON.stringify(seen));
});

/* ---------------------------------------------------------------- */
/* the frame is refused rather than photographed                     */
/* ---------------------------------------------------------------- */

/*
 * The check is on the stage, after the beat is drawn and before the shutter, so
 * it catches the Neighborhood Explorer arriving from anywhere we draw - the
 * label, a caption, a popup header, or something added later. A hand-edited
 * script that puts it back on a listing beat does not get a video.
 */
test("a listing beat that says Neighborhood Explorer is refused, not filmed", needsChrome, async () => {
  const beats = [
    {
      index: 0,
      scene: "listing",
      seconds: 4,
      text: "Here is your listing today.",
      caption: { headline: "Your listing, with Neighborhood Explorer.", subline: "" },
      neTab: null,
      neTabName: "",
    },
  ];

  await assert.rejects(
    () => drawTheScript("vanessa-se-only-v11", { beats }),
    (error) => {
      assert.equal(error.code, "NE_ON_LISTING_SCENE");
      assert.match(error.message, /Scene 1 of this script is a "listing" beat/);
      assert.match(error.message, /Neighborhood Explorer/);
      // And it says what to do about it rather than only saying no.
      assert.match(error.message, /Scripts tab|SE to NE upgrade/);
      return true;
    }
  );
});

/* ---------------------------------------------------------------- */
/* the rule itself                                                  */
/* ---------------------------------------------------------------- */

test("the listing scenes are the customer's own page, and there are two of them", () => {
  assert.deepEqual([...LISTING_SCENES].sort(), ["listing", "listing-tap"]);
  // Every scene a template can hold is either a listing scene or a popup.
  for (const scene of templates.SCENES) {
    assert.ok(LISTING_SCENES.has(scene) || scene === "se" || scene === "ne", scene);
  }
});

test("what counts as the Neighborhood Explorer being on screen", () => {
  const words = (value) => wrongExplorerOnScreen({ scene: "listing", explorers: "se-ne", card: null, onScreen: value });

  // The label as it used to read, and the popup's own header.
  assert.match(words("Click here to explore the neighborhood around 6031 N Rosemead Dr"), /listing frame says/);
  assert.match(words("Click here to explore this neighborhood"), /listing frame says/);
  assert.match(words("Neighborhood Explorer 6031 N Rosemead Dr"), /listing frame says/);

  // The school label that replaced it, and the School Explorer's own popup.
  assert.equal(words("Click here to explore the schools around 6031 N Rosemead Dr"), "");
  assert.equal(words("School Explorer 6031 N Rosemead Dr Schools, right on your site."), "");

  // A listing beat is never the Neighborhood Explorer's popup either, whatever
  // the words on it happen to say.
  assert.match(
    wrongExplorerOnScreen({ scene: "listing-tap", explorers: "se-ne", card: "ne", onScreen: "" }),
    /drawn over a listing beat/
  );
});

test("a School-Explorer-only script may not name the Neighborhood Explorer on any scene", () => {
  for (const scene of ["listing", "listing-tap", "se"]) {
    assert.match(
      wrongExplorerOnScreen({ scene, explorers: "se", card: null, onScreen: "Upgrade to Neighborhood Explorer" }),
      /School-Explorer-only|listing frame/,
      scene
    );
  }
  // The same words are fine on the upgrade script's own Neighborhood Explorer beat.
  assert.equal(
    wrongExplorerOnScreen({ scene: "ne", explorers: "se-ne", card: "ne", onScreen: "Neighborhood Explorer" }),
    ""
  );
});

/* ---------------------------------------------------------------- */
/* every shipped script, without opening Chrome                      */
/* ---------------------------------------------------------------- */

/*
 * The frames above are the real thing, and slow. This is the same rule applied
 * to what every shipped script asks to be drawn, so a reworded caption or a new
 * default template is caught by a fast test as well.
 */
test("no shipped script asks for the Neighborhood Explorer on a listing beat", async () => {
  const context = {
    bgUrl: "file:///site.png",
    address: ADDRESS,
    company: "Scott Rodgers Real Estate",
    schoolExplorerShots: ["/tmp/se-1.jpg", "/tmp/se-2.jpg"],
    explorerShots: Object.fromEntries(NE_TABS.map((tab) => [tab, ["/tmp/ne-1.jpg"]])),
  };

  for (const summary of await templates.listTemplates()) {
    const beats = templates.renderBeats(summary, { firstName: "Bill", company: "Scott Rodgers Real Estate" });
    beats.forEach((beat, index) => {
      for (const spec of specsForBeat(beat, context, { sePosition: 0 })) {
        // What the stage would end up saying: the caption and the label are the
        // only words we put on a listing frame.
        const onScreen = [spec.caption.headline, spec.caption.subline, spec.hidePopup ? "" : spec.tooltip]
          .filter(Boolean)
          .join(" ");
        assert.equal(
          wrongExplorerOnScreen({
            scene: beat.scene,
            explorers: summary.explorers,
            card: spec.card,
            onScreen,
          }),
          "",
          `${summary.id} beat ${index + 1} (${beat.scene}): "${onScreen}"`
        );
      }
    });
  }
});

test("the house button on a listing beat is the School Explorer's", async () => {
  for (const id of ["vanessa-se-only-v11", "vanessa-se-ne-v11", "se-to-ne-upgrade"]) {
    const template = await templates.getTemplate(id);
    const beats = templates.renderBeats(template, { firstName: "Bill", company: "Scott Rodgers Real Estate" });
    for (const beat of beats.filter((entry) => LISTING_SCENES.has(entry.scene))) {
      const spec = specForBeat(beat, {
        bgUrl: "file:///site.png",
        address: ADDRESS,
        company: "Scott Rodgers Real Estate",
        schoolExplorerShots: ["/tmp/se-1.jpg"],
        explorerShots: {},
      });
      assert.equal(spec.card, null, `${id}: no popup is open on a ${beat.scene} beat`);
      assert.match(spec.tooltip, /schools/i, `${id}: ${spec.tooltip}`);
      assert.doesNotMatch(spec.tooltip, /neighborhood/i, `${id}: ${spec.tooltip}`);
    }
  }
});
