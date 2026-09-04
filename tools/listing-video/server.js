"use strict";

const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const config = require("./src/config");
const auth = require("./src/auth");
const store = require("./src/store");
const mail = require("./src/mail");
const templates = require("./src/templates");
const { renderSilent, attachAudio, trimFinishedVideo } = require("./src/render");
const { availableVoiceEngines } = require("./src/audio");
const elevenVoices = require("./src/voices");
const voiceUsage = require("./src/voice-usage");
const { normalizeUrl } = require("./src/capture");

const TOOL_PATH = "/tools/listing-video";
const uploadsDir = path.join(config.dataDir, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
store.ensureDirs();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || "") || ".webm").toLowerCase().slice(0, 8);
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 120 * 1024 * 1024, files: 1 },
});

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(cookieParser());
app.use(express.json({ limit: "512kb" }));

/* ---------------------------------------------------------------- */
/* one render at a time - Chrome plus ffmpeg is heavy               */
/* ---------------------------------------------------------------- */
let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task, task);
  return queue;
}

/* A job the server is working on right now. Acting on it would fight the queue. */
function isBusy(job) {
  return job.status === "capturing" || job.status === "voicing" || job.status === "trimming";
}

function baseUrlFor(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${req.get("host")}`;
}

function watchUrlFor(req, id) {
  return `${baseUrlFor(req)}/v/${id}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function fail(res, error) {
  const status = error && error.status ? error.status : 500;
  return res.status(status).json({ error: (error && error.message) || "Something went wrong." });
}

/* ---------------------------------------------------------------- */
/* sign in                                                          */
/* ---------------------------------------------------------------- */
app.post(`${TOOL_PATH}/api/signin`, (req, res) => {
  const token = (req.body && req.body.token) || "";
  if (!auth.checkToken(token)) {
    return res.status(401).json({ error: "That password did not match." });
  }
  res.cookie(auth.COOKIE, auth.issueSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: (req.get("x-forwarded-proto") || req.protocol) === "https",
    maxAge: config.sessionHours * 3600 * 1000,
  });
  return res.json({ ok: true });
});

app.post(`${TOOL_PATH}/api/signout`, (req, res) => {
  res.clearCookie(auth.COOKIE);
  return res.json({ ok: true });
});

app.get(`${TOOL_PATH}/api/session`, async (req, res) => {
  const engines = availableVoiceEngines();
  // Asked of the account rather than assumed, and cached, so a form load is not
  // a network call. An empty list just means no picker.
  const choices = await elevenVoices.listVoices().catch(() => []);
  return res.json({
    signedIn: auth.isSignedIn(req),
    mail: mail.mailStatus(),
    aiVoice:
      engines.length > 0
        ? { available: true, label: engines[0].label, voices: choices, defaultVoiceId: choices.length ? choices[0].id : "" }
        : { available: false, voices: [] },
    fromAddresses: config.fromAddresses,
    scenes: templates.SCENES.map((id) => ({ id, label: templates.SCENE_LABELS[id] })),
    explorerModes: templates.EXPLORER_MODES.map((id) => ({ id, label: templates.EXPLORER_MODE_LABELS[id] })),
    listingExplorerModes: templates.LISTING_EXPLORER_MODES.map((id) => ({
      id,
      label: templates.LISTING_EXPLORER_LABELS[id],
    })),
    neTabs: templates.NE_TABS,
  });
});

/**
 * How much ElevenLabs allowance is left, so an upgrade is not a surprise.
 *
 * Behind the password, and only the few fields worth showing - the subscription
 * response carries billing and invoice detail that has no business in a browser,
 * and the key never leaves the server.
 */
app.get(`${TOOL_PATH}/api/voice-usage`, auth.requireSession, async (req, res) => {
  const usage = await voiceUsage.readUsage().catch(() => ({ state: "unreadable" }));
  return res.json({ usage });
});

/* ---------------------------------------------------------------- */
/* script templates - editable, saved on disk under the data dir    */
/* ---------------------------------------------------------------- */
app.get(`${TOOL_PATH}/api/templates`, auth.requireSession, async (req, res) => {
  try {
    const all = await templates.listTemplates();
    return res.json({ templates: all.map(templates.summary) });
  } catch (error) {
    return fail(res, error);
  }
});

