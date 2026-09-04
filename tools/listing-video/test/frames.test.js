"use strict";

/* What each beat asks the frame template to draw. */

const os = require("os");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.LISTING_VIDEO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-frames-"));
process.env.LISTING_VIDEO_TOKEN = "test-token";

const templates = require("../src/templates");
const { specForBeat, specsForBeat, spreadDurations, tooltipFor } = require("../src/frames");
const { NE_TABS } = require("../src/demo-data");

/** A screenshot for every tab, as the Explorer walk hands them over. */
const explorerShots = Object.fromEntries(
  NE_TABS.map((tab) => {
    const slug = tab.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    // What's Nearby is one shot on purpose; the others may be scrolled.
    const count = tab === "What's Nearby" ? 1 : 3;
    return [tab, Array.from({ length: count }, (_, i) => `/tmp/shots/${slug}-${i + 1}.jpg`)];
  })
);
const context = {
  bgUrl: "file:///site.png",
  address: { street: "815 Larkspur Lane" },
  company: "Patty Realty",
  explorerShots,
};

test("every Neighborhood Explorer beat draws the real screenshot of its own tab", async () => {
  const template = await templates.getTemplate("se-to-ne-upgrade");
  const beats = templates.renderBeats(template, { firstName: "Patty", company: "Patty Realty" });
  const specs = beats.map((beat) => ({ scene: beat.scene, tab: beat.neTabName, ...specForBeat(beat, context) }));

  const cards = specs.filter((spec) => spec.card).map((spec) => spec.card);
  assert.equal(cards[0], "se", "School Explorer is what they already have, so it is on screen first");
  assert.ok(cards.includes("ne"));

  // The body of each tab beat is that tab's own photograph. This is the bug:
  // every beat used to get the same drawn Map and Summary card.
  const neSpecs = specs.filter((spec) => spec.card === "ne");
  const walked = neSpecs.slice(0, 7);
  assert.deepEqual(walked.map((spec) => spec.tab), NE_TABS, "every tab gets its own beat, in the official order");
  for (const spec of walked) {
    assert.ok(spec.tabImage.startsWith("file://"), `${spec.tab} needs a real screenshot`);
    assert.ok(
      spec.tabImage.includes(spec.tab.replace(/[^a-z0-9]+/gi, "-").toLowerCase()),
      `${spec.tab} is showing ${spec.tabImage}`
    );
  }
  assert.equal(new Set(walked.map((spec) => spec.tabImage)).size, 7, "seven tabs, seven different pictures");

  // An explorer card takes the place of the popup button rather than sitting
  // next to it.
  assert.ok(specs.filter((spec) => spec.card).every((spec) => spec.hidePopup));
});

test("a tab beat with no screenshot is refused rather than drawn from stand-in data", () => {
  assert.throws(
    () => specForBeat({ scene: "ne", neTabName: "Commutes", caption: null }, { ...context, explorerShots: {} }),
    /no Neighborhood Explorer screenshot for the "Commutes" tab/
  );
});

test("the popup tooltip uses the address that was filmed, or says nothing about one", () => {
  assert.equal(tooltipFor({ street: "815 Larkspur Lane" }), "Click here to explore the neighborhood around 815 Larkspur Lane");
  assert.equal(tooltipFor({ street: "" }), "Click here to explore this neighborhood");
  assert.equal(tooltipFor(null), "Click here to explore this neighborhood");
});

/* ---------------------------------------------------------------- */
/* how the upgrade video is filmed                                  */
/* ---------------------------------------------------------------- */

/*
 * Bill: on the upgrade video the Neighborhood Explorer button is never seen.
 *
 * The line about the same button upgrading used to play over a School Explorer
 * card, which covers the button - so the button the line is about was never on
 * screen, and the popup arrived from nowhere.
 */
test("the house button is in frame right before the first Neighborhood Explorer popup", async () => {
  const template = await templates.getTemplate("se-to-ne-upgrade");
  const beats = templates.renderBeats(template, { firstName: "Vanessa", company: "DOMO Realty" });

  const firstPopup = beats.findIndex((beat) => beat.scene === "ne");
  assert.ok(firstPopup > 0, "there is a popup to lead into");

  const before = beats[firstPopup - 1];
  assert.equal(before.scene, "listing-tap", "the beat before the popup shows the button being pressed");

  // The words are the ones that were approved; only the scene changed.
  assert.match(before.text, /the same button upgrades to Neighborhood Explorer/i);

  // And that beat really draws the button, uncovered.
  const spec = specForBeat(before, context);
  assert.equal(spec.tapping, true, "the button is shown being tapped");
  assert.equal(spec.hidePopup, false, "and it is not hidden");
  assert.equal(spec.card, null, "nothing is drawn over it");
  assert.ok(spec.tooltip, "with its tooltip beside it");
});

