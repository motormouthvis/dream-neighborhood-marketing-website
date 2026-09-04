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

test.after(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});
