"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { launch, closeBrowser } = require("./browser");
const { captureListing, CAPTURE_BUDGET_MS } = require("./capture");
const { captureExplorerTabs, WALK_BUDGET_MS } = require("./explorer");
const { locateAddress } = require("./geocode");
const { renderFrames } = require("./frames");
const { buildAiVoiceTrack, buildRecordedTrack } = require("./audio");
const { buildSilentVideo, buildVideo, buildPoster, trimVideoAt } = require("./video");
const store = require("./store");

/**
 * Run something with a hard stop.
 *
 * Capture polices its own budget, but a wedged Chrome can stop answering
 * altogether, and on a 512MB dyno the next thing that happens is the whole web
 * process being killed for memory. So there is an outer deadline that does not
 * depend on Chrome replying, and it takes the browser down with it.
 */
/** Which part of making the video gave up, so the log can be read at a glance. */
function stageOf(error) {
  const code = String((error && error.code) || "");
  if (code.startsWith("EXPLORER_")) return "explorer-walk";
  if (code.startsWith("GEOCODE_") || code === "ADDRESS_NOT_FOUND") return "geocode";
  if (/^(SITE_|LISTING_|PAGE_|NO_LISTING|COOKIE_|OVERLAY_|REGISTRATION_|ALL_LISTINGS|CAPTURE_)/.test(code)) {
    return "capture";
  }
  return code ? "render" : "render";
}

