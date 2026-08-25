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

function jobDir(id) {
  return path.join(config.jobsDir, id);
}

async function createJob(input) {
  ensureDirs();
  const id = newId();
  const job = {
    id,
    createdAt: new Date().toISOString(),
    status: "queued",
    progress: [],
    input,
    result: null,
    error: null,
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
  if (job.progress.length > 60) job.progress.splice(0, job.progress.length - 60);
  persist(job);
}

async function getJob(id) {
  if (!/^[a-f0-9]{6,64}$/.test(String(id || ""))) return null;
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

function publicView(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress.map((entry) => entry.message),
    error: job.error,
    result: job.result,
    email: job.email,
    input: {
      firstName: job.input.firstName,
      company: job.input.company,
      websiteUrl: job.input.websiteUrl,
      customerEmail: job.input.customerEmail,
      videoType: job.input.videoType,
      voiceMode: job.input.voiceMode,
      fromId: job.input.fromId,
    },
  };
}

module.exports = { ensureDirs, createJob, getJob, persist, logProgress, jobDir, publicView };
