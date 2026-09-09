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
const { NE_TABS } = require("../src/ne-tabs");

/** A screenshot for every tab, as the Explorer walk hands them over. */
const explorerShots = Object.fromEntries(
  NE_TABS.map((tab) => {
    const slug = tab.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    // What's Nearby is one shot on purpose; the others may be scrolled.
    const count = tab === "What's Nearby" ? 1 : 3;
    return [tab, Array.from({ length: count }, (_, i) => `/tmp/shots/${slug}-${i + 1}.jpg`)];
  })
);
/** The School Explorer's own pictures, as its walk hands them over. */
const schoolExplorerShots = ["/tmp/shots/se-1.jpg", "/tmp/shots/se-2.jpg"];

const context = {
  bgUrl: "file:///site.png",
  address: { street: "815 Larkspur Lane" },
  company: "Patty Realty",
  explorerShots,
  schoolExplorerShots,
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

/* ---------------------------------------------------------------- */
/* the School Explorer card is the product, not a drawing            */
/* ---------------------------------------------------------------- */

/*
 * Bill's video: the School Explorer showed Smyrna, GA and Cobb County School
 * District for a listing at 6031 N Rosemead Dr, Peoria, IL. The card was drawn
 * here from a fixed list of that reference neighborhood's schools, so it showed
 * them whatever address the video was about.
 */
test("a School Explorer beat draws the photograph of the real product", () => {
  const spec = specForBeat({ scene: "se", seconds: 4, caption: null }, context);
  assert.equal(spec.card, "se");
  assert.equal(spec.hidePopup, true);
  assert.ok(spec.tabImage.startsWith("file://"), `no photograph: ${spec.tabImage}`);
  assert.ok(spec.tabImage.includes("se-1"), spec.tabImage);

  // And nothing is handed to the template for it to draw schools from.
  assert.equal(spec.demo, undefined, "there is no stand-in neighborhood any more");
  assert.equal(spec.schools, undefined, "there is no stand-in school list any more");
});

test("each School Explorer beat gets its own view of the list", () => {
  const beat = { scene: "se", seconds: 4, caption: null };
  const first = specForBeat(beat, context, { sePosition: 0 });
  const second = specForBeat(beat, context, { sePosition: 1 });
  assert.notEqual(first.tabImage, second.tabImage, "two beats, two pictures");

  // A script with more beats than pictures holds the last one rather than
  // running out - the list was short enough to fit in two.
  const third = specForBeat(beat, context, { sePosition: 2 });
  assert.equal(third.tabImage, second.tabImage);
});

test("a School Explorer beat with no photograph is refused rather than drawn", () => {
  assert.throws(
    () => specForBeat({ scene: "se", caption: null }, { ...context, schoolExplorerShots: [] }),
    /no School Explorer screenshot/i
  );
  assert.throws(
    () => specsForBeat({ scene: "se", seconds: 4 }, { ...context, schoolExplorerShots: undefined }),
    /no School Explorer screenshot/i
  );
});

test("the frame template has no school card left to draw", () => {
  const frame = fs.readFileSync(path.join(config.root, "views", "frame.html"), "utf8");
  // The markup that drew the eight Smyrna school cards, gone with the data.
  assert.doesNotMatch(frame, /school__score|school__rank|class="schools"/);
  // What is there instead: the popup's chrome around a photograph.
  assert.match(frame, /class="se__shot"/);
});

test("a tab beat with no screenshot is refused rather than drawn from stand-in data", () => {
  assert.throws(
    () => specForBeat({ scene: "ne", neTabName: "Commutes", caption: null }, { ...context, explorerShots: {} }),
    /no Neighborhood Explorer screenshot for the "Commutes" tab/
  );
});

/*
 * The label beside the house button on a listing frame says schools.
 *
 * It used to say "Click here to explore the neighborhood around 815 Larkspur
 * Lane", on every listing frame of every script - the school-only one included,
 * which is documented never to mention the Neighborhood Explorer. That is the
 * Neighborhood Explorer Bill saw on the listing frames three times over, and it
 * was drawn the same way whether the listing behind it was filmed or uploaded.
 *
 * The button is the School Explorer's: templates.js guarantees School Explorer
 * is the first Explorer any script shows, and by the time a Neighborhood
 * Explorer beat runs the popup is open and this label is hidden with the rest of
 * the button.
 */
test("the label beside the house button says schools, and names the house it is about", () => {
  assert.equal(tooltipFor({ street: "815 Larkspur Lane" }), "Click here to explore the schools around 815 Larkspur Lane");
  assert.equal(tooltipFor({ street: "" }), "Click here to explore the schools near this home");
  assert.equal(tooltipFor(null), "Click here to explore the schools near this home");

  for (const address of [{ street: "815 Larkspur Lane" }, { street: "" }, null]) {
    assert.doesNotMatch(tooltipFor(address), /neighborhood/i, "nothing on a listing frame says neighborhood");
  }
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
  assert.equal(before.scene, "listing-button", "the beat before the popup shows the button being pressed");

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
  for (const scene of ["listing", "listing-button", "se"]) {
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

/*
 * The School Explorer is a popup too, and the shots are of the embed only, so
 * without chrome drawn round them the card is a white rectangle with no name on
 * it and no way out.
 */
test("the School Explorer card is drawn as the popup it is", needsChrome, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(config.root, "views", "frame.html")).toString(), {
      waitUntil: "load",
    });
    await page.evaluate((value) => window.renderFrame(value), {
      bg: "",
      caption: { headline: "Schools, right on your site.", subline: "" },
      card: "se",
      hidePopup: true,
      tabImage: "",
      address: { street: "6031 N Rosemead Dr" },
    });

    const chrome = await page.evaluate(() => {
      const head = document.querySelector("#card .se__head");
      const x = document.querySelector("#card .se__x");
      const card = document.getElementById("card");
      return {
        headerText: head ? head.innerText.replace(/\s+/g, " ").trim() : "",
        hasX: Boolean(x && x.querySelector("svg")),
        hasPhoto: Boolean(document.querySelector("#card img.se__shot")),
        // The same size and place as the Neighborhood Explorer's card, because
        // the upgrade script cuts between the two.
        box: card.getBoundingClientRect().toJSON(),
      };
    });

    assert.match(chrome.headerText, /School Explorer/i, chrome.headerText);
    assert.match(chrome.headerText, /6031 N Rosemead Dr/, "and it names the house it is about");
    assert.equal(chrome.hasX, true, "there has to be a way out of the popup");
    assert.equal(chrome.hasPhoto, true, "the body of the card is a photograph");

    const ne = await page.evaluate(async () => {
      await window.renderFrame({
        bg: "",
        caption: { headline: "Demographics.", subline: "" },
        card: "ne",
        hidePopup: true,
        tabImage: "",
        address: { street: "6031 N Rosemead Dr" },
      });
      return document.getElementById("card").getBoundingClientRect().toJSON();
    });
    assert.deepEqual(
      { x: chrome.box.x, y: chrome.box.y, width: chrome.box.width, height: chrome.box.height },
      { x: ne.x, y: ne.y, width: ne.width, height: ne.height },
      "the two popups must not change size and place between beats"
    );
  } finally {
    await closeBrowser(browser);
  }
});