async function withDeadline(work, ms, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      try {
        if (onTimeout) await onTimeout();
      } catch (_) {
        /* the kill is best effort */
      }
      const error = new Error(
        `This took longer than ${Math.round(ms / 1000)} seconds and was stopped. Try again, and paste a listing URL so there is less to search.`
      );
      error.code = "CAPTURE_TIMED_OUT";
      error.isCaptureRefusal = true;
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Phase one: the picture, silent.
 *
 * Screenshot a live listing on the customer's site, draw one still per beat,
 * and stitch them at the template's suggested durations with no audio track at
 * all. The user watches this back and records over it, so the words land on the
 * right scenes.
 */
async function renderSilent(job, { budgetMs } = {}) {
  const dir = store.jobDir(job.id);
  const workDir = path.join(dir, "work");
  const log = (message) => store.logProgress(job, message);

  job.status = "capturing";
  job.error = null;
  job.errorCode = null;
  job.retryable = false;
  job.failure = null;
  await store.persist(job);

  let browser = null;
  /* The shot of the listing, kept so a failure after the capture can show it. */
  let filmed = null;
  try {
    await fsp.mkdir(workDir, { recursive: true });
    browser = await launch();

    const capture = await withDeadline(
      captureListing({
        browser,
        url: job.input.websiteUrl,
        listingUrl: job.input.listingUrl || "",
        outDir: workDir,
        log,
        // The upgrade script wants a listing that already has School Explorer.
        // Everything else wants one that has neither Explorer on it yet.
        explorerRule: (job.template && job.template.listingExplorer) || "absent",
        ...(budgetMs ? { budgetMs } : {}),
      }),
      // Its own budget plus a little, so this only fires when capture is wedged
      // rather than merely slow.
      (budgetMs || CAPTURE_BUDGET_MS) + 20000,
      () => {
        // A browser that is stuck, or has just run out of memory, will not
        // answer close(), so it gets killed.
        log("Their site took too long - stopping the browser");
        return closeBrowser(browser, { graceMs: 2000 });
      }
    );

    filmed = { screenshot: capture.screenshot, pageUrl: capture.pageUrl };

    /*
     * Film the Neighborhood Explorer, if this script walks its tabs.
     *
     * The listing browser is shut first. It is deliberately starved to survive a
     * small dyno and the Explorer's map needs a GPU, so the walk gets its own
     * browser - and only one is ever alive at a time.
     */
    let explorerShots = {};
    const tabsWanted = [...new Set(job.beats.filter((beat) => beat.scene === "ne").map((beat) => beat.neTabName))];
    if (tabsWanted.length) {
      log(`Closing the listing browser, then filming ${tabsWanted.length} Neighborhood Explorer tabs`);
      await closeBrowser(browser);
      browser = null;

      const where = await locateAddress(capture.address, { log });
      const walk = await withDeadline(
        captureExplorerTabs({ lat: where.lat, lng: where.lng, tabs: tabsWanted, outDir: workDir, log }),
        WALK_BUDGET_MS + 20000,
        () => log("The Explorer took too long - stopping it")
      );
      explorerShots = walk.shots;
      job.explorer = { place: walk.place, lat: where.lat, lng: where.lng, precision: where.precision };

      browser = await launch();
    }

    log("Drawing the scenes");
    const frames = await renderFrames({
      browser,
      beats: job.beats,
      screenshot: capture.screenshot,
      address: capture.address,
      company: job.input.company,
      explorerShots,
      outDir: workDir,
      log,
    });

    const silentPath = path.join(dir, "silent.mp4");
    const silent = await buildSilentVideo({
      frames,
      durations: job.beats.map((beat) => beat.seconds),
      workDir,
      outFile: silentPath,
      log,
    });

    const posterPath = path.join(dir, "poster.jpg");
    await buildPoster({ frames, outFile: posterPath }).catch(() => null);

    job.silent = {
      file: silentPath,
      posterFile: posterPath,
      durationSeconds: Math.round(silent.duration * 10) / 10,
      frames,
      capturedPageUrl: capture.pageUrl,
      capturedAddress: capture.address || null,
      checkedPages: capture.checked,
      notes: capture.notes || [],
    };
    job.status = "silent-ready";
    log("Silent video ready - watch it and record your voice");
  } catch (error) {
    job.status = "failed";
    job.error = error.message || String(error);
    job.errorCode = error.code || null;
    job.retryable = Boolean(error.isCaptureRefusal);
    log(`Stopped: ${job.error}`);

    /*
     * The job stays in the library as failed, and the failure is written down.
     *
     * Whatever went wrong - no listing, a search page, an account wall, a 403, a
     * timeout, Chrome dying, the Explorer walk giving up - it goes in the log with
     * the picture of the page it stopped on, so it can be read afterwards without
     * having been watching at the time.
     */
    job.failure = await store.recordFailure({
      jobId: job.id,
      firstName: job.input.firstName,
      company: job.input.company,
      websiteUrl: job.input.websiteUrl,
      listingUrl: job.input.listingUrl || "",
      stage: stageOf(error),
      errorCode: error.code || "",
      reason: error.message || String(error),
      httpStatus: error.httpStatus || null,
      pageKind: error.pageKind || "",
      checked: error.checked || [],
      // Nothing to photograph once the capture browser has gone, so the shot of
      // the listing that was filmed stands in. On the job Bill lost, that picture
      // is the search results page IDX sent us instead of the house.
      screenshot: error.screenshot || (filmed && filmed.screenshot) || "",
      pageUrl: error.pageUrl || error.explorerUrl || (filmed && filmed.pageUrl) || "",
    });
  } finally {
    // Always, on every path: a leaked Chrome on a small dyno is the next crash.
    if (browser) {
      const how = await closeBrowser(browser).catch(() => "would not close");
      if (how !== "closed") log(`Browser ${how}`);
    }
    await store.persist(job);
  }

  return job;
}

/**
 * Phase two: lay a voice over the picture that was already approved.
 *
 * Runs again from scratch every time the take is replaced, so re-recording is
 * always safe. The finished mp4 replaces the previous one and the review flag
 * is cleared, because a new take has not been reviewed yet.
 */
async function attachAudio(job, { source, uploadPath }) {
  const dir = store.jobDir(job.id);
  const workDir = path.join(dir, "work");
  const log = (message) => store.logProgress(job, message);

  if (!job.silent || !Array.isArray(job.silent.frames) || job.silent.frames.length === 0) {
    throw new Error("The silent video for this job is gone. Make the video again.");
  }
  for (const frame of job.silent.frames) {
    if (!fs.existsSync(frame)) {
      throw new Error("The scenes for this job are no longer on disk. Make the video again.");
    }
  }

  job.status = "voicing";
  job.error = null;
  job.review = { reviewed: false, at: null, how: null };
  await store.persist(job);

  try {
    const beats = job.beats;
    let durations = beats.map((beat) => beat.seconds);
    let track;

    if (source === "ai") {
      track = await buildAiVoiceTrack({ beats, workDir, log });
      durations = track.durations;
    } else {
      track = await buildRecordedTrack({ uploadPath, workDir, log });
    }

    // Render beside the live file and swap at the end. A link already sent to a
    // customer keeps playing the previous cut while a new take is being made,
    // and never serves a half-written mp4.
    const videoPath = path.join(dir, "video.mp4");
    const pendingPath = path.join(dir, "video.next.mp4");
    const video = await buildVideo({
      frames: job.silent.frames,
      durations,
      audioFile: track.audioFile,
      workDir,
      outFile: pendingPath,
      log,
    });
    await fsp.rename(pendingPath, videoPath);

    job.result = {
      videoFile: videoPath,
      posterFile: job.silent.posterFile,
      durationSeconds: Math.round(video.duration),
      capturedPageUrl: job.silent.capturedPageUrl,
      capturedAddress: job.silent.capturedAddress ? job.silent.capturedAddress.street : "",
      notes: job.silent.notes || [],
      voice: track.voice,
      templateName: job.template.name,
      explorers: job.template.explorers,
      sceneCount: job.silent.frames.length,
    };
    job.status = "ready";
    log("Done - review it, then send it");
  } catch (error) {
    // The picture survives a bad take, so drop back to the review-and-record
    // step rather than throwing the whole job away. Any earlier finished cut is
    // left alone, link and all.
    job.status = "silent-ready";
    job.error = error.message || String(error);
    log(`That audio did not work: ${job.error}`);
    await fsp.rm(path.join(dir, "video.next.mp4"), { force: true }).catch(() => {});
  } finally {
    await cleanTempAudio(workDir);
    await store.persist(job);
  }

  return job;
}

/** Frames are kept for re-records; the wav scratch files are not. */
async function cleanTempAudio(workDir) {
  try {
    for (const name of await fsp.readdir(workDir)) {
      if (/\.(wav|mp3|webm|m4a|txt)$/i.test(name)) {
        await fsp.rm(path.join(workDir, name), { force: true });
      }
    }
  } catch (_) {
    /* scratch cleanup is never worth failing a render over */
  }
}

/**
 * Phase three, and only if a person asks for it: cut the end off.
 *
 * The finished video is as long as the silent cut, because that is the picture
 * that was approved. If Bill decides on the final review that it should stop
 * earlier, he pauses the player and trims - and that is the only thing that
 * makes it shorter.
 *
 * The trim is applied to the finished cut in place, so the watch link keeps
 * working, and the review flag is cleared because what he approved has changed.
 */
async function trimFinishedVideo(job, { atSeconds }) {
  const dir = store.jobDir(job.id);
  const log = (message) => store.logProgress(job, message);
  const pendingPath = path.join(dir, "video-trimming.mp4");

  /*
   * Whatever happens, the job does not stay on "trimming".
   *
   * The browser waits on that status, so a throw that left it set would leave
   * the review step covered by a spinner for ever.
   */
  try {
    if (!job.result || !job.result.videoFile || !fs.existsSync(job.result.videoFile)) {
      throw new Error("There is no finished video to trim any more. Make the video again.");
    }

    const trimmed = await trimVideoAt({
      inputFile: job.result.videoFile,
      atSeconds,
      outFile: pendingPath,
      log,
    });
    await fsp.rename(pendingPath, job.result.videoFile);

    job.result.durationSeconds = Math.round(trimmed.duration);
    job.result.trimmed = {
      at: new Date().toISOString(),
      atSeconds: Math.round(Number(atSeconds) * 10) / 10,
      wasSeconds: Math.round(trimmed.wasSeconds * 10) / 10,
    };
    // A different video to the one that was reviewed, so it needs reviewing again.
    job.review = { reviewed: false, at: null, how: null };
    job.error = null;
    job.errorCode = null;
    log(`Trimmed the video to ${trimmed.duration.toFixed(1)}s - review it again, then send`);
  } catch (error) {
    // The original is untouched: the cut is written beside it and only renamed
    // over it once ffmpeg has finished, so a failed trim costs nothing.
    await fsp.rm(pendingPath, { force: true }).catch(() => {});
    job.error = error.message || String(error);
    job.errorCode = error.code || "TRIM_FAILED";
    log(`That trim did not work: ${job.error}`);
  } finally {
    // Back to the review step either way, with the video it still has.
    job.status = "ready";
    await store.persist(job);
  }
  return job;
}

module.exports = { renderSilent, attachAudio, trimFinishedVideo };