test("a tab beat is worth one still per shot of that tab", () => {
  const beat = { scene: "ne", neTabName: "Schools", seconds: 3 };
  const specs = specsForBeat(beat, context);

  assert.equal(specs.length, 3, "Schools was filmed in three shots, so it is three stills");
  for (const spec of specs) {
    assert.equal(spec.card, "ne");
    assert.equal(spec.hidePopup, true);
  }
  // Each still is a different shot: the tab scrolled between them.
  const drawn = specs.map((spec) => spec.tabImage);
  assert.equal(new Set(drawn).size, 3, JSON.stringify(drawn));
});

test("What's Nearby is one still, because three places make the point", () => {
  const specs = specsForBeat({ scene: "ne", neTabName: "What's Nearby", seconds: 3 }, context);
  assert.equal(specs.length, 1, "a long list is not scrolled through");
});

test("a beat with no shot for its tab is still refused", () => {
  assert.throws(
    () => specsForBeat({ scene: "ne", neTabName: "Schools" }, { ...context, explorerShots: {} }),
    /no Neighborhood Explorer screenshot/i
  );
  // An empty list counts as no shot.
  assert.throws(
    () => specsForBeat({ scene: "ne", neTabName: "Schools" }, { ...context, explorerShots: { Schools: [] } }),
    /no Neighborhood Explorer screenshot/i
  );
});

test("every other scene is still one still", () => {
  for (const scene of ["listing", "listing-tap", "se"]) {
    assert.equal(specsForBeat({ scene, seconds: 4 }, context).length, 1, scene);
  }
});

/*
 * A beat worth three stills shares its seconds between them, so scrolling a tab
 * does not change how long the scene lasts or push the voice out of time.
 */
test("a beat's seconds are shared out across its own stills", () => {
  // Beat 0 is one still, beat 1 is three, beat 2 is two.
  const frameBeats = [0, 1, 1, 1, 2, 2];
  const perStill = spreadDurations([6, 3, 5], frameBeats);

  assert.deepEqual(perStill, [6, 1, 1, 1, 2.5, 2.5]);
  assert.equal(
    perStill.reduce((sum, value) => sum + value, 0),
    14,
    "the total length of the video does not change"
  );
});

test("a job made before tabs were scrolled still lines up", () => {
  // No mapping recorded, so the stills are one per beat as they used to be.
  assert.deepEqual(spreadDurations([4, 5, 6], undefined), [4, 5, 6]);
  assert.deepEqual(spreadDurations([4, 5, 6], []), [4, 5, 6]);
});

/* ---------------------------------------------------------------- */
/* the popup has to look like a popup                                */
/* ---------------------------------------------------------------- */

const { launch, closeBrowser } = require("../src/browser");
const { run } = require("../src/exec");
const config = require("../src/config");

const noChrome = !config.chromePath;
const needsChrome = noChrome ? { skip: "no Chrome or Chromium on this machine" } : {};

