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
};
