"use strict";

/*
 * The green bar across the top, and why it is off.
 *
 * Every frame used to carry two lines of the script burned into the picture -
 * "Your listing format looks really good." over "Here is one of them, as it is
 * today." - because the shipped scripts all have caption fields and the renderer
 * drew whatever was in them.
 *
 * Myles writes the spoken script, and he could not change a word of it: the
 * moment a line was reworded the copy on screen disagreed with the voice, on a
 * video that was otherwise ready to send. So the bar is now something a job asks
 * for on the form, off by default, and a script keeping caption text is not the
 * same thing as a video showing it.
 *
 * These tests are about the default. Three layers of it:
 *
 *   the beats        renderBeats blanks the caption unless the job asked
 *   the frame        views/frame.html drops the bar when both lines are empty
 *   the gate         renderFrames refuses to photograph a bar that got drawn
 *                    anyway, the same way it refuses our button on a bare listing
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const { pathToFileURL } = require("url");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-captions-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "captions-token";

const config = require("../src/config");
const store = require("../src/store");
const templates = require("../src/templates");
const { run } = require("../src/exec");
const { launch, closeBrowser } = require("../src/browser");
const { renderFrames, captionOnScreen } = require("../src/frames");
const { NE_TABS } = require("../src/ne-tabs");
const app = require("../server");

const TOOL = "/tools/listing-video";
const noChrome = !config.chromePath;
const needsChrome = noChrome ? { skip: "no Chrome or Chromium on this machine" } : {};

const ADDRESS = { street: "6031 N Rosemead Dr", cityState: "Peoria, IL", zip: "61614" };

/* The caption Bill and Myles kept seeing, off the first beat of a shipped script. */
const SHIPPED_CAPTION = "Your listing format looks really good.";

async function flatPicture(outDir, name, colour, size) {
  const file = path.join(outDir, name);
  await run(config.ffmpegPath, ["-y", "-f", "lavfi", "-i", `color=c=${colour}:s=${size}`, "-frames:v", "1", file], {
    timeout: 30000,
  });
  return file;
}

/** Draw beats for real in Chrome, and hand back what was photographed. */
async function draw(beats, { showCaptions = false, explorers = "se-ne" } = {}) {
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
      showCaptions,
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

/* ---------------------------------------------------------------- */
/* the default, on the frames themselves                            */
/* ---------------------------------------------------------------- */

test("a shipped script draws no caption bar, because nobody asked for one", needsChrome, async () => {
  const template = await templates.getDefault("vanessa-se-only-v11");
  const beats = templates.renderBeats(template, { firstName: "Myles", company: "DOMO Realty" });

  const drawn = await draw(beats, { explorers: template.explorers });

  assert.equal(drawn.frameCaptions.length, drawn.frames.length, "every frame's bar was read");
  for (let at = 0; at < drawn.frames.length; at += 1) {
    assert.equal(drawn.frameCaptions[at].shown, false, `frame ${at + 1} still has the bar`);
    assert.equal(drawn.frameCaptions[at].text, "");
  }

  // And the words themselves are nowhere in shot, on any frame.
  const everything = drawn.frameText.join(" ");
  assert.doesNotMatch(everything, /Your listing format/i, everything.slice(0, 200));
  assert.doesNotMatch(everything, /There is nothing here about schools/i);
  assert.doesNotMatch(everything, /Free for life/i);
});

test("the same script with the bar asked for draws it", needsChrome, async () => {
  const template = await templates.getDefault("vanessa-se-only-v11");
  const beats = templates.renderBeats(
    template,
    { firstName: "Myles", company: "DOMO Realty" },
    { showCaptions: true }
  );

  const drawn = await draw(beats, { showCaptions: true, explorers: template.explorers });

  assert.equal(drawn.frameCaptions[0].shown, true, "asked for, it is drawn");
  assert.match(drawn.frameCaptions[0].text, /Your listing format looks really good/);
  assert.match(drawn.frameText[0], /Your listing format looks really good/);
});

/*
 * The bar going away is the `#stage.no-caption` path, which frame.html has had
 * all along for a beat that left its caption empty. Nothing new draws the frame.
 */
test("an empty caption puts the frame on the no-caption path", needsChrome, async () => {
  const outDir = await fsp.mkdtemp(path.join(dataDir, "stage-"));
  const screenshot = await flatPicture(outDir, "listing.png", "0x2f6fae", "1920x1400");

  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(config.root, "views", "frame.html")).toString(), { waitUntil: "load" });

    const look = async (caption) => {
      await page.evaluate(
        (value) => window.renderFrame(value),
        { bg: pathToFileURL(screenshot).toString(), caption, address: ADDRESS, hidePopup: true }
      );
      return page.evaluate(() => {
        const bar = document.getElementById("caption");
        return {
          noCaptionClass: document.getElementById("stage").classList.contains("no-caption"),
          shown: bar.getClientRects().length > 0,
          // Nothing left in the markup either, so a stylesheet change cannot
          // put stale copy back on screen.
          text: (bar.innerText || "").trim(),
        };
      });
    };

    assert.deepEqual(await look({ headline: "", subline: "" }), {
      noCaptionClass: true,
      shown: false,
      text: "",
    });

    const withOne = await look({ headline: SHIPPED_CAPTION, subline: "Here is one of them." });
    assert.equal(withOne.noCaptionClass, false);
    assert.equal(withOne.shown, true);
    assert.match(withOne.text, /Your listing format looks really good/);
  } finally {
    await closeBrowser(browser);
  }
});