app.get(`${TOOL_PATH}/api/templates/:id`, auth.requireSession, async (req, res) => {
  try {
    const template = await templates.getTemplate(req.params.id);
    return res.json({ template, totalSeconds: templates.totalSeconds(template) });
  } catch (error) {
    return fail(res, error);
  }
});

// The whole script as one block of words, for the teleprompter.
app.get(`${TOOL_PATH}/api/templates/:id/script`, auth.requireSession, async (req, res) => {
  try {
    const template = await templates.getTemplate(req.params.id);
    const beats = templates.renderBeats(template, {
      firstName: String(req.query.firstName || "").trim(),
      company: String(req.query.company || "").trim(),
    });
    return res.json({ id: template.id, name: template.name, text: templates.beatsToText(beats), beats });
  } catch (error) {
    return fail(res, error);
  }
});

app.post(`${TOOL_PATH}/api/templates`, auth.requireSession, async (req, res) => {
  try {
    const saved = await templates.createTemplate(req.body || {});
    return res.status(201).json({ template: saved });
  } catch (error) {
    return fail(res, error);
  }
});

app.put(`${TOOL_PATH}/api/templates/:id`, auth.requireSession, async (req, res) => {
  try {
    const saved = await templates.updateTemplate(req.params.id, req.body || {});
    return res.json({ template: saved });
  } catch (error) {
    return fail(res, error);
  }
});

app.post(`${TOOL_PATH}/api/templates/:id/duplicate`, auth.requireSession, async (req, res) => {
  try {
    const saved = await templates.duplicateTemplate(req.params.id);
    return res.status(201).json({ template: saved });
  } catch (error) {
    return fail(res, error);
  }
});

app.delete(`${TOOL_PATH}/api/templates/:id`, auth.requireSession, async (req, res) => {
  try {
    const removed = await templates.deleteTemplate(req.params.id);
    return res.json({ deleted: true, id: removed.id, name: removed.name });
  } catch (error) {
    return fail(res, error);
  }
});

app.post(`${TOOL_PATH}/api/templates-restore-defaults`, auth.requireSession, async (req, res) => {
  try {
    const restored = await templates.restoreDefaults();
    return res.json({ restored });
  } catch (error) {
    return fail(res, error);
  }
});

/* ---------------------------------------------------------------- */
/* step 1: make the silent picture                                  */
/* ---------------------------------------------------------------- */
app.post(`${TOOL_PATH}/api/jobs`, auth.requireSession, async (req, res) => {
  const body = req.body || {};
  const firstName = String(body.firstName || "").trim();
  const company = String(body.company || "").trim();
  const websiteRaw = String(body.websiteUrl || "").trim();
  const listingRaw = String(body.listingUrl || "").trim();
  const customerEmail = String(body.customerEmail || "").trim();
  const templateId = String(body.templateId || "").trim();
  const fromId = config.fromAddresses.some((entry) => entry.id === body.fromId) ? body.fromId : "marketing";
  // Checked against what the account actually offers, so a stale page cannot
  // book a voice that would fail at render time.
  const voiceId = await elevenVoices.resolveVoiceId(body.voiceId);

  const problems = [];
  if (!firstName) problems.push("Customer first name");
  if (!company) problems.push("Company name");
  if (!websiteRaw) problems.push("Website URL");
  if (!EMAIL_RE.test(customerEmail)) problems.push("Customer email");
  if (problems.length) {
    return res.status(400).json({ error: `Please fill in: ${problems.join(", ")}.` });
  }
  if (!templateId) {
    return res.status(400).json({ error: "Pick a script template first." });
  }

  let template;
  try {
    template = await templates.getTemplate(templateId);
  } catch (error) {
    return fail(res, error);
  }

  let websiteUrl;
  let listingUrl = "";
  try {
    websiteUrl = normalizeUrl(websiteRaw);
    if (listingRaw) listingUrl = normalizeUrl(listingRaw);
  } catch (error) {
    return res.status(400).json({ error: `That website address does not look right: ${error.message}` });
  }

  const beats = templates.renderBeats(template, { firstName, company });

  const job = await store.createJob({
    input: { firstName, company, websiteUrl, listingUrl, customerEmail, templateId: template.id, fromId, voiceId },
    template,
    beats,
  });

  store.logProgress(job, "Got it - looking for one of their live listings");
  enqueue(() => renderSilent(job).catch(() => {}));

  return res.status(202).json({ id: job.id });
});

