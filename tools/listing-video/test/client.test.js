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
  await templates.ensureSeeded();
  const template = await templates.getTemplate("vanessa-se-only-v11");
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

test.after(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});