/* ---------------------------------------------------------------- */
/* the gate                                                         */
/* ---------------------------------------------------------------- */

test("what counts as a caption being on a frame that did not ask for one", () => {
  const bar = { shown: true, text: SHIPPED_CAPTION };

  assert.match(captionOnScreen({ showCaptions: false, caption: bar }), /top caption bar is drawn on it/);
  assert.match(captionOnScreen({ showCaptions: false, caption: bar }), /Your listing format/);
  // A bar with nothing in it is still a bar: it is a green stripe over their page.
  assert.match(captionOnScreen({ showCaptions: false, caption: { shown: true, text: "" } }), /caption bar is drawn/);

  assert.equal(captionOnScreen({ showCaptions: false, caption: { shown: false, text: "" } }), "");
  assert.equal(captionOnScreen({ showCaptions: false, caption: null }), "");
  // A job that asked for the bar is not policed on it at all.
  assert.equal(captionOnScreen({ showCaptions: true, caption: bar }), "");
});

/*
 * The gate is the belt to frame.html's braces, the way CHROME_ON_BARE_LISTING is.
 *
 * frame.html is made to draw a caption whatever the beat says - which is exactly
 * what a later change that forgets about the toggle would do - and the frame is
 * refused rather than photographed with copy on it that the voice will not match.
 */
test("a caption drawn on a job that switched it off is refused, not filmed", needsChrome, async () => {
  const outDir = await fsp.mkdtemp(path.join(dataDir, "gate-"));
  const screenshot = await flatPicture(outDir, "listing.png", "0x2f6fae", "1920x1400");

  const browser = await launch();
  try {
    const page = await browser.newPage();
    // Installed before any of the page's own scripts, so it survives the
    // navigation renderFrames does and wraps whatever frame.html defines.
    await page.evaluateOnNewDocument((headline) => {
      let real = null;
      Object.defineProperty(window, "renderFrame", {
        configurable: true,
        get() {
          return (spec) => real({ ...spec, caption: { headline, subline: "Here is one of them, as it is today." } });
        },
        set(fn) {
          real = fn;
        },
      });
    }, SHIPPED_CAPTION);

    await assert.rejects(
      () =>
        renderFrames({
          browser: { newPage: async () => page },
          beats: [beat("listing")],
          screenshot,
          address: ADDRESS,
          company: "Scott Rodgers Real Estate",
          explorers: "se",
          showCaptions: false,
          schoolExplorerShots: [],
          explorerShots: {},
          outDir,
          log: () => {},
        }),
      (error) => {
        assert.equal(error.code, "CAPTION_ON_FRAME");
        assert.match(error.message, /Scene 1/);
        assert.match(error.message, /top caption bar is drawn on it/);
        assert.match(error.message, /Your listing format/);
        // And it says what to do about it rather than only saying no.
        assert.match(error.message, /Show the green caption bar/);
        return true;
      }
    );
  } finally {
    await closeBrowser(browser);
  }
});