// Retry the capture, usually with a listing URL pasted by hand after a refusal.
app.post(`${TOOL_PATH}/api/jobs/:id/recapture`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "That video was not found." });
  if (isBusy(job)) {
    return res.status(409).json({ error: "That video is still being worked on. Give it a moment." });
  }

  const listingRaw = String((req.body || {}).listingUrl || "").trim();
  if (listingRaw) {
    try {
      job.input.listingUrl = normalizeUrl(listingRaw);
    } catch (error) {
      return res.status(400).json({ error: `That listing address does not look right: ${error.message}` });
    }
  }

  job.result = null;
  job.review = { reviewed: false, at: null, how: null };
  await store.persist(job);
  store.logProgress(job, "Trying the capture again");
  enqueue(() => renderSilent(job).catch(() => {}));
  return res.status(202).json({ id: job.id });
});

app.get(`${TOOL_PATH}/api/jobs/:id`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "That video was not found." });
  return res.json({ ...store.publicView(job), watchUrl: watchUrlFor(req, job.id) });
});

/* ---------------------------------------------------------------- */
/* step 2: the voice, laid over the picture that was already drawn   */
/* ---------------------------------------------------------------- */
app.post(
  `${TOOL_PATH}/api/jobs/:id/audio`,
  auth.requireSession,
  (req, res, next) => {
    upload.single("audio")(req, res, (error) => {
      if (error) return res.status(400).json({ error: `That audio did not upload: ${error.message}` });
      return next();
    });
  },
  async (req, res) => {
    const job = await store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "That video was not found." });
    if (!req.file) return res.status(400).json({ error: "No audio came through. Record a take and try again." });
    if (isBusy(job)) {
      return res.status(409).json({ error: "That video is still being worked on. Give it a moment." });
    }
    if (!job.silent) {
      return res.status(400).json({ error: "The silent video is not ready yet." });
    }

    const kept = path.join(store.jobDir(job.id), `take${path.extname(req.file.filename) || ".webm"}`);
    await fsp.rename(req.file.path, kept);

    store.logProgress(job, "Got your take - putting it on the video");
    enqueue(() =>
      attachAudio(job, { source: "recorded", uploadPath: kept })
        .catch(() => {})
        .finally(() => fsp.rm(kept, { force: true }).catch(() => {}))
    );

    return res.status(202).json({ id: job.id });
  }
);

// The AI voice is the secondary path. It still lands in the same review step.
app.post(`${TOOL_PATH}/api/jobs/:id/ai-voice`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "That video was not found." });
  if (isBusy(job)) {
    return res.status(409).json({ error: "That video is still being worked on. Give it a moment." });
  }
  if (!job.silent) return res.status(400).json({ error: "The silent video is not ready yet." });
  if (availableVoiceEngines().length === 0) {
    return res.status(400).json({
      error:
        "The AI voice is not connected on this server. Record your own voice over the silent video, or ask an engineer to finish the voice setup.",
    });
  }

  store.logProgress(job, "Building the AI voice track");
  enqueue(() => attachAudio(job, { source: "ai" }).catch(() => {}));
  return res.status(202).json({ id: job.id });
});

/* ---------------------------------------------------------------- */
/* step 3: review, then and only then send                          */
/* ---------------------------------------------------------------- */
app.post(`${TOOL_PATH}/api/jobs/:id/reviewed`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "That video was not found." });
  if (job.status !== "ready") return res.status(400).json({ error: "There is nothing to review yet." });
  const how = (req.body || {}).how === "confirmed" ? "confirmed" : "played";
  await store.markReviewed(job, how);
  return res.json({ review: job.review });
});

/**
 * Cut the end off the finished video, where a person paused it.
 *
 * The only thing that shortens a video. The picture is otherwise as long as the
 * silent cut that was approved, whatever the voice did.
 */
