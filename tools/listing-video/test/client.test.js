"use strict";

/*
 * The hang Bill hit.
 *
 * His job was created, then the dyno ran out of memory and restarted. Heroku's
 * disk is ephemeral, so the job folder went with it, and the browser polled
 * GET /api/jobs/<id> every two seconds and got 404 forever. The page sat on
 * "Working on it" with no way out.
 *
 * These drive the real front end in real Chrome against the real server.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-client-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "client-test-token";

const config = require("../src/config");
const { launch, closeBrowser } = require("../src/browser");
const app = require("../server");

const TOOL = "/tools/listing-video";
const noChrome = !config.chromePath;
const options = noChrome ? { skip: "no Chrome or Chromium on this machine" } : {};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Start the tool, sign in, and open the page in Chrome. */
async function openTool() {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const signin = await fetch(`${origin}${TOOL}/api/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "client-test-token" }),
  });
  const cookie = signin.headers.getSetCookie()[0].split(";")[0];

  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setCookie({
    name: cookie.split("=")[0],
    value: cookie.split("=").slice(1).join("="),
    domain: "127.0.0.1",
    path: "/",
  });
  await page.goto(`${origin}${TOOL}`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => window.DNLV && window.DNLV.maker, { timeout: 15000 });

  return {
    page,
    origin,
    async close() {
      await closeBrowser(browser);
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const state = () => ({
  failedShown: !document.getElementById("step-failed").hidden,
  progressShown: !document.getElementById("step-progress").hidden,
  why: document.getElementById("failedWhy").textContent.trim(),
  retryBoxShown: !document.getElementById("retryListing").hidden,
  uploadShown: !document.getElementById("uploadEscape").hidden,
  uploadOpen: document.getElementById("uploadEscape").open,
  uploadSummary: document.getElementById("uploadEscapeSummary").textContent.trim(),
  uploadWhy: document.getElementById("uploadEscapeWhy").textContent.trim(),
  polls: window.__jobPolls || 0,
});

/** Answer every job poll with one canned job, which is what a failure looks like. */
function serveJob(job) {
  return (canned) => {
    const real = window.fetch;
    window.fetch = function (url, init) {
      if (typeof url === "string" && /\/api\/jobs\/[a-f0-9]+(\?|$)/.test(url)) {
        return Promise.resolve(
          new Response(JSON.stringify(canned), { status: 200, headers: { "Content-Type": "application/json" } })
        );
      }
      return real(url, init);
    };
  };
}

/* A failed job, as the browser would be handed one. */
const failedJob = (overrides) => ({
  id: "bd7620f10ca57c5459",
  status: "failed",
  progress: ["Opening scottrodgersrealestate.com"],
  template: { name: "School only (v11)" },
  beats: [],
  review: { reviewed: false },
  input: {},
  retryable: true,
  ...overrides,
});

test("opening a video that no longer exists says so instead of spinning", options, async () => {
  const tool = await openTool();
  try {
    // A well-formed id that was never on this box: exactly what a poll sees
    // after the dyno restarted and took the job folder with it.
    await tool.page.evaluate(() => window.DNLV.maker.openJob("bd7620f10ca57c5459"));
    await tool.page.waitForFunction(() => !document.getElementById("step-failed").hidden, { timeout: 10000 });

    const shown = await tool.page.evaluate(state);
    assert.equal(shown.failedShown, true);
    assert.equal(shown.progressShown, false, "it must not still be showing Working on it");
    assert.match(shown.why, /server restarted/i);
    assert.match(shown.why, /try again/i);
    assert.match(shown.why, /paste a listing url/i);
    // There is nothing to retry on a job that is gone, so that box stays away.
    assert.equal(shown.retryBoxShown, false);
  } finally {
    await tool.close();
  }
});

/*
 * The dead end.
 *
 * Bill's panel said "blocked the capture on 4 pages (HTTP 403)" and offered him
 * one thing: paste a listing URL. The URL he had is refused in the same way, so
 * there was nowhere to go. On an HTTP refusal the upload is not an alternative,
 * it is the answer, so it is open and explained rather than folded away.
 */
test("a 403 opens the upload and explains why another URL will not help", options, async () => {
  const tool = await openTool();
  try {
    await tool.page.evaluate(
      serveJob(),
      failedJob({
        error:
          "www.scottrodgersrealestate.com blocked the capture on 4 pages (HTTP 403), so none of them could be read.",
        errorCode: "SITE_BLOCKED",
        failure: { errorCode: "SITE_BLOCKED", httpStatus: 403, reason: "blocked", pageUrl: "" },
      })
    );
    await tool.page.evaluate(() => window.DNLV.maker.openJob("bd7620f10ca57c5459"));
    await tool.page.waitForFunction(() => !document.getElementById("step-failed").hidden, { timeout: 10000 });

    const shown = await tool.page.evaluate(state);
    assert.equal(shown.uploadShown, true, "the upload has to be offered");
    assert.equal(shown.uploadOpen, true, "and opened, because it is the way through");
    assert.match(shown.uploadSummary, /upload a screenshot/i);
    // Say why the obvious thing will not work, rather than leaving him to find out.
    assert.match(shown.uploadWhy, /refused in the same way|refusing an automated browser/i);
    assert.match(shown.uploadWhy, /your own browser/i);

    // The boxes he needs are both there: the picture, and the address as the
    // Explorer's own picker rather than free text a geocoder might misplace.
    const boxes = await tool.page.evaluate(() => ({
      file: document.getElementById("retryListingImage").accept,
      address: Boolean(document.getElementById("retryAddressSearch")),
      suggestions: Boolean(document.getElementById("retryAddressSuggestions")),
    }));
    assert.match(boxes.file, /image\/png/);
    assert.match(boxes.file, /image\/jpeg/);
    assert.ok(boxes.address && boxes.suggestions);
  } finally {
    await tool.close();
  }
});

/*
 * The address on the upload path, in the browser.
 *
 * Bill typed a Peoria address into four free-text boxes and got a video about
 * Smyrna, Georgia. It is one box now, with the Neighborhood Explorer's own
 * suggestions under it, and picking one is what fills the address in - so what the
 * form posts is a place the Explorer named rather than whatever was typed.
 */
test("the address box offers the Explorer's suggestions, and picking one is what fills it in", options, async () => {
  const tool = await openTool();
  try {
    // Answer the suggestions ourselves, so this is about the form and not the
    // Explorer being up.
    const asked = await tool.page.evaluate(() => {
      window.__placeQueries = [];
      const real = window.fetch;
      window.fetch = function (url, init) {
        if (typeof url === "string" && url.includes("/api/places?q=")) {
          window.__placeQueries.push(decodeURIComponent(url.split("q=")[1]));
          return Promise.resolve(
            new Response(
              JSON.stringify({
                reachable: true,
                asked: true,
                suggestions: [
                  { description: "6031 N Rosemead Dr, Peoria, IL 61614", street: "6031 N Rosemead Dr", city: "Peoria", state: "IL", zip: "61614" },
                  { description: "6031 N Rosemary Ct, Peoria, IL 61614", street: "6031 N Rosemary Ct", city: "Peoria", state: "IL", zip: "61614" },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }
        return real(url, init);
      };
      return true;
    });
    assert.equal(asked, true);

    // The address box only exists on the upload path, so choose it first.
    await tool.page.evaluate(() => {
      document.querySelector('input[name="pictureSource"][value="upload"]').click();
    });
    await tool.page.waitForFunction(() => !document.getElementById("uploadField").hidden, { timeout: 5000 });

    await tool.page.focus("#addressSearch");
    await tool.page.type("#addressSearch", "6031 N Rosem", { delay: 12 });
    await tool.page.waitForFunction(
      () => document.querySelectorAll("#addressSuggestions .suggest__item").length > 0,
      { timeout: 5000 }
    );

    const offered = await tool.page.evaluate(() =>
      Array.from(document.querySelectorAll("#addressSuggestions .suggest__item")).map((row) =>
        row.innerText.replace(/\s+/g, " ").trim()
      )
    );
    assert.equal(offered.length, 2, JSON.stringify(offered));
    assert.match(offered[0], /6031 N Rosemead Dr/);
    assert.match(offered[0], /Peoria, IL 61614/);

    // Picking one puts the Explorer's own description in the box and closes the list.
    await tool.page.click("#addressSuggestions .suggest__item");
    const picked = await tool.page.evaluate(() => ({
      value: document.getElementById("addressSearch").value,
      listShown: !document.getElementById("addressSuggestions").hidden,
      // What the form would post, which is the point of all of this.
      queries: window.__placeQueries,
    }));

    assert.equal(picked.value, "6031 N Rosemead Dr, Peoria, IL 61614");
    assert.equal(picked.listShown, false);
    assert.ok(picked.queries.length >= 1, "the Explorer should have been asked");
    assert.equal(picked.queries[picked.queries.length - 1], "6031 N Rosem");
  } finally {
    await tool.close();
  }
});

/*
 * The suggested seconds on a beat, in the editor somebody actually types into.
 *
 * test/beat-timing.test.js covers the arithmetic; this is the wiring - that the
 * number follows the words, that typing over it stops that, and that emptying
 * the box hands it back.
 */
async function openTheScriptEditor(page) {
  await page.evaluate(() => document.querySelector('.tab[data-view="scripts"]').click());
  await page.waitForFunction(() => !document.getElementById("view-scripts").hidden, { timeout: 5000 });
  await page.evaluate(() => document.getElementById("newTemplateBtn").click());
  await page.waitForFunction(() => document.querySelector('[data-role="seconds"]'), { timeout: 5000 });
}

const firstBeat = () => ({
  seconds: document.querySelector('[data-role="seconds"]').value,
  hint: document.querySelector('[data-role="secondsHint"]').textContent.trim(),
  total: document.getElementById("beatTotal").textContent.trim(),
});

test("the suggested seconds follow the words as a beat is written", options, async () => {
  const tool = await openTool();
  try {
    await openTheScriptEditor(tool.page);

    const empty = await tool.page.evaluate(firstBeat);
    assert.equal(empty.seconds, "2.5", "a beat with nothing in it still holds its picture");
    assert.match(empty.hint, /~2\.5s from 0 characters/, empty.hint);
    assert.match(empty.hint, /clears if you type a number/, empty.hint);

    // 64 characters: 1.5s of lead-in plus 4s of reading at 16 a second.
    const line = "Here is the listing, exactly as a buyer sees it on the site.....";
    assert.equal(line.length, 64);
    await tool.page.focus('[data-role="text"]');
    await tool.page.type('[data-role="text"]', line, { delay: 1 });

    const written = await tool.page.evaluate(firstBeat);
    assert.equal(written.seconds, "5.5", "the box should have kept up with the words");
    assert.match(written.total, /5\.5s/, "and the running total with it");
    assert.match(written.hint, /~5\.5s from 64 characters/, written.hint);

    // Deleting words takes it back down; the number is not a high-water mark.
    await tool.page.evaluate(() => {
      const box = document.querySelector('[data-role="text"]');
      box.value = "Short line.";
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const shortened = await tool.page.evaluate(firstBeat);
    assert.equal(shortened.seconds, "2.5");
    assert.match(shortened.hint, /~2\.5s from 11 characters/, shortened.hint);
  } finally {
    await tool.close();
  }
});

/*
 * Bill: "the suggested seconds don't update in real time."
 *
 * The number did move. What it did not do was move on every keystroke - a
 * character or two only shifts the suggestion by a hundredth, so the rounded
 * figure sits still for a few letters at a time and the field reads as stuck.
 *
 * So this watches the hint as well as the number, one character at a time. The
 * hint carries the character count, so it has to change on every single one.
 */
test("the hint under the box moves on every single keystroke", options, async () => {
  const tool = await openTool();
  try {
    await openTheScriptEditor(tool.page);
    await tool.page.focus('[data-role="text"]');

    // No spaces in it, so every keystroke really is one more character - the
    // suggestion ignores the whitespace at either end of a line.
    const seen = [];
    for (const character of "nothing-about-schools".split("")) {
      await tool.page.type('[data-role="text"]', character, { delay: 1 });
      seen.push(await tool.page.evaluate(firstBeat));
    }

    seen.forEach((state, at) => {
      assert.match(
        state.hint,
        new RegExp(`from ${at + 1} character`),
        `after ${at + 1} characters the hint said "${state.hint}"`
      );
    });
    assert.equal(new Set(seen.map((state) => state.hint)).size, seen.length, "every keystroke changed the hint");

    // Nothing waits for the field to lose focus: the box is still being typed in.
    const focused = await tool.page.evaluate(() => document.activeElement.getAttribute("data-role"));
    assert.equal(focused, "text", "and all of that happened without leaving the box");
  } finally {
    await tool.close();
  }
});

test("a duration typed by hand is left alone, and clearing it starts it following again", options, async () => {
  const tool = await openTool();
  try {
    await openTheScriptEditor(tool.page);

    await tool.page.evaluate(() => {
      const seconds = document.querySelector('[data-role="seconds"]');
      seconds.value = "9";
      seconds.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const held = await tool.page.evaluate(firstBeat);
    assert.equal(held.seconds, "9");
    assert.match(held.hint, /held at 9s/i, held.hint);

    // The words change underneath it and the number stays where it was put.
    await tool.page.focus('[data-role="text"]');
    await tool.page.type('[data-role="text"]', "A line of words that would suggest something else entirely.", { delay: 1 });
    const stillHeld = await tool.page.evaluate(firstBeat);
    assert.equal(stillHeld.seconds, "9", "somebody chose 9, so it stays 9");
    // The suggestion is still shown while it is being overruled, so the way
    // back is a number you can see rather than one you have to work out.
    assert.match(stillHeld.hint, /~5\.2s from 59 characters/, stillHeld.hint);
    assert.match(stillHeld.hint, /Empty the box to follow the words again/, stillHeld.hint);

    // Emptying the box is the way back.
    await tool.page.evaluate(() => {
      const seconds = document.querySelector('[data-role="seconds"]');
      seconds.value = "";
      seconds.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const following = await tool.page.evaluate(firstBeat);
    assert.equal(following.seconds, "5.2", "59 characters: 1.5 + 59/16");
    assert.match(following.hint, /~5\.2s from 59 characters/, following.hint);
    assert.match(following.hint, /clears if you type a number/, following.hint);
  } finally {
    await tool.close();
  }
});

/*
 * The bug behind "it only updates sometimes".
 *
 * Whether a beat followed its words was worked out by asking whether the saved
 * number happened to equal the suggestion. Every shipped beat was hand-timed
 * against the reference video, so none of them match - and opening one of those
 * scripts gave a box that never moved again however much the words changed.
 *
 * It is saved with the beat now, so re-opening a script remembers which beats
 * were following and which were held.
 */
test("re-opening a saved script remembers which beats were following the words", options, async () => {
  const tool = await openTool();
  try {
    await openTheScriptEditor(tool.page);

    // Beat one follows its words. Beat two is held at a number of its own.
    await tool.page.type('[data-role="text"]', "The first line.", { delay: 1 });
    await tool.page.evaluate(() => {
      document.getElementById("tplName").value = "Two beats";
      document.getElementById("addBeatBtn").click();
    });
    await tool.page.evaluate(() => {
      const rows = document.querySelectorAll(".beatrow");
      const text = rows[1].querySelector('[data-role="text"]');
      text.value = "The second line.";
      text.dispatchEvent(new Event("input", { bubbles: true }));
      const seconds = rows[1].querySelector('[data-role="seconds"]');
      seconds.value = "11";
      seconds.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await tool.page.evaluate(() => document.getElementById("saveTemplateBtn").click());
    await tool.page.waitForFunction(() => !document.getElementById("editorOk").hidden, { timeout: 5000 });

    // Back out to the list and open it again, the way anybody would.
    await tool.page.evaluate(() => document.getElementById("cancelTemplateBtn").click());
    await tool.page.waitForFunction(() => !document.getElementById("scriptsList").hidden, { timeout: 5000 });
    await tool.page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("#templateList .card"));
      const mine = cards.find((card) => card.textContent.includes("Two beats"));
      Array.from(mine.querySelectorAll("button")).find((button) => button.textContent === "Edit").click();
    });
    await tool.page.waitForFunction(() => document.querySelectorAll(".beatrow").length === 2, { timeout: 5000 });

    const reopened = await tool.page.evaluate(() =>
      Array.from(document.querySelectorAll(".beatrow")).map((row) => ({
        seconds: row.querySelector('[data-role="seconds"]').value,
        hint: row.querySelector('[data-role="secondsHint"]').textContent.trim(),
      }))
    );

    assert.match(reopened[0].hint, /clears if you type a number/, reopened[0].hint);
    assert.match(reopened[1].hint, /Held at 11s/, reopened[1].hint);

    // And the one that follows still follows: typing into it moves the number.
    await tool.page.evaluate(() => {
      const box = document.querySelector('.beatrow [data-role="text"]');
      box.value = "The first line, made considerably longer than it was before.";
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const after = await tool.page.evaluate(firstBeat);
    assert.notEqual(after.seconds, reopened[0].seconds, "it is still following the words");
    assert.match(after.hint, /from 60 characters/, after.hint);
  } finally {
    await tool.close();
  }
});

test("another kind of failure offers the upload too, but closed", options, async () => {
  const tool = await openTool();
  try {
    await tool.page.evaluate(
      serveJob(),
      failedJob({
        error: "No single listing page could be found on redwagonteam.com.",
        errorCode: "NO_LISTING_FOUND",
        failure: { errorCode: "NO_LISTING_FOUND", httpStatus: null, reason: "no listing", pageUrl: "" },
      })
    );
    await tool.page.evaluate(() => window.DNLV.maker.openJob("bd7620f10ca57c5459"));
    await tool.page.waitForFunction(() => !document.getElementById("step-failed").hidden, { timeout: 10000 });

    const shown = await tool.page.evaluate(state);
    assert.equal(shown.retryBoxShown, true, "pasting a URL is still the first thing to try here");
    assert.equal(shown.uploadShown, true);
    assert.equal(shown.uploadOpen, false, "it is a way out, not the recommendation");
  } finally {
    await tool.close();
  }
});

test("a job that is gone offers neither, because there is nothing to upload against", options, async () => {
  const tool = await openTool();
  try {
    await tool.page.evaluate(() => window.DNLV.maker.openJob("bd7620f10ca57c5459"));
    await tool.page.waitForFunction(() => !document.getElementById("step-failed").hidden, { timeout: 10000 });

    const shown = await tool.page.evaluate(state);
    assert.match(shown.why, /server restarted/i);
    assert.equal(shown.retryBoxShown, false);
    assert.equal(shown.uploadShown, false);
  } finally {
    await tool.close();
  }
});

/*
 * The upload is an alternative to the live site, not an extra. Two answers to
 * one question would mean the upload winning silently while the pasted URL
 * looked ignored.
 */
test("picking the upload on the form puts the listing URL box away", options, async () => {
  const tool = await openTool();
  try {
    const pick = (value) =>
      tool.page.evaluate((wanted) => {
        const input = document.querySelector('input[name="pictureSource"][value="' + wanted + '"]');
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return {
          uploadShown: !document.getElementById("uploadField").hidden,
          urlShown: !document.getElementById("listingUrlField").hidden,
        };
      }, value);

    assert.deepEqual(await pick("site"), { uploadShown: false, urlShown: true });
    assert.deepEqual(await pick("upload"), { uploadShown: true, urlShown: false });
    assert.deepEqual(await pick("site"), { uploadShown: false, urlShown: true });
  } finally {
    await tool.close();
  }
});

test("a job that vanishes mid-render stops the polling", options, async () => {
  const tool = await openTool();
  try {
    // Answer the first couple of polls as a job being worked on, then 404 every
    // one after that, which is what a restart looks like from the browser.
    // startPolling checks straight away, so the job has to survive more than one
    // poll for the progress panel to be observable at all.
    await tool.page.evaluate(() => {
      window.__jobPolls = 0;
      const real = window.fetch;
      window.fetch = function (url, init) {
        if (typeof url === "string" && /\/api\/jobs\/[a-f0-9]+(\?|$)/.test(url)) {
          window.__jobPolls += 1;
          if (window.__jobPolls <= 2) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: "bd7620f10ca57c5459",
                  status: "capturing",
                  progress: ["Opening redwagonteam.com", "Looking for one of their listing pages"],
                  template: { name: "School only (v11)" },
                  beats: [],
                  review: { reviewed: false },
                  input: {},
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              )
            );
          }
          return Promise.resolve(new Response('{"error":"That video was not found."}', { status: 404 }));
        }
        return real(url, init);
      };
    });

    await tool.page.evaluate(() => window.DNLV.maker.openJob("bd7620f10ca57c5459"));

    // First it shows progress, as it should.
    await tool.page.waitForFunction(() => !document.getElementById("step-progress").hidden, { timeout: 10000 });
    const working = await tool.page.evaluate(state);
    assert.equal(working.progressShown, true);

    // Then the job disappears and it has to stop, not poll forever.
    await tool.page.waitForFunction(() => !document.getElementById("step-failed").hidden, { timeout: 15000 });
    const gone = await tool.page.evaluate(state);
    assert.match(gone.why, /server restarted/i);

    const pollsWhenItGaveUp = gone.polls;
    await sleep(6000);
    const after = await tool.page.evaluate(state);
    assert.equal(
      after.polls,
      pollsWhenItGaveUp,
      `polling carried on after giving up (${pollsWhenItGaveUp} then ${after.polls})`
    );
    assert.equal(after.failedShown, true);
  } finally {
    await tool.close();
  }
});

test("the progress panel shows how long it has been running", options, async () => {
  const tool = await openTool();
  try {
    await tool.page.evaluate(() => {
      const real = window.fetch;
      window.fetch = function (url, init) {
        if (typeof url === "string" && /\/api\/jobs\/[a-f0-9]+(\?|$)/.test(url)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "bd7620f10ca57c5459",
                status: "capturing",
                progress: ["Opening redwagonteam.com"],
                template: { name: "School only (v11)" },
                beats: [],
                review: { reviewed: false },
                input: {},
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }
        return real(url, init);
      };
    });

    await tool.page.evaluate(() => window.DNLV.maker.openJob("bd7620f10ca57c5459"));
    await tool.page.waitForFunction(
      () => /Running for/.test(document.getElementById("progressElapsed").textContent),
      { timeout: 10000 }
    );
    const text = await tool.page.evaluate(() => document.getElementById("progressElapsed").textContent.trim());
    assert.match(text, /Running for \d+:\d\d/);
  } finally {
    await tool.close();
  }
});

/* ---------------------------------------------------------------- */
/* trimming the end off, on the final review                        */
/* ---------------------------------------------------------------- */

const store = require("../src/store");
const templates = require("../src/templates");
const { buildVideo } = require("../src/video");
const { buildRecordedTrack } = require("../src/audio");
const { run } = require("../src/exec");

/** A job sitting on the final review with a real finished video behind it. */
async function jobOnFinalReview(durations, voiceSeconds) {
  const template = await templates.getDefault("vanessa-se-only-v11");
  const input = {
    templateId: template.id,
    firstName: "Bill",
    company: "Trim Realty",
    websiteUrl: "https://example.test/",
    listingUrl: "",
    customerEmail: "fixture@example.test",
    fromId: "bill",
  };
  const job = await store.createJob({ input, template, beats: templates.renderBeats(template, input) });
  const dir = store.jobDir(job.id);
  await fsp.mkdir(dir, { recursive: true });

  const raw = path.join(dir, "raw.wav");
  await run(config.ffmpegPath, [
    "-y", "-f", "lavfi", "-i", `sine=frequency=320:duration=${voiceSeconds}`,
    "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", raw,
  ]);
  const track = await buildRecordedTrack({ uploadPath: raw, workDir: dir, log: () => {} });

  const frames = [];
  for (let i = 0; i < durations.length; i += 1) {
    const frame = path.join(dir, `f${i}.jpg`);
    await run(config.ffmpegPath, [
      "-y", "-f", "lavfi", "-i", `color=c=0x2${i}4${i}3${i}:s=1920x1080`, "-frames:v", "1", frame,
    ]);
    frames.push(frame);
  }
  const video = await buildVideo({
    frames, durations, audioFile: track.audioFile, workDir: dir,
    outFile: path.join(dir, "video.mp4"), log: () => {},
  });

  job.silent = { frames, posterFile: "", capturedPageUrl: "", capturedAddress: null, notes: [] };
  job.result = {
    videoFile: video.file, posterFile: "", durationSeconds: Math.round(video.duration),
    voice: { mode: "recorded", engine: "recorded", label: "Your recorded voice" },
    templateName: template.name, sceneCount: durations.length, notes: [],
  };
  job.status = "ready";
  await store.persist(job);
  return { job, duration: video.duration };
}

test("the trim button is the exact label, and only works from a pause", options, async () => {
  const { job } = await jobOnFinalReview([4, 4, 4], 12);
  const tool = await openTool();
  try {
    await tool.page.evaluate((id) => window.DNLV.maker.openJob(id), job.id);
    await tool.page.waitForFunction(() => !document.getElementById("step-review").hidden, { timeout: 15000 });
    await tool.page.waitForFunction(() => (document.getElementById("reviewPlayer").duration || 0) > 1, {
      timeout: 15000,
    });

    // Bill asked for this label, exactly.
    assert.equal(
      await tool.page.$eval("#trimBtn", (button) => button.textContent),
      "Trim Remainder of Video"
    );

    // Not paused, so there is nothing to trim at - and no trimming at 0 by accident.
    assert.equal(await tool.page.$eval("#trimBtn", (button) => button.disabled), true);

    await tool.page.evaluate(() => {
      const player = document.getElementById("reviewPlayer");
      player.currentTime = 9;
      player.pause();
    });
    await tool.page.waitForFunction(() => !document.getElementById("trimBtn").disabled, { timeout: 10000 });
    const hint = await tool.page.evaluate(() => document.getElementById("trimHint").textContent.trim());
    assert.match(hint, /would end at/i, `the hint should say what it will do, got ${JSON.stringify(hint)}`);
  } finally {
    await tool.close();
  }
});

test("after a trim the player holds the shorter file, sitting at its new end", options, async () => {
  const { job, duration } = await jobOnFinalReview([4, 4, 4], 12);
  const tool = await openTool();
  try {
    tool.page.on("dialog", (dialog) => dialog.accept());
    await tool.page.evaluate((id) => window.DNLV.maker.openJob(id), job.id);
    await tool.page.waitForFunction(() => !document.getElementById("step-review").hidden, { timeout: 15000 });
    await tool.page.waitForFunction(() => (document.getElementById("reviewPlayer").duration || 0) > 1, {
      timeout: 15000,
    });

    await tool.page.evaluate(() => {
      const player = document.getElementById("reviewPlayer");
      player.currentTime = 9;
      player.pause();
    });
    await tool.page.waitForFunction(() => !document.getElementById("trimBtn").disabled, { timeout: 10000 });
    await tool.page.click("#trimBtn");
    await tool.page.waitForFunction(() => !document.getElementById("trimOk").hidden, { timeout: 90000 });

    // The player reloads the shorter file and sits just before its new end.
    await tool.page.waitForFunction(
      () => {
        const player = document.getElementById("reviewPlayer");
        return player.duration > 1 && player.duration < 10 && player.currentTime > player.duration - 1;
      },
      { timeout: 20000 }
    );

    const shown = await tool.page.evaluate(() => {
      const player = document.getElementById("reviewPlayer");
      return {
        duration: player.duration,
        at: player.currentTime,
        paused: player.paused,
        sendOff: document.getElementById("sendBtn").disabled,
      };
    });
    assert.ok(Math.abs(shown.duration - 9) < 0.4, `player has a ${shown.duration.toFixed(2)}s file, wanted 9s`);
    assert.ok(shown.at > shown.duration - 1, "it sits at the new end, not back at zero");
    assert.equal(shown.paused, true, "and it is not playing the last second at them");
    assert.equal(shown.sendOff, true, "send is off until the shorter video is reviewed");

    // The old, longer file is gone; this is what would be sent.
    const fresh = await store.getJob(job.id);
    assert.equal(fresh.result.durationSeconds, 9, "the file on disk ends where they paused it");
    assert.ok(fresh.result.durationSeconds < duration - 1, `it was ${duration.toFixed(2)}s and is not shorter`);
    assert.equal(fresh.review.reviewed, false);
  } finally {
    await tool.close();
  }
});

/* ---------------------------------------------------------------- */
/* recording: the words beside the pictures                          */
/* ---------------------------------------------------------------- */

const { buildSilentVideo } = require("../src/video");

/** A job sitting on the record step, with a real silent video behind it. */
async function jobOnRecordStep() {
  const { job } = await jobOnFinalReview([4, 4, 4, 4, 4, 4, 4, 4, 4], 12);
  const dir = store.jobDir(job.id);
  const silent = await buildSilentVideo({
    frames: job.silent.frames,
    durations: job.beats.map((beat) => beat.seconds),
    workDir: dir,
    outFile: path.join(dir, "silent.mp4"),
    log: () => {},
  });
  job.silent.file = silent.file;
  job.silent.durationSeconds = silent.duration;
  job.status = "silent-ready";
  await store.persist(job);
  return job;
}

test("the script sits beside the video, not under it", options, async () => {
  const job = await jobOnRecordStep();
  const tool = await openTool();
  try {
    await tool.page.setViewport({ width: 1440, height: 1000 });
    await tool.page.evaluate((id) => window.DNLV.maker.openJob(id), job.id);
    await tool.page.waitForFunction(() => !document.getElementById("step-record").hidden, { timeout: 15000 });
    await tool.page.waitForFunction(() => document.querySelectorAll("#beatList .beat").length > 0, { timeout: 10000 });

    const layout = await tool.page.evaluate(() => {
      const video = document.getElementById("silentPlayer").getBoundingClientRect();
      const script = document.getElementById("promptWrap").getBoundingClientRect();
      return {
        beats: document.querySelectorAll("#beatList .beat").length,
        beside: script.left >= video.right - 4,
        alongside: script.top < video.bottom,
        scriptWide: script.width > 200,
        videoWide: video.width > 380,
        scrolls: getComputedStyle(document.getElementById("beatList")).overflowY,
      };
    });

    assert.ok(layout.beats > 1, "the script has to be on the page at all");
    assert.ok(layout.beside, "the script starts to the right of the video");
    assert.ok(layout.alongside, "and on the same row, not below it");
    assert.ok(layout.scriptWide, `the script column is only ${layout.scriptWide} wide`);
    assert.ok(layout.videoWide, "the video keeps its size");
    assert.equal(layout.scrolls, "auto", "the words scroll on their own");
  } finally {
    await tool.close();
  }
});

test("the line being spoken is highlighted and scrolls itself as the video plays", options, async () => {
  const job = await jobOnRecordStep();
  const tool = await openTool();
  try {
    // Narrow enough that the list has to scroll to follow the playhead.
    await tool.page.setViewport({ width: 1200, height: 620 });
    await tool.page.evaluate((id) => window.DNLV.maker.openJob(id), job.id);
    await tool.page.waitForFunction(() => !document.getElementById("step-record").hidden, { timeout: 15000 });
    await tool.page.waitForFunction(() => (document.getElementById("silentPlayer").duration || 0) > 1, {
      timeout: 15000,
    });

    const at = async (seconds) => {
      await tool.page.evaluate((secs) => {
        document.getElementById("silentPlayer").currentTime = secs;
      }, seconds);
      await sleep(700);
      return tool.page.evaluate(() => {
        const list = document.getElementById("beatList");
        const on = list.querySelector(".beat.is-on");
        if (!on) return null;
        const box = on.getBoundingClientRect();
        const frame = list.getBoundingClientRect();
        return {
          index: Array.prototype.indexOf.call(list.children, on),
          inView: box.top >= frame.top - 2 && box.bottom <= frame.bottom + 2,
          scrollTop: Math.round(list.scrollTop),
        };
      });
    };

    // 4s a scene, so these land on different lines.
    const early = await at(2);
    const middle = await at(18);
    const late = await at(33);

    assert.equal(early.index, 0, "the first line is on at the start");
    assert.ok(middle.index > early.index, `middle beat ${middle.index} should be after ${early.index}`);
    assert.ok(late.index > middle.index, `late beat ${late.index} should be after ${middle.index}`);

    // Exactly one line is lit, and it is the one you can see.
    const lit = await tool.page.evaluate(() => document.querySelectorAll("#beatList .beat.is-on").length);
    assert.equal(lit, 1);
    assert.equal(late.inView, true, "the line being spoken is scrolled into view");
    assert.ok(late.scrollTop > 0, "which means the list scrolled itself");
  } finally {
    await tool.close();
  }
});

/* ---------------------------------------------------------------- */
/* the voice, now picked on this step rather than on the form         */
/* ---------------------------------------------------------------- */

/*
 * Bill asked for the ElevenLabs voice picks to come off the first page and live
 * with the other audio choices. So the radios are inside "Other ways to add the
 * voice", next to the button that uses them, and the pick has to travel with
 * that press - it can be changed right up to the moment it is used.
 *
 * The account is not asked for anything here: the session answer is topped up
 * with two voices in the browser, so this is about the page and not about
 * ElevenLabs being reachable.
 */
const OFFERED = [
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", sex: "female" },
  { id: "PGqDc9SLzJTxDTy8SjYb", name: "Dan", sex: "male" },
];

async function toolWithVoices(voices) {
  const tool = await openTool();
  await tool.page.evaluateOnNewDocument((list) => {
    window.__aiPosts = [];
    const real = window.fetch;
    window.fetch = function (url, init) {
      if (typeof url === "string" && /\/api\/session$/.test(url)) {
        return real(url, init).then((response) =>
          response.json().then((body) => {
            body.aiVoice = { available: true, label: "ElevenLabs", voices: list, defaultVoiceId: list[0].id };
            return new Response(JSON.stringify(body), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          })
        );
      }
      if (typeof url === "string" && /\/ai-voice$/.test(url)) {
        window.__aiPosts.push(String((init && init.body) || ""));
        return Promise.resolve(
          new Response(JSON.stringify({ id: "x" }), { status: 202, headers: { "Content-Type": "application/json" } })
        );
      }
      return real(url, init);
    };
  }, voices);
  await tool.page.reload({ waitUntil: "networkidle2" });
  await tool.page.waitForFunction(() => window.DNLV && window.DNLV.maker, { timeout: 15000 });
  await tool.page.waitForFunction(() => document.querySelectorAll('input[name="voiceId"]').length > 0, {
    timeout: 15000,
  });
  return tool;
}

test("the voice picker is with the other audio options, not on the form", options, async () => {
  const job = await jobOnRecordStep();
  const tool = await toolWithVoices(OFFERED);
  try {
    const onTheForm = await tool.page.evaluate(() =>
      document.getElementById("form").contains(document.getElementById("voiceField"))
    );
    assert.equal(onTheForm, false, "the first page is left lean");

    await tool.page.evaluate((id) => window.DNLV.maker.openJob(id), job.id);
    await tool.page.waitForFunction(() => !document.getElementById("step-record").hidden, { timeout: 15000 });

    const shown = await tool.page.evaluate(() => {
      const box = document.getElementById("aiBtn").closest("details");
      return {
        summary: box.querySelector("summary").textContent.trim(),
        // The picker is inside that same fold, above the button that spends it.
        voicesInside: box.contains(document.getElementById("voiceField")),
        usageInside: box.contains(document.getElementById("voiceUsage")),
        aboveTheButton: Boolean(
          document.getElementById("voiceField").compareDocumentPosition(document.getElementById("aiBtn")) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ),
        pickerShown: !document.getElementById("voiceField").hidden,
        picked: (document.querySelector('input[name="voiceId"]:checked') || {}).value || "",
        note: document.getElementById("aiNote").textContent.trim(),
      };
    });

    assert.match(shown.summary, /other ways to add the voice/i);
    assert.equal(shown.voicesInside, true);
    assert.equal(shown.usageInside, true, "the ElevenLabs allowance card comes with it");
    assert.equal(shown.aboveTheButton, true, "pick the voice, then press the button");
    assert.equal(shown.pickerShown, true);
    assert.equal(shown.picked, OFFERED[0].id, "Jessica is still the default");
    assert.match(shown.note, /Jessica \(female\)/);
  } finally {
    await tool.close();
  }
});

test("a voice changed on the record step is the one the AI button asks for", options, async () => {
  const job = await jobOnRecordStep();
  const tool = await toolWithVoices(OFFERED);
  try {
    await tool.page.evaluate((id) => window.DNLV.maker.openJob(id), job.id);
    await tool.page.waitForFunction(() => !document.getElementById("step-record").hidden, { timeout: 15000 });

    // Pick the man, the way somebody in the fold would.
    await tool.page.evaluate((id) => {
      const radio = document.querySelector(`input[name="voiceId"][value="${id}"]`);
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
    }, OFFERED[1].id);

    // The note under the button follows the pick, rather than naming whatever
    // the job was booked with when it was made.
    const note = await tool.page.evaluate(() => document.getElementById("aiNote").textContent.trim());
    assert.match(note, /Dan \(male\)/, note);

    await tool.page.evaluate(() => document.getElementById("aiBtn").click());
    await tool.page.waitForFunction(() => (window.__aiPosts || []).length > 0, { timeout: 10000 });

    const posted = await tool.page.evaluate(() => JSON.parse(window.__aiPosts[0]));
    assert.equal(posted.voiceId, OFFERED[1].id, `the press carried ${JSON.stringify(posted)}`);
  } finally {
    await tool.close();
  }
});

/* ---------------------------------------------------------------- */
/* trimming: the step is covered until the new file is on the player */
/* ---------------------------------------------------------------- */

test("a trim covers the step and blocks sending until the new file is back", options, async () => {
  const { job } = await jobOnFinalReview([6, 6, 6], 16);
  const tool = await openTool();
  try {
    tool.page.on("dialog", (dialog) => dialog.accept());
    await tool.page.evaluate((id) => window.DNLV.maker.openJob(id), job.id);
    await tool.page.waitForFunction(() => !document.getElementById("step-review").hidden, { timeout: 15000 });
    await tool.page.waitForFunction(() => (document.getElementById("reviewPlayer").duration || 0) > 1, {
      timeout: 15000,
    });

    // Reviewed, so it is provable that trimming switches sending back off.
    await tool.page.evaluate(() => document.getElementById("reviewedBox").click());
    await sleep(600);

    await tool.page.evaluate(() => {
      const player = document.getElementById("reviewPlayer");
      player.currentTime = 9;
      player.pause();
    });
    await tool.page.waitForFunction(() => !document.getElementById("trimBtn").disabled, { timeout: 10000 });
    await tool.page.click("#trimBtn");

    await tool.page.waitForFunction(() => !document.getElementById("trimOverlay").hidden, { timeout: 15000 });
    const covered = await tool.page.evaluate(() => {
      const over = document.getElementById("trimOverlay").getBoundingClientRect();
      // Geometry, not elementFromPoint: a control scrolled off screen is still
      // covered, and elementFromPoint only answers for what is in the viewport.
      const under = (id) => {
        const box = document.getElementById(id).getBoundingClientRect();
        return box.top >= over.top - 1 && box.bottom <= over.bottom + 1;
      };
      return {
        sendDisabled: document.getElementById("sendBtn").disabled,
        sendLabel: document.getElementById("sendBtn").textContent.trim(),
        reviewBoxDisabled: document.getElementById("reviewedBox").disabled,
        trimBtnDisabled: document.getElementById("trimBtn").disabled,
        sendUnder: under("sendBtn"),
        copyUnder: under("copyBtn"),
        backUnder: under("redoAudioBtn"),
        canStopWaiting: !document.getElementById("trimStopWaitingBtn").disabled,
      };
    });

    assert.equal(covered.sendDisabled, true, "nothing is sent while the file is being cut");
    assert.match(covered.sendLabel, /trimming/i);
    assert.equal(covered.reviewBoxDisabled, true, "and it cannot be marked reviewed either");
    assert.equal(covered.trimBtnDisabled, true, "nor trimmed twice");
    assert.equal(covered.sendUnder, true, "the cover is over the send button");
    assert.equal(covered.copyUnder, true, "and the copy link");
    assert.equal(covered.backUnder, true, "and back to recording");
    assert.equal(covered.canStopWaiting, true, "there is a way out of waiting");

    // And it comes back with the shorter file, still needing a review.
    await tool.page.waitForFunction(() => document.getElementById("trimOverlay").hidden, { timeout: 180000 });
    await sleep(1200);
    const after = await tool.page.evaluate(() => ({
      duration: document.getElementById("reviewPlayer").duration,
      sendDisabled: document.getElementById("sendBtn").disabled,
      ok: document.getElementById("trimOk").textContent.trim(),
      err: document.getElementById("trimError").textContent.trim(),
    }));
    assert.ok(Math.abs(after.duration - 9) < 0.4, `player has ${after.duration}s, wanted the trimmed 9s`);
    assert.equal(after.err, "", "no error on a trim that worked");
    assert.match(after.ok, /watch it again/i);
    assert.equal(after.sendDisabled, true, "send stays off until the shorter cut is reviewed");
  } finally {
    await tool.close();
  }
});

/* ---------------------------------------------------------------- */
/* the way back off the record step                                  */
/* ---------------------------------------------------------------- */

/*
 * Bill, on the silent video: when it is done, or failed, or just looks wrong,
 * there was no way back. The record step offered one thing - record - and the
 * only button that returned to the form was on the FINISHED step, two takes and
 * a mux later. So changing a script meant recording something he did not want,
 * waiting for it to be muxed, and starting again from an empty page.
 */

/** Fill the form in the way somebody would, without submitting it. */
async function fillTheForm(page) {
  await page.evaluate(() => {
    document.getElementById("firstName").value = "Vanessa";
    document.getElementById("company").value = "DOMO Realty";
    document.getElementById("websiteUrl").value = "https://domorealty.example";
    document.getElementById("customerEmail").value = "vanessa@domorealty.example";
    ["firstName", "company", "websiteUrl", "customerEmail"].forEach((id) => {
      document.getElementById(id).dispatchEvent(new Event("input", { bubbles: true }));
    });
    const script = document.querySelector('input[name="templateId"]');
    script.checked = true;
    script.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

test("the record step has a way back to the form, and it keeps the answers", options, async () => {
  const job = await jobOnRecordStep();
  const tool = await openTool();
  try {
    await fillTheForm(tool.page);
    await tool.page.evaluate((id) => window.DNLV.maker.openJob(id), job.id);
    await tool.page.waitForFunction(() => !document.getElementById("step-record").hidden, { timeout: 15000 });

    // The way out is on the page, before anything has been recorded.
    const offered = await tool.page.evaluate(() => ({
      edit: document.getElementById("editInputsBtn").textContent.trim(),
      remake: document.getElementById("remakeSilentBtn").textContent.trim(),
      editShown: Boolean(document.getElementById("editInputsBtn").offsetParent),
    }));
    assert.match(offered.edit, /change the script, customer or listing/i);
    assert.match(offered.remake, /film it again/i);
    assert.equal(offered.editShown, true, "it is visible without opening anything");

    await tool.page.click("#editInputsBtn");
    await tool.page.waitForFunction(() => !document.getElementById("step-form").hidden, { timeout: 10000 });

    const back = await tool.page.evaluate(() => ({
      recordShown: !document.getElementById("step-record").hidden,
      firstName: document.getElementById("firstName").value,
      company: document.getElementById("company").value,
      website: document.getElementById("websiteUrl").value,
      email: document.getElementById("customerEmail").value,
      script: (document.querySelector('input[name="templateId"]:checked') || {}).value || "",
      why: document.getElementById("rememberedNote2").textContent.trim(),
      whyShown: !document.getElementById("rememberedNote2").hidden,
      playing: !document.getElementById("silentPlayer").paused,
      makeEnabled: !document.getElementById("makeBtn").disabled,
    }));

    assert.equal(back.recordShown, false, "it really left the record step");
    // Every answer is still there. This is a step backwards, not a fresh start.
    assert.equal(back.firstName, "Vanessa");
    assert.equal(back.company, "DOMO Realty");
    assert.equal(back.website, "https://domorealty.example");
    assert.equal(back.email, "vanessa@domorealty.example");
    assert.ok(back.script, "and the script is still picked");
    assert.equal(back.makeEnabled, true, "so it can be made again straight away");

    assert.equal(back.whyShown, true);
    assert.match(back.why, /still here/i, back.why);
    assert.match(back.why, /Library/i, "and it says the video that was made is not lost");
    assert.equal(back.playing, false, "the silent video is not left playing to itself");

    // The job that was already made is untouched and still in the Library.
    const untouched = await store.getJob(job.id);
    assert.equal(untouched.status, "silent-ready");
  } finally {
    await tool.close();
  }
});

test("the finished video has the same way back, and sends nothing on the way", options, async () => {
  const { job } = await jobOnFinalReview([4, 4, 4], 12);
  const tool = await openTool();
  try {
    await fillTheForm(tool.page);
    await tool.page.evaluate((id) => window.DNLV.maker.openJob(id), job.id);
    await tool.page.waitForFunction(() => !document.getElementById("step-review").hidden, { timeout: 15000 });

    await tool.page.click("#reviewEditInputsBtn");
    await tool.page.waitForFunction(() => !document.getElementById("step-form").hidden, { timeout: 10000 });

    const back = await tool.page.evaluate(() => ({
      firstName: document.getElementById("firstName").value,
      why: document.getElementById("rememberedNote2").textContent.trim(),
      playing: !document.getElementById("reviewPlayer").paused,
    }));
    assert.equal(back.firstName, "Vanessa", "the answers came back with it");
    assert.match(back.why, /nothing has been sent/i, back.why);
    assert.equal(back.playing, false);

    const untouched = await store.getJob(job.id);
    assert.equal(untouched.status, "ready");
    assert.ok(!untouched.email || !untouched.email.sent, "and nothing was emailed");
  } finally {
    await tool.close();
  }
});

/*
 * "Film it again, same answers" is for the case where nothing needs changing
 * and the capture simply came out wrong - it found a listing that was not their
 * best one, or the page had not settled.
 */
test("filming it again reuses the same job rather than starting from nothing", options, async () => {
  const job = await jobOnRecordStep();
  const tool = await openTool();
  try {
    /*
     * The recapture is the only thing under test here; the Chrome walk behind
     * it is covered elsewhere. Once it has been asked for, the job answers as
     * one being worked on - which is what the server really does, since it
     * claims the job before it replies.
     */
    await tool.page.evaluate(() => {
      window.__recaptured = [];
      const real = window.fetch;
      window.fetch = function (url, init) {
        if (typeof url === "string" && /\/recapture$/.test(url)) {
          window.__recaptured.push({ url: url, body: init && init.body });
          return Promise.resolve(new Response('{"id":"x"}', { status: 202 }));
        }
        if (window.__recaptured.length && typeof url === "string" && /\/api\/jobs\/[a-z0-9]+(\?|$)/i.test(url)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "again",
                status: "capturing",
                progress: ["Trying the capture again"],
                template: { name: "School only (v11)" },
                beats: [],
                review: { reviewed: false },
                input: {},
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }
        return real(url, init);
      };
    });

    await tool.page.evaluate((id) => window.DNLV.maker.openJob(id), job.id);
    await tool.page.waitForFunction(() => !document.getElementById("step-record").hidden, { timeout: 15000 });
    await tool.page.click("#remakeSilentBtn");
    await tool.page.waitForFunction(() => !document.getElementById("step-progress").hidden, { timeout: 10000 });

    const asked = await tool.page.evaluate(() => ({
      calls: window.__recaptured,
      steps: Array.from(document.querySelectorAll("#steps li")).map((item) => item.textContent.trim()),
      recordShown: !document.getElementById("step-record").hidden,
      formShown: !document.getElementById("step-form").hidden,
    }));

    assert.equal(asked.calls.length, 1, "one recapture, on the job that already exists");
    assert.ok(asked.calls[0].url.includes(job.id), asked.calls[0].url);
    // No listing URL: the point of this button is that the answers do not change.
    assert.deepEqual(JSON.parse(asked.calls[0].body), {});
    assert.equal(asked.recordShown, false, "it left the record step");
    assert.equal(asked.formShown, false, "and it did not send him back to the form to type it all in");
    assert.ok(asked.steps.some((line) => /again/i.test(line)), asked.steps.join(" | "));
  } finally {
    await tool.close();
  }
});

test.after(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});
