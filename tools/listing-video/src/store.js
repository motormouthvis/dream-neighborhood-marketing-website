"use strict";

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");

const jobs = new Map();

function ensureDirs() {
  fs.mkdirSync(config.jobsDir, { recursive: true });
}

function newId() {
  return crypto.randomBytes(9).toString("hex");
}

function validId(id) {
  return /^[a-f0-9]{6,64}$/.test(String(id || ""));
}

function jobDir(id) {
  return path.join(config.jobsDir, id);
}

/*
 * The failure log.
 *
 * One JSON object per line, appended, newest last. A line per failure rather
 * than one big document, so a crash halfway through a write costs one record
 * instead of the lot, and so it can be read with `tail`.
 *
 * On Heroku this lives on the dyno's own disk, so it goes when the dyno
 * restarts - the same as the jobs themselves. It is there to answer "what
 * happened on that job just now", not to be a permanent archive.
 */
function failureLogPath() {
  return path.join(config.dataDir, "failures.jsonl");
}

const MAX_FAILURES_KEPT = 500;

/**
 * Write down a capture that did not work.
 *
 * Everything here is what somebody would ask next: which job, whose site, which
 * URL, what the site said, what we called the page, and the picture of it.
 */
async function recordFailure(entry) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const record = {
    at: new Date().toISOString(),
    jobId: entry.jobId || "",
    firstName: entry.firstName || "",
    company: entry.company || "",
    websiteUrl: entry.websiteUrl || "",
    listingUrl: entry.listingUrl || "",
    stage: entry.stage || "capture",
    errorCode: entry.errorCode || "",
    reason: shortReason(entry.reason),
    httpStatus: entry.httpStatus || null,
    pageKind: entry.pageKind || "",
    pageUrl: entry.pageUrl || "",
    pagesChecked: Array.isArray(entry.checked) ? entry.checked.length : 0,
    screenshot: entry.screenshot || "",
  };
  try {
    await fsp.appendFile(failureLogPath(), `${JSON.stringify(record)}\n`, "utf8");
  } catch (_) {
    /* a log that cannot be written must not take the job's own error with it */
  }
  return record;
}