app.post(`${TOOL_PATH}/api/jobs/:id/trim`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "That video was not found." });
  if (job.status !== "ready" || !job.result) {
    return res.status(400).json({ error: "There is no finished video to trim yet." });
  }

  const atSeconds = Number((req.body || {}).atSeconds);
  if (!Number.isFinite(atSeconds)) {
    return res.status(400).json({ error: "Pause the video where you want it to end, then trim." });
  }

  /*
   * Queued and answered straight away, like a capture or a render.
   *
   * This used to re-encode on the request. A minute of 1080p on a small dyno
   * takes longer than Heroku's 30 second router timeout, and the request also
   * had to wait behind any render already in the queue - so the browser was
   * handed a dead connection and showed "That video was not trimmed" for a trim
   * that was still running, or had worked.
   */
  job.status = "trimming";
  job.error = null;
  job.errorCode = null;
  await store.persist(job);

  enqueue(() => trimFinishedVideo(job, { atSeconds }).catch(() => {}));
  return res.status(202).json({ job: store.publicView(job) });
});

app.post(`${TOOL_PATH}/api/jobs/:id/email`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "That video was not found." });
  if (job.status !== "ready") return res.status(400).json({ error: "The video is not finished yet." });
  if (!job.review || !job.review.reviewed) {
    return res.status(409).json({
      error: "Watch the video with the sound on first, or tick \u201cI reviewed this\u201d. Nothing is sent before it is reviewed.",
    });
  }

  const fromId = config.fromAddresses.some((entry) => entry.id === (req.body || {}).fromId)
    ? req.body.fromId
    : job.input.fromId;
  const to = String((req.body || {}).to || job.input.customerEmail || "").trim();
  if (!EMAIL_RE.test(to)) {
    return res.status(400).json({ error: "That customer email does not look right." });
  }

  const watchUrl = watchUrlFor(req, job.id);
  try {
    const sent = await mail.sendVideoEmail({ job, fromId, watchUrl, to });
    job.email = { sent: true, at: new Date().toISOString(), to, from: sent.from, error: null };
    await store.persist(job);
    return res.json({ sent: true, to, from: sent.from });
  } catch (error) {
    const notConnected = error.code === "MAIL_NOT_CONNECTED";
    job.email = {
      sent: false,
      at: new Date().toISOString(),
      to,
      from: mail.fromAddress(fromId).email,
      error: error.message,
    };
    await store.persist(job);
    return res.status(notConnected ? 503 : 502).json({
      sent: false,
      mailboxConnected: !notConnected,
      error: error.message,
      watchUrl,
      draft: mail.buildEmail({ job, watchUrl }),
    });
  }
});

// The email text, so it can be copied and sent by hand when SMTP is not set up.
app.get(`${TOOL_PATH}/api/jobs/:id/email-draft`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "That video was not found." });
  const watchUrl = watchUrlFor(req, job.id);
  return res.json({ ...mail.buildEmail({ job, watchUrl }), to: job.input.customerEmail, watchUrl });
});

/* ---------------------------------------------------------------- */
/* the internal players: silent cut and finished cut                */
/* ---------------------------------------------------------------- */
function sendVideoFile(res, file) {
  if (!file || !fs.existsSync(file)) return res.status(404).send("Not found");
  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(file);
}

app.get(`${TOOL_PATH}/api/jobs/:id/silent.mp4`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !job.silent) return res.status(404).send("Not found");
  return sendVideoFile(res, job.silent.file);
});

app.get(`${TOOL_PATH}/api/jobs/:id/video.mp4`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !job.result) return res.status(404).send("Not found");
  return sendVideoFile(res, job.result.videoFile);
});

/* ---------------------------------------------------------------- */
/* what went wrong, kept so it can be read afterwards               */
/* ---------------------------------------------------------------- */

/**
 * The picture of the page a capture stopped on.
 *
 * Only ever a file this job wrote, checked against its own directory, so a
 * doctored path cannot read anything else off the disk.
 */
app.get(`${TOOL_PATH}/api/jobs/:id/failure.png`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !job.failure || !job.failure.screenshot) return res.status(404).send("Not found");

  const file = path.resolve(job.failure.screenshot);
  const dir = path.resolve(store.jobDir(job.id));
  if (file !== dir && !file.startsWith(`${dir}${path.sep}`)) return res.status(404).send("Not found");
  if (!fs.existsSync(file)) return res.status(404).send("Not found");

  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(file);
});

/**
 * Recent capture failures, newest first.
 *
 * Behind the same password as everything else. This is the report - there is no
 * Slack from here, because this app has no bot token.
 */
