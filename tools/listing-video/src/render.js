"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { launch } = require("./browser");
const { captureListing } = require("./capture");
const { renderFrames } = require("./frames");
const { buildAiVoiceTrack, buildRecordedTrack } = require("./audio");
const { buildSilentVideo, buildVideo, buildPoster } = require("./video");
const store = require("./store");

/**
 * Phase one: the picture, silent.
 *
 * Screenshot a live listing on the customer's site, draw one still per beat,
 * and stitch them at the template's suggested durations with no audio track at
 * all. The user watches this back and records over it, so the words land on the
 * right scenes.
 */
async function renderSilent(job) {
  const dir = store.jobDir(job.id);
  const workDir = path.join(dir, "work");
  const log = (message) => store.logProgress(job, message);

  job.status = "capturing";
  job.error = null;
  job.errorCode = null;
  job.retryable = false;
  await store.persist(job);

  let browser = null;
  try {
    await fsp.mkdir(workDir, { recursive: true });
    browser = await launch();

    const capture = await captureListing({
      browser,
      url: job.input.websiteUrl,
      listingUrl: job.input.listingUrl || "",
      outDir: workDir,
      log,
    });

    log("Drawing the scenes");
    const frames = await renderFrames({
      browser,
      beats: job.beats,
      screenshot: capture.screenshot,
      address: capture.address,
      company: job.input.company,
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
  } finally {
    if (browser) await browser.close().catch(() => {});
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

    const videoPath = path.join(dir, "video.mp4");
    const video = await buildVideo({
      frames: job.silent.frames,
      durations,
      audioFile: track.audioFile,
      workDir,
      outFile: videoPath,
      log,
    });

    job.result = {
      videoFile: videoPath,
      posterFile: job.silent.posterFile,
      durationSeconds: Math.round(video.duration),
      capturedPageUrl: job.silent.capturedPageUrl,
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
    // step rather than throwing the whole job away.
    job.status = "silent-ready";
    job.error = error.message || String(error);
    log(`That audio did not work: ${job.error}`);
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

module.exports = { renderSilent, attachAudio };