/** One line of it, so a list of failures stays readable. */
function shortReason(reason) {
  const text = String(reason == null ? "" : reason)
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/** Recent failures, newest first. */
async function listFailures({ limit = 50 } = {}) {
  let text = "";
  try {
    text = await fsp.readFile(failureLogPath(), "utf8");
  } catch (_) {
    return [];
  }
  const out = [];
  // From the end, because the newest are wanted and the file only grows.
  const lines = text.split("\n").filter(Boolean).slice(-MAX_FAILURES_KEPT);
  for (let index = lines.length - 1; index >= 0 && out.length < limit; index -= 1) {
    try {
      out.push(JSON.parse(lines[index]));
    } catch (_) {
      /* a half-written line is skipped rather than breaking the list */
    }
  }
  return out;
}

async function createJob({ input, template, beats }) {
  ensureDirs();
  const id = newId();
  const job = {
    id,
    createdAt: new Date().toISOString(),
    status: "queued",
    progress: [],
    input,
    template: {
      id: template.id,
      name: template.name,
      explorers: template.explorers,
      // What the listing behind the video needs to have on it already.
      listingExplorer: template.listingExplorer || "absent",
      beatCount: template.beats.length,
    },
    beats,
    silent: null,
    result: null,
    review: { reviewed: false, at: null, how: null },
    error: null,
    errorCode: null,
    retryable: false,
    email: null,
  };
  await fsp.mkdir(path.join(jobDir(id), "work"), { recursive: true });
  jobs.set(id, job);
  await persist(job);
  return job;
}

async function persist(job) {
  try {
    await fsp.writeFile(path.join(jobDir(job.id), "job.json"), JSON.stringify(job, null, 2), "utf8");
  } catch (_) {
    /* progress files are a convenience; never fail a render over one */
  }
}

function logProgress(job, message) {
  job.progress.push({ at: new Date().toISOString(), message });
  if (job.progress.length > 80) job.progress.splice(0, job.progress.length - 80);
  persist(job);
}

async function getJob(id) {
  if (!validId(id)) return null;
  if (jobs.has(id)) return jobs.get(id);
  try {
    const raw = await fsp.readFile(path.join(jobDir(id), "job.json"), "utf8");
    const job = JSON.parse(raw);
    jobs.set(id, job);
    return job;
  } catch (_) {
    return null;
  }
}

/** Every job on disk, newest first. This is the library. */
async function listJobs() {
  ensureDirs();
  let names = [];
  try {
    names = await fsp.readdir(config.jobsDir);
  } catch (_) {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!validId(name)) continue;
    const job = await getJob(name);
    if (job) out.push(job);
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Remove a video for good: the mp4, the poster, the stills and the record that
 * makes /v/{id} work. After this the public link is a 404.
 */
async function deleteJob(id) {
  if (!validId(id)) return false;
  const dir = jobDir(id);
  if (!fs.existsSync(dir)) {
    jobs.delete(id);
    return false;
  }
  await fsp.rm(dir, { recursive: true, force: true });
  jobs.delete(id);
  return true;
}

function markReviewed(job, how) {
  job.review = { reviewed: true, at: new Date().toISOString(), how };
  return persist(job);
}

/** Job state for the browser, with no server file paths in it. */
function publicView(job) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    status: job.status,
    progress: job.progress.map((entry) => entry.message),
    error: job.error,
    errorCode: job.errorCode || null,
    retryable: Boolean(job.retryable),
    failure: failureView(job),
    template: job.template,
    beats: (job.beats || []).map((beat) => ({
      scene: beat.scene,
      seconds: beat.seconds,
      text: beat.text,
      caption: beat.caption,
    })),
    silent: job.silent
      ? {
          durationSeconds: job.silent.durationSeconds,
          capturedPageUrl: job.silent.capturedPageUrl,
          // Shown on the record screen so it is obvious which house was filmed.
          capturedAddress: job.silent.capturedAddress ? job.silent.capturedAddress.street : "",
          notes: job.silent.notes || [],
          pagesChecked: (job.silent.checkedPages || []).length,
        }
      : null,
    result: job.result
      ? {
          durationSeconds: job.result.durationSeconds,
          capturedPageUrl: job.result.capturedPageUrl,
          capturedAddress: job.result.capturedAddress || "",
          notes: job.result.notes || [],
          voice: job.result.voice,
          templateName: job.result.templateName,
          sceneCount: job.result.sceneCount,
        }
      : null,
    review: job.review || { reviewed: false },
    email: job.email,
    input: {
      firstName: job.input.firstName,
      company: job.input.company,
      websiteUrl: job.input.websiteUrl,
      listingUrl: job.input.listingUrl || "",
      customerEmail: job.input.customerEmail,
      templateId: job.input.templateId,
      fromId: job.input.fromId,
    },
  };
}

/** One row in the library list. */
function libraryView(job) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    status: job.status,
    firstName: job.input.firstName,
    company: job.input.company,
    customerEmail: job.input.customerEmail,
    templateId: job.template ? job.template.id : "",
    templateName: job.template ? job.template.name : "",
    durationSeconds: job.result ? job.result.durationSeconds : job.silent ? job.silent.durationSeconds : null,
    hasVideo: Boolean(job.result),
    reviewed: Boolean(job.review && job.review.reviewed),
    emailSent: Boolean(job.email && job.email.sent),
    emailTo: job.email && job.email.sent ? job.email.to : "",
    // A failed job stays in the library, and says why and what it was looking at.
    error: job.error || "",
    errorCode: job.errorCode || null,
    failure: failureView(job),
  };
}

/** What is worth showing about a failure, without the absolute file paths. */
function failureView(job) {
  const failure = job.failure;
  if (!failure) return null;
  return {
    at: failure.at || "",
    stage: failure.stage || "",
    errorCode: failure.errorCode || "",
    reason: failure.reason || "",
    httpStatus: failure.httpStatus || null,
    pageKind: failure.pageKind || "",
    pageUrl: failure.pageUrl || "",
    pagesChecked: failure.pagesChecked || 0,
    hasScreenshot: Boolean(failure.screenshot && fs.existsSync(failure.screenshot)),
  };
}

module.exports = {
  ensureDirs,
  createJob,
  getJob,
  listJobs,
  deleteJob,
  persist,
  logProgress,
  markReviewed,
  jobDir,
  publicView,
  libraryView,
  failureView,
  recordFailure,
  listFailures,
  failureLogPath,
};
