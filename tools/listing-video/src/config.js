"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function bool(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

const dataDir = process.env.LISTING_VIDEO_DATA_DIR
  ? path.resolve(process.env.LISTING_VIDEO_DATA_DIR)
  : path.join(ROOT, "data");

// A missing token would turn the tool into a public form, so generate a throwaway
// one and print it instead of starting up ungated.
const accessTokenFromEnv = (process.env.LISTING_VIDEO_TOKEN || "").trim();
const accessToken = accessTokenFromEnv || crypto.randomBytes(6).toString("hex");

const config = {
  root: ROOT,
  dataDir,
  jobsDir: path.join(dataDir, "jobs"),
  port: Number(process.env.PORT || 8788),
  // Used to build the shareable watch link. Set this on staging.
  publicBaseUrl: (process.env.LISTING_VIDEO_PUBLIC_URL || "").replace(/\/+$/, ""),
  accessToken,
  accessTokenIsGenerated: !accessTokenFromEnv,
  cookieSecret: process.env.LISTING_VIDEO_COOKIE_SECRET || crypto.randomBytes(24).toString("hex"),
  sessionHours: Number(process.env.LISTING_VIDEO_SESSION_HOURS || 12),

  chromePath:
    process.env.LISTING_VIDEO_CHROME ||
    firstExisting([
      "/usr/local/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ]),

  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH || "ffprobe",

  // Offline neural voice. Point these at a Piper install to get the AI voice.
  piperBin:
    process.env.PIPER_BIN ||
    firstExisting([
      path.join(ROOT, "voices", "piper"),
      "/usr/local/bin/piper",
      `${process.env.HOME || ""}/.local/bin/piper`,
    ]),
  piperVoice:
    process.env.PIPER_VOICE ||
    firstExisting([
      path.join(ROOT, "voices", "en_US-lessac-medium.onnx"),
      "/opt/piper-voices/en_US-lessac-medium.onnx",
      "/tmp/piper-voices/en_US-lessac-medium.onnx",
    ]),

  // Hosted voices, used ahead of the offline voice when a key is present.
  elevenLabsKey: process.env.ELEVENLABS_API_KEY || "",
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL",
  openAiKey: process.env.OPENAI_API_KEY || "",
  openAiVoice: process.env.OPENAI_TTS_VOICE || "nova",

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: bool(process.env.SMTP_SECURE, Number(process.env.SMTP_PORT) === 465),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },

  fromAddresses: [
    { id: "marketing", email: "marketing@dreamneighborhood.com", label: "marketing@dreamneighborhood.com" },
    { id: "myles", email: "myles@dreamneighborhood.com", label: "myles@dreamneighborhood.com" },
  ],

  callToActionPhone: process.env.LISTING_VIDEO_PHONE || "",
};

config.mailConfigured = Boolean(config.smtp.host);

module.exports = config;
