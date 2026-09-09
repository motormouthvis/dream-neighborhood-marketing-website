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
const { addressFromFields, confirmAddress } = require("./src/geocode");
const places = require("./src/places");

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

/*
 * The uploaded listing screenshot, for a site that will not be filmed.
 *
 * Same multer-onto-disk pattern as the audio take above, with a much smaller
 * allowance and a type check: a video take is tens of megabytes, a screenshot of
 * a listing page is one or two. The content type is checked here for a quick,
 * clear refusal, and the bytes themselves are checked again in
 * src/listing-image.js before ffmpeg is asked to open the file - a browser will
 * label an upload whatever it likes.
 */
const MAX_LISTING_IMAGE_BYTES = 12 * 1024 * 1024;

const listingImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = /\.(png|jpe?g)$/i.test(file.originalname || "")
        ? path.extname(file.originalname).toLowerCase()
        : ".png";
      cb(null, `listing-${Date.now()}-${Math.random().toString(16).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: MAX_LISTING_IMAGE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g)$/i.test(file.mimetype || "")) return cb(null, true);
    return cb(new Error("Only a PNG or JPG screenshot can be uploaded."));
  },
});

/**
 * Take the screenshot if there is one, and turn a refusal into something
 * readable. A request with no file at all passes straight through, so the same
 * route serves a JSON body and a multipart one.
 */
function acceptListingImage(req, res, next) {
  listingImageUpload.single("listingImage")(req, res, (error) => {
    if (!error) return next();
    const tooBig = error.code === "LIMIT_FILE_SIZE";
    return res.status(400).json({
      error: tooBig
        ? `That screenshot is bigger than ${Math.round(
            MAX_LISTING_IMAGE_BYTES / (1024 * 1024)
          )}MB. Screenshot the visible page rather than the whole scrolled page, or save it as a JPG.`
        : `That screenshot did not upload: ${error.message}`,
    });
  });
}

/**
 * Mark a job as being worked on, before the request is answered.
 *
 * The render is queued, so it may not start for a moment - and until it does,
 * the job still carries the previous run's status. The browser polls every two
 * and a half seconds, so a retry could be answered with the LAST attempt's
 * "silent-ready" and paint the old video as though the new one had finished
 * already. Claiming the job here closes that window; renderSilent sets the same
 * status again when it actually begins, which costs nothing.
 */
function startCapture(job, message) {
  job.status = "capturing";
  job.error = null;
  job.errorCode = null;
  job.retryable = false;
  store.logProgress(job, message);
}

/** A rejected upload must not be left sitting in the uploads directory. */
async function discardUpload(file) {
  if (file && file.path) await fsp.rm(file.path, { force: true }).catch(() => {});
}

/**
 * The address that came with an uploaded screenshot, settled before anything is
 * filmed.
 *
 * Typed in, never taken from the picture, and never taken on trust: the form
 * offers the Neighborhood Explorer's own suggestions and this resolves the chosen
 * one through the Explorer's own geocoder, so both Explorers are filmed at a place
 * the Explorer named. See src/places.js and src/geocode.js confirmAddress.
 */
async function addressFromUploadForm(body) {
  return confirmAddress(
    addressFromFields({
      street: body.addressStreet,
      city: body.addressCity,
      state: body.addressState,
      zip: body.addressZip,
      // What was picked from the suggestions, and where the picker put it.
      place: body.addressPlace,
      lat: body.addressLat,
      lng: body.addressLng,
    })
  );
}

/**
 * A before-shot screenshot has to be a clean listing, and only a person can say
 * so.
 *
 * The live path checks the page itself, right up to the moment of the shot, and
 * refuses a listing that already has one of our Explorers on it. There is no
 * page on this path - it is an image - and nothing here reads the pixels, for
 * the same reason nothing reads the address off them: a wrong answer would look
 * completely correct. Bill's screenshot is the only witness, and he is looking
 * at it.
 *
 * So the upload is refused until he says it is a clean listing, and the answer
 * is kept with the job. Saying no is not a dead end: it names the script that
 * wants a listing which already has School Explorer on it.
 */
const BEFORE_SHOT_NEEDS_A_CLEAN_SHOT =
  "This script is the \u201cbefore\u201d shot, so the listing in the screenshot must not already have School Explorer or Neighborhood Explorer on it \u2013 and nothing here can check a picture for one, the way it can check a live page. " +
  "Tick \u201cthis listing has no Explorer on it yet\u201d to confirm you can see that it does not. " +
  "If it does already have School Explorer on it, that customer is the upgrade pitch: pick the \u201cSE to NE upgrade\u201d script instead.";

function isBeforeShotTemplate(template) {
  return ((template && template.listingExplorer) || "absent") === "absent";
}

/** Did the form confirm the photographed listing is a clean one? */
function confirmedNoExplorer(body) {
  const said = String((body && body.listingHasNoExplorer) || "").toLowerCase();
  return said === "yes" || said === "true" || said === "on" || said === "1";
}

/** Move an accepted screenshot into the job's own folder, with its address. */
async function keepUploadedListing(jobId, file, address, { noExplorerConfirmed = false } = {}) {
  const kept = path.join(store.jobDir(jobId), `listing-upload${path.extname(file.filename) || ".png"}`);
  await fsp.mkdir(path.dirname(kept), { recursive: true });
  await fsp.rename(file.path, kept);

  return {
    file: kept,
    originalName: String(file.originalname || "").slice(0, 120),
    uploadedAt: new Date().toISOString(),
    bytes: file.size || 0,
    address,
    // Whether a person looked at this picture and said the listing in it has no
    // Explorer on it yet. Only asked for, and only meaningful, on a before shot.
    noExplorerConfirmed: Boolean(noExplorerConfirmed),
  };
}

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
    scenes: templates.SCENES.map((id) => ({
      id,
      label: templates.SCENE_LABELS[id],
      hint: templates.SCENE_HINTS[id] || "",
    })),
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

/**
 * Address suggestions, from the Neighborhood Explorer's own picker.
 *
 * The form asks this as somebody types, so the address behind an uploaded
 * screenshot is one the Explorer named rather than free text that a geocoder
 * might place in another state. Proxied through here rather than called from the
 * browser: the tool stays one origin, and staging can be pointed at a staging
 * Explorer with LISTING_VIDEO_EXPLORER_URL without CORS coming into it.
 *
 * An unreachable picker says so, so the form can tell somebody to type the whole
 * address instead of leaving them staring at a box that stopped suggesting.
 */
app.get(`${TOOL_PATH}/api/places`, auth.requireSession, async (req, res) => {
  const found = await places.suggestPlaces(String(req.query.q || ""));
  return res.json(found);
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
app.post(`${TOOL_PATH}/api/jobs`, auth.requireSession, acceptListingImage, async (req, res) => {
  const body = req.body || {};
  /*
   * A refusal from here on has to take the upload with it, or a rejected form
   * leaves a screenshot in the uploads directory that nothing will ever collect.
   */
  const refuse = async (status, error) => {
    await discardUpload(req.file);
    return res.status(status).json({ error });
  };
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
    return refuse(400, `Please fill in: ${problems.join(", ")}.`);
  }
  if (!templateId) {
    return refuse(400, "Pick a script template first.");
  }

  let template;
  try {
    template = await templates.getTemplate(templateId);
  } catch (error) {
    await discardUpload(req.file);
    return fail(res, error);
  }

  let websiteUrl;
  let listingUrl = "";
  try {
    websiteUrl = normalizeUrl(websiteRaw);
    if (listingRaw) listingUrl = normalizeUrl(listingRaw);
  } catch (error) {
    return refuse(400, `That website address does not look right: ${error.message}`);
  }

  /*
   * The address that comes with an upload, settled before the job exists.
   *
   * There is no page to read it off on this path, so a blank or unplaceable
   * address is a form to send back rather than a job to fail. It is resolved here
   * so the person gets "pick one of the suggestions" on the form they are looking
   * at, instead of a video a minute later that filmed another town's schools.
   */
  let uploadedAddress = null;
  if (req.file) {
    // A before shot has to be a clean listing, and this is the only path where
    // nothing but a person can say whether it is.
    if (isBeforeShotTemplate(template) && !confirmedNoExplorer(body)) {
      return refuse(400, BEFORE_SHOT_NEEDS_A_CLEAN_SHOT);
    }
    try {
      uploadedAddress = await addressFromUploadForm(body);
    } catch (error) {
      return refuse(error.status || 400, error.message);
    }
  }

  const beats = templates.renderBeats(template, { firstName, company });

  const job = await store.createJob({
    input: { firstName, company, websiteUrl, listingUrl, customerEmail, templateId: template.id, fromId, voiceId },
    template,
    beats,
  });

  if (req.file) {
    try {
      job.input.uploadedListing = await keepUploadedListing(job.id, req.file, uploadedAddress, {
        noExplorerConfirmed: confirmedNoExplorer(body),
      });
      await store.persist(job);
    } catch (error) {
      await discardUpload(req.file);
      return fail(res, error);
    }
    store.logProgress(job, "Got it - using the screenshot you uploaded instead of loading their site");
  } else {
    store.logProgress(job, "Got it - looking for one of their live listings");
  }

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

  /*
   * A retry with a URL goes back to the live site, so any screenshot uploaded
   * earlier is dropped - otherwise the upload would silently win and the pasted
   * URL would look like it had been ignored.
   */
  if (job.input.uploadedListing) {
    await fsp.rm(job.input.uploadedListing.file, { force: true }).catch(() => {});
    job.input.uploadedListing = null;
  }

  job.result = null;
  job.review = { reviewed: false, at: null, how: null };
  startCapture(job, "Trying the capture again");
  await store.persist(job);
  enqueue(() => renderSilent(job).catch(() => {}));
  return res.status(202).json({ id: job.id });
});

/**
 * The way out of a site that will not be filmed at all.
 *
 * Scott Rodgers Real Estate answers an automated browser with 403 on every page
 * that holds a listing, and the failure panel's "paste one listing URL" is no
 * help when the listing URL 403s as well. So the picture can be uploaded
 * instead: the listing page as it looks in a real browser, plus the address to
 * point the Explorer at, and the same job carries on from there without the site
 * being asked for anything.
 *
 * The address is typed in, deliberately. Nothing reads it off the picture.
 */
app.post(
  `${TOOL_PATH}/api/jobs/:id/listing-image`,
  auth.requireSession,
  acceptListingImage,
  async (req, res) => {
    const job = await store.getJob(req.params.id);
    if (!job) {
      await discardUpload(req.file);
      return res.status(404).json({ error: "That video was not found." });
    }
    if (isBusy(job)) {
      await discardUpload(req.file);
      return res.status(409).json({ error: "That video is still being worked on. Give it a moment." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No screenshot came through. Pick a PNG or JPG and try again." });
    }
    // The same clean-listing question the form asks, because this is the same
    // upload arriving by a different door.
    if (isBeforeShotTemplate(job.template) && !confirmedNoExplorer(req.body)) {
      await discardUpload(req.file);
      return res.status(400).json({ error: BEFORE_SHOT_NEEDS_A_CLEAN_SHOT });
    }

    let kept;
    try {
      kept = await keepUploadedListing(job.id, req.file, await addressFromUploadForm(req.body || {}), {
        noExplorerConfirmed: confirmedNoExplorer(req.body),
      });
    } catch (error) {
      await discardUpload(req.file);
      return fail(res, error);
    }

    // A second upload replaces the first rather than piling up in the job folder.
    const previous = job.input.uploadedListing;
    if (previous && previous.file && previous.file !== kept.file) {
      await fsp.rm(previous.file, { force: true }).catch(() => {});
    }

    job.input.uploadedListing = kept;
    job.result = null;
    job.review = { reviewed: false, at: null, how: null };
    startCapture(job, `Using the screenshot you uploaded for ${kept.address.street}`);
    await store.persist(job);
    enqueue(() => renderSilent(job).catch(() => {}));
    return res.status(202).json({ id: job.id });
  }
);

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