/** Mean brightness of a patch of a frame, 0 (black) to 255 (white). */
async function patchBrightness(file, crop) {
  const { stdout } = await run(
    config.ffmpegPath,
    ["-v", "error", "-i", file, "-vf", `crop=${crop},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer" }
  );
  const pixel = Buffer.from(stdout, "binary");
  return (pixel[0] + pixel[1] + pixel[2]) / 3;
}

/*
 * Bill's screenshot: a white card on a pale listing, no border, no header, no X.
 * It read as a faint rectangle rather than a popup open on the page.
 *
 * The cause was #scrim being rgba(255,255,255,0.5) - a white wash that bleached
 * the listing so a white card had no edge to see.
 */
test("the listing behind the card is dimmed, not bleached", needsChrome, async () => {
  const browser = await launch();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-dim-"));
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(config.root, "views", "frame.html")).toString(), {
      waitUntil: "load",
    });

    // A white listing behind, which is the case that went wrong: on a pale page a
    // white wash leaves nothing to see.
    const white = path.join(outDir, "white.png");
    await run(config.ffmpegPath, ["-y", "-f", "lavfi", "-i", "color=c=white:s=1920x1400", "-frames:v", "1", white]);
    const bg = pathToFileURL(white).toString();

    const shotFile = path.join(outDir, "tab.png");
    await run(config.ffmpegPath, [
      "-y", "-f", "lavfi", "-i", "color=c=0xfafbfa:s=1600x700", "-frames:v", "1", shotFile,
    ]);

    const shoot = async (spec, name) => {
      await page.evaluate((value) => window.renderFrame(value), spec);
      const file = path.join(outDir, name);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
      return file;
    };

    const plain = await shoot({ bg, caption: { headline: "", subline: "" } }, "plain.png");
    const withCard = await shoot(
      {
        bg,
        caption: { headline: "Map and Summary.", subline: "" },
        card: "ne",
        hidePopup: true,
        tabImage: pathToFileURL(shotFile).toString(),
        address: { street: "3386 Lee St SE" },
      },
      "card.png"
    );

    // A patch of listing well clear of the card: bottom-left corner.
    const corner = "200:120:40:940";
    const before = await patchBrightness(plain, corner);
    const after = await patchBrightness(withCard, corner);

    assert.ok(
      after < before - 40,
      `the listing went from ${Math.round(before)} to ${Math.round(after)} - it has to get darker, not paler`
    );
    assert.ok(after < 190, `at ${Math.round(after)} the listing is still too pale to make the card stand out`);

    // And the card itself is not dimmed with it: the text in it must stay readable.
    const insideCard = "200:120:800:600";
    assert.ok(
      (await patchBrightness(withCard, insideCard)) > 200,
      "the card itself must stay bright, only the listing behind it dims"
    );
  } finally {
    await closeBrowser(browser);
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test("the scrim is a dark colour, not a white one", () => {
  const frame = fs.readFileSync(path.join(config.root, "views", "frame.html"), "utf8");
  const scrim = frame.match(/#scrim\s*\{[^}]*\}/);
  assert.ok(scrim, "there is a scrim");

  const rgba = scrim[0].match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  assert.ok(rgba, `the scrim has no colour: ${scrim[0]}`);
  const [r, g, b] = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  assert.ok((r + g + b) / 3 < 80, `the scrim is rgb(${r},${g},${b}), which is a wash rather than a dim`);
});

test("the card has an edge and a shadow, so it sits on the page", () => {
  const frame = fs.readFileSync(path.join(config.root, "views", "frame.html"), "utf8");
  const card = (frame.match(/#card\.card--ne\s*\{[^}]*\}/) || [""])[0];
  assert.match(card, /border:\s*\d/, `no border: ${card}`);
  assert.match(card, /box-shadow:/, `no shadow: ${card}`);
  assert.match(card, /border-radius:/, card);
});

test("the popup has a header and a way out of it", needsChrome, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(config.root, "views", "frame.html")).toString(), {
      waitUntil: "load",
    });
    await page.evaluate((value) => window.renderFrame(value), {
      bg: "",
      caption: { headline: "Schools.", subline: "" },
      card: "ne",
      hidePopup: true,
      tabImage: "",
      address: { street: "3386 Lee St SE" },
    });

    const chrome = await page.evaluate(() => {
      const head = document.querySelector("#card .ne__head");
      const x = document.querySelector("#card .ne__x");
      const card = document.getElementById("card");
      const style = window.getComputedStyle(card);
      return {
        hasHeader: Boolean(head),
        headerText: head ? head.innerText.replace(/\s+/g, " ").trim() : "",
        headerHeight: head ? Math.round(head.getBoundingClientRect().height) : 0,
        hasX: Boolean(x),
        xIsAnIcon: Boolean(x && x.querySelector("svg")),
        xOnTheRight: x ? x.getBoundingClientRect().left > card.getBoundingClientRect().left + 1200 : false,
        borderWidth: Math.round(parseFloat(style.borderTopWidth) || 0),
        hasShadow: style.boxShadow !== "none",
      };
    });

    assert.equal(chrome.hasHeader, true, "the popup needs a header bar");
    assert.match(chrome.headerText, /Neighborhood Explorer/i, chrome.headerText);
    assert.match(chrome.headerText, /3386 Lee St SE/, "and it names the house it is about");
    assert.ok(chrome.headerHeight > 50, `the header is only ${chrome.headerHeight}px tall`);

    assert.equal(chrome.hasX, true, "there has to be a way out of the popup");
    assert.equal(chrome.xIsAnIcon, true, "drawn as an X");
    assert.equal(chrome.xOnTheRight, true, "in the corner a close button goes in");

    assert.ok(chrome.borderWidth >= 1, "the card has a visible edge");
    assert.equal(chrome.hasShadow, true, "and a shadow, so it reads as lifted off the page");
  } finally {
    await closeBrowser(browser);
  }
});