/* ---------------------------------------------------------------- */
/* the form, and the job it makes                                   */
/* ---------------------------------------------------------------- */

async function startServer() {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const signin = await fetch(`${origin}${TOOL}/api/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "captions-token" }),
  });
  const cookie = signin.headers.getSetCookie()[0].split(";")[0];
  return { origin, cookie, close: () => new Promise((resolve) => server.close(resolve)) };
}

const CUSTOMER = {
  templateId: "vanessa-se-only-v11",
  firstName: "Myles",
  company: "DOMO Realty",
  // Nothing is captured in these tests: the job is read the moment it exists,
  // while the capture is still queued behind a site that does not answer.
  websiteUrl: "http://127.0.0.1:1/",
  customerEmail: "fixture@example.test",
  fromId: "marketing",
};

/** Start a job and read the beats it was built with, without waiting on a render. */
async function beatsOf(tool, payload) {
  const started = await fetch(`${tool.origin}${TOOL}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: tool.cookie },
    body: JSON.stringify({ ...CUSTOMER, ...payload }),
  });
  assert.equal(started.status, 202);
  const { id } = await started.json();
  const job = await store.getJob(id);
  return { id, job };
}

test("a job made with no answer about captions is made without them", async () => {
  const tool = await startServer();
  try {
    const { id, job } = await beatsOf(tool, {});

    // The script it was made from has captions; the beats it will be drawn from
    // do not. That is the whole change, at the point it is decided.
    assert.equal(job.input.showCaptions, false);
    for (const drawn of job.beats) {
      assert.deepEqual(drawn.caption, { headline: "", subline: "" }, drawn.text.slice(0, 40));
    }
    // The words are untouched, so nothing about the recording changed.
    assert.match(job.beats[0].text, /Hey Myles, Claire from Dream Neighborhood/);

    // And the browser is told, so the record and review steps can say so.
    assert.equal(store.publicView(job).input.showCaptions, false);
    assert.ok(id);
  } finally {
    await tool.close();
  }
});

test("ticking the box on the form is what turns them back on", async () => {
  const tool = await startServer();
  try {
    const { job } = await beatsOf(tool, { showCaptions: "yes" });
    assert.equal(job.input.showCaptions, true);
    assert.equal(job.beats[0].caption.headline, SHIPPED_CAPTION);
    assert.equal(store.publicView(job).input.showCaptions, true);

    // The radio the form actually posts, rather than the word "yes".
    const onValue = await beatsOf(tool, { showCaptions: "on" });
    assert.equal(onValue.job.input.showCaptions, true);
  } finally {
    await tool.close();
  }
});

test("anything that is not a yes leaves the captions off", async () => {
  const tool = await startServer();
  try {
    for (const answer of ["", "off", "no", "0", null, undefined, "maybe"]) {
      const { job } = await beatsOf(tool, { showCaptions: answer });
      assert.equal(job.input.showCaptions, false, JSON.stringify(answer));
      assert.equal(job.beats[0].caption.headline, "");
    }
  } finally {
    await tool.close();
  }
});

/* The form has to offer the choice, and offer it off. */
test("the form ships the toggle switched off", () => {
  const page = fs.readFileSync(path.join(config.root, "public", "tool.html"), "utf8");
  const group = page.match(/<div class="choices" role="radiogroup" id="captionChoices">[\s\S]*?<\/div>\s*<\/fieldset>/);
  assert.ok(group, "there is a caption toggle on the form");

  const off = group[0].match(/<input type="radio" name="showCaptions" value="off"[^>]*>/);
  const on = group[0].match(/<input type="radio" name="showCaptions" value="on"[^>]*>/);
  assert.ok(off && on, group[0]);
  assert.match(off[0], /checked/, "off is the one that is picked");
  assert.doesNotMatch(on[0], /checked/, "on is not");
});
