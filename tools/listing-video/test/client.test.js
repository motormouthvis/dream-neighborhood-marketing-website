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
  polls: window.__jobPolls || 0,
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

test.after(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});
