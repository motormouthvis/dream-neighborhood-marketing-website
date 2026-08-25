"use strict";

const fsp = require("fs/promises");
const path = require("path");
const { launch } = require("./browser");
const { captureSite } = require("./capture");
const { renderFrames } = require("./frames");
const { buildAiVoiceTrack, buildOverdubTrack } = require("./audio");
const { buildVideo, buildPoster } = require("./video");
const { buildScript, VIDEO_TYPE_LABELS } = require("./scripts");
const store = require("./store");

/**
 * Run one job end to end: screenshot the customer's site, voice the script,
 * draw the scenes, and stitch the mp4.
 */
async function renderJob(job) {
  const dir = store.jobDir(job.id);
  const workDir = path.join(dir, "work");
  const log = (message) => store.logProgress(job, message);

  job.status = "working";
  await store.persist(job);

  const segments = buildScript(job.input.videoType, {
    firstName: job.input.firstName,
    company: job.input.company,
  });

  let browser = null;
  try {
    // Voice first: if the AI voice is missing, fail before spending time on capture.
    const voiceTrack =
      job.input.voiceMode === "overdub"
        ? await buildOverdubTrack({ segments, uploadPath: job.input.overdubPath, workDir, log })
        : await buildAiVoiceTrack({ segments, workDir, log });

    browser = await launch();
    const capture = await captureSite({ browser, url: job.input.websiteUrl, outDir: workDir, log });

    log("Drawing the scenes");
    const frames = await renderFrames({
      browser,
      segments,
      screenshot: capture.screenshot,
      address: capture.address,
      company: job.input.company,
      outDir: workDir,
      log,
    });

    const videoPath = path.join(dir, "video.mp4");
    const video = await buildVideo({
      frames,
      durations: voiceTrack.durations,
      audioFile: voiceTrack.audioFile,
      workDir,
      outFile: videoPath,
      log,
    });

    const posterPath = path.join(dir, "poster.jpg");
    await buildPoster({ frames, outFile: posterPath }).catch(() => null);

    job.result = {
      videoFile: videoPath,
      posterFile: posterPath,
      durationSeconds: Math.round(video.duration),
      capturedPageUrl: capture.pageUrl,
      usedListingPage: capture.usedListingPage,
      notes: capture.notes,
      voice: voiceTrack.voice,
      videoTypeLabel: VIDEO_TYPE_LABELS[job.input.videoType],
      sceneCount: frames.length,
    };
    job.status = "ready";
    log("Done - your video is ready");
  } catch (error) {
    job.status = "failed";
    job.error = error.message || String(error);
    log(`Stopped: ${job.error}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await store.persist(job);
    // Frames and intermediate wavs are large and not needed once the mp4 exists.
    if (job.status === "ready") {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return job;
}

module.exports = { renderJob };
