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
const { renderJob } = require("./src/render");
const { availableVoiceEngines } = require("./src/audio");
const { normalizeUrl } = require("./src/capture");
const { VIDEO_TYPES, VIDEO_TYPE_LABELS, buildScript, scriptToText } = require("./src/scripts");

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
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
});

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(cookieParser());
app.use(express.json({ limit: "256kb" }));

/* ---------------------------------------------------------------- */
/* one render at a time - Chrome plus ffmpeg is heavy               */
/* ---------------------------------------------------------------- */
let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task, task);
  return queue;
}

function baseUrlFor(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${req.get("host")}`;
}

function watchUrlFor(req, id) {
  return `${baseUrlFor(req)}/v/${id}`;
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

app.get(`${TOOL_PATH}/api/session`, (req, res) => {
  const voices = availableVoiceEngines();
  return res.json({
    signedIn: auth.isSignedIn(req),
    mail: mail.mailStatus(),
    aiVoice: voices.length > 0 ? { available: true, label: voices[0].label } : { available: false },
    fromAddresses: config.fromAddresses,
    videoTypes: Object.entries(VIDEO_TYPE_LABELS).map(([id, label]) => ({ id, label })),
  });
});

/* ---------------------------------------------------------------- */
/* the script, so Myles can read along for an overdub               */
/* ---------------------------------------------------------------- */
app.get(`${TOOL_PATH}/api/script`, auth.requireSession, (req, res) => {
  const videoType = String(req.query.videoType || "").trim();
  if (!Object.values(VIDEO_TYPES).includes(videoType)) {
    return res.status(400).json({ error: "Pick a video type first." });
  }
  const segments = buildScript(videoType, {
    firstName: String(req.query.firstName || "").trim(),
    company: String(req.query.company || "").trim(),
  });
  return res.json({ videoType, text: scriptToText(segments), lines: segments.map((s) => s.text) });
});

/* ---------------------------------------------------------------- */
/* make a video                                                     */
/* ---------------------------------------------------------------- */
app.post(
  `${TOOL_PATH}/api/jobs`,
  auth.requireSession,
  (req, res, next) => {
    upload.single("overdub")(req, res, (error) => {
      if (error) return res.status(400).json({ error: `That audio file did not upload: ${error.message}` });
      return next();
    });
  },
  async (req, res) => {
    const body = req.body || {};
    const firstName = String(body.firstName || "").trim();
    const company = String(body.company || "").trim();
    const websiteRaw = String(body.websiteUrl || "").trim();
    const customerEmail = String(body.customerEmail || "").trim();
    // Bill's rule: the video type is always an explicit choice. Never guess one.
    const videoType = String(body.videoType || "").trim();
    const voiceMode = body.voiceMode === "overdub" ? "overdub" : "ai";
    const fromId = config.fromAddresses.some((entry) => entry.id === body.fromId) ? body.fromId : "marketing";

    const problems = [];
    if (!firstName) problems.push("Customer first name");
    if (!company) problems.push("Company name");
    if (!websiteRaw) problems.push("Website URL");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customerEmail)) problems.push("Customer email");
    if (problems.length) {
      return res.status(400).json({ error: `Please fill in: ${problems.join(", ")}.` });
    }

    if (!Object.values(VIDEO_TYPES).includes(videoType)) {
      return res.status(400).json({
        error: 'Pick a video type first: "School only" or "School + Neighborhood".',
      });
    }

    let websiteUrl;
    try {
      websiteUrl = normalizeUrl(websiteRaw);
    } catch (error) {
      return res.status(400).json({ error: `That website address does not look right: ${error.message}` });
    }

    if (voiceMode === "overdub" && !req.file) {
      return res.status(400).json({ error: "Overdub is selected, so record or upload your voice first." });
    }
    if (voiceMode === "ai" && availableVoiceEngines().length === 0) {
      return res.status(400).json({
        error:
          "The AI voice is not connected on this server yet. Choose Overdub and record your own voice, or ask an engineer to finish the voice setup.",
      });
    }

    const job = await store.createJob({
      firstName,
      company,
      websiteUrl,
      customerEmail,
      videoType,
      voiceMode,
      fromId,
      overdubPath: null,
    });

    if (req.file) {
      const kept = path.join(store.jobDir(job.id), `overdub${path.extname(req.file.filename) || ".webm"}`);
      await fsp.rename(req.file.path, kept);
      job.input.overdubPath = kept;
      await store.persist(job);
    }

    store.logProgress(job, "Got it - starting on your video");
    enqueue(() => renderJob(job).catch(() => {}));

    return res.status(202).json({ id: job.id });
  }
);

app.get(`${TOOL_PATH}/api/jobs/:id`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "That video was not found." });
  return res.json({ ...store.publicView(job), watchUrl: watchUrlFor(req, job.id) });
});

/* ---------------------------------------------------------------- */
/* email the customer                                               */
/* ---------------------------------------------------------------- */
app.post(`${TOOL_PATH}/api/jobs/:id/email`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "That video was not found." });
  if (job.status !== "ready") return res.status(400).json({ error: "The video is not finished yet." });

  const fromId = config.fromAddresses.some((entry) => entry.id === (req.body || {}).fromId)
    ? req.body.fromId
    : job.input.fromId;
  const to = String((req.body || {}).to || job.input.customerEmail || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
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
    job.email = { sent: false, at: new Date().toISOString(), to, from: mail.fromAddress(fromId).email, error: error.message };
    await store.persist(job);
    return res.status(notConnected ? 503 : 502).json({
      sent: false,
      mailboxConnected: !notConnected,
      error: error.message,
      draft: mail.buildEmail({ job, watchUrl }),
    });
  }
});

// The email text, so it can be copied and sent by hand when SMTP is not set up.
app.get(`${TOOL_PATH}/api/jobs/:id/email-draft`, auth.requireSession, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "That video was not found." });
  return res.json({ ...mail.buildEmail({ job, watchUrl: watchUrlFor(req, job.id) }), to: job.input.customerEmail });
});

/* ---------------------------------------------------------------- */
/* public watch page - anyone with the link can play it             */
/* ---------------------------------------------------------------- */
async function sendAsset(req, res, id, kind) {
  const job = await store.getJob(id);
  if (!job || job.status !== "ready" || !job.result) return res.status(404).send("Not found");
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
  const ready = Boolean(job && job.status === "ready" && job.result);
  const data = ready
    ? {
        found: true,
        id: job.id,
        firstName: job.input.firstName,
        company: job.input.company,
        videoTypeLabel: job.result.videoTypeLabel,
        durationSeconds: job.result.durationSeconds,
        videoUrl: `/v/${job.id}/video.mp4`,
        posterUrl: `/v/${job.id}/poster.jpg`,
      }
    : { found: false };
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
  app.listen(config.port, () => {
    const voices = availableVoiceEngines();
    console.log(`Listing video maker on http://localhost:${config.port}${TOOL_PATH}`);
    if (config.accessTokenIsGenerated) {
      console.log(`No LISTING_VIDEO_TOKEN was set. Temporary password for this run: ${config.accessToken}`);
    }
    console.log(`AI voice: ${voices.length ? voices[0].label : "not connected (overdub only)"}`);
    console.log(`Mailbox: ${mail.mailStatus().connected ? "connected" : "not connected"}`);
  });
}

module.exports = app;