app.get(`${TOOL_PATH}/api/failures`, auth.requireSession, async (req, res) => {
  const asked = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), 200) : 50;
  const failures = await store.listFailures({ limit });
  return res.json({
    failures: failures.map((failure) => ({
      ...failure,
      // The absolute path is no use to a browser; the route that serves it is.
      screenshot: undefined,
      screenshotUrl: failure.screenshot ? `${TOOL_PATH}/api/jobs/${failure.jobId}/failure.png` : "",
      jobUrl: failure.jobId ? `${TOOL_PATH}/api/jobs/${failure.jobId}` : "",
    })),
  });
});

/* ---------------------------------------------------------------- */
/* the library                                                      */
/* ---------------------------------------------------------------- */
app.get(`${TOOL_PATH}/api/videos`, auth.requireSession, async (req, res) => {
  const all = await store.listJobs();
  return res.json({
    videos: all.map((job) => ({ ...store.libraryView(job), watchUrl: watchUrlFor(req, job.id) })),
  });
});

app.delete(`${TOOL_PATH}/api/videos/:id`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "That video was not found." });
  if (isBusy(job)) {
    return res.status(409).json({ error: "That video is still being worked on. Wait for it to finish, then delete it." });
  }
  const deleted = await store.deleteJob(job.id);
  return res.json({ deleted, id: job.id });
});

/* ---------------------------------------------------------------- */
/* public watch page - anyone with the link can play it             */
/* ---------------------------------------------------------------- */
// A finished cut stays playable for anyone holding the link even while a new
// take is being recorded over it. Only deleting the video takes it down.
async function sendAsset(req, res, id, kind) {
  const job = await store.getJob(id);
  if (!job || !job.result) return res.status(404).send("Not found");
  const file = kind === "poster" ? job.result.posterFile : job.result.videoFile;
  if (!file || !fs.existsSync(file)) return res.status(404).send("Not found");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.sendFile(file);
}

app.get("/v/:id/video.mp4", (req, res) => sendAsset(req, res, req.params.id, "video"));
app.get("/v/:id/poster.jpg", (req, res) => sendAsset(req, res, req.params.id, "poster"));

app.get(["/v/:id", `${TOOL_PATH}/v/:id`], async (req, res) => {
  const job = await store.getJob(req.params.id);
  const template = await fsp.readFile(path.join(config.root, "public", "watch.html"), "utf8");
  const ready = Boolean(job && job.result && fs.existsSync(job.result.videoFile));
  const data = ready
    ? {
        found: true,
        id: job.id,
        firstName: job.input.firstName,
        company: job.input.company,
        durationSeconds: job.result.durationSeconds,
        videoUrl: `/v/${job.id}/video.mp4`,
        posterUrl: `/v/${job.id}/poster.jpg`,
      }
    : { found: false };
  if (!ready) res.status(404);
  res.type("html").send(template.replace("__WATCH_DATA__", JSON.stringify(data).replace(/</g, "\\u003c")));
});

/* ---------------------------------------------------------------- */
/* the tool page                                                    */
/* ---------------------------------------------------------------- */
app.use(`${TOOL_PATH}/static`, express.static(path.join(config.root, "public"), { index: false }));
app.get([TOOL_PATH, `${TOOL_PATH}/`, `${TOOL_PATH}/maker`], (req, res) => {
  res.sendFile(path.join(config.root, "public", "tool.html"));
});
app.get("/", (req, res) => res.redirect(TOOL_PATH));
app.get("/healthz", (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).send("Not found"));

if (require.main === module) {
  templates
    .ensureSeeded()
    .then((seeded) => {
      if (seeded.length) console.log(`Seeded script templates: ${seeded.join(", ")}`);
    })
    .catch((error) => console.error(`Could not seed the script templates: ${error.message}`));

  app.listen(config.port, () => {
    const voices = availableVoiceEngines();
    console.log(`Listing video maker on http://localhost:${config.port}${TOOL_PATH}`);
    if (config.accessTokenIsGenerated) {
      console.log(`No LISTING_VIDEO_TOKEN was set. Temporary password for this run: ${config.accessToken}`);
    }
    console.log(`Scripts and videos live in ${config.dataDir}`);
    console.log(`AI voice: ${voices.length ? voices[0].label : "not connected (record your own voice)"}`);
    console.log(`Mailbox: ${mail.mailStatus().connected ? "connected" : "not connected"}`);
  });
}

module.exports = app;
