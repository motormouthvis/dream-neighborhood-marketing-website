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

/*
 * The Neighborhood Explorer's widget, and the place picker that comes with it.
 *
 * The picker's two endpoints are siblings of the widget URL - autocomplete/ and
 * geocode/ - so moving LISTING_VIDEO_EXPLORER_URL to staging moves the picker
 * with it, and an address chosen here is one the Explorer itself can place.
 */
const explorerWidgetUrl = (
  process.env.LISTING_VIDEO_EXPLORER_URL ||
  "https://app.dreamneighborhood.com/a/dream-neighborhood-main-marketing-website/widget/"
).replace(/\/*$/, "/");

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

  /*
   * Which desktop capture says it is on: windows, macos or linux. See
   * src/persona.js, which holds the user agent, the client hints and the
   * language that go with each and keeps them agreeing with each other.
   *
   * Windows because it is the least remarkable thing to be. Anything unknown
   * falls back to it rather than failing.
   */
  capturePersona: (process.env.LISTING_VIDEO_PERSONA || "").trim().toLowerCase(),

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

  // Who the email is from and replied to. The mailbox it is actually sent
  // through is SMTP_USER, which is a different address and does not change.
  fromAddresses: [
    { id: "marketing", email: "marketing@dreamneighborhood.com", label: "marketing@dreamneighborhood.com" },
    { id: "myles", email: "myles@dreamneighborhood.com", label: "myles@dreamneighborhood.com" },
    { id: "bill", email: "bill@dreamneighborhood.com", label: "bill@dreamneighborhood.com" },
  ],

  callToActionPhone: process.env.LISTING_VIDEO_PHONE || "",

  /*
   * Hosting a finished video somebody made somewhere else.
   *
   * On, because the whole service is staging-only and never sits in front of a
   * customer - see the README. It is a switch rather than a constant so that a
   * box which should only ever build videos can be told to stop accepting them,
   * without a deploy: LISTING_VIDEO_VIDEO_UPLOAD=off. The tab hides itself when
   * it is off, and the route refuses.
   */
  uploadedVideos: {
    allowed: bool(process.env.LISTING_VIDEO_VIDEO_UPLOAD, true),
  },

  /*
   * The camera card - the marketer's face in the corner of their own video.
   *
   * On for the same reason the upload is: this whole service is staging-only and
   * never sits in front of a customer. LISTING_VIDEO_WEBCAM=off takes the toggle
   * off the record step and makes the route refuse, and that is what goes on any
   * box that is not staging.
   *
   * Switching this on does not put a face in anything. The toggle on the record
   * step is off every time that step is opened, so a video only has somebody in
   * it because somebody ticked the box for that take. See src/webcam.js.
   */
  webcam: {
    allowed: bool(process.env.LISTING_VIDEO_WEBCAM, true),
  },

  /*
   * The live Neighborhood Explorer.
   *
   * Videos film the real product: the widget is opened at the listing's
   * coordinates and its seven tabs are screenshotted one at a time. These
   * defaults are the same widget the marketing site's own demo page loads.
   */
  explorer: {
    widgetUrl: explorerWidgetUrl,
    partnerId: process.env.LISTING_VIDEO_EXPLORER_PARTNER || "23784",
    widgetNumber: process.env.LISTING_VIDEO_EXPLORER_WIDGET || "1",
  },

  /*
   * The Explorer's own place picker - the same suggestions and the same
   * resolution the Neighborhood Explorer's search box uses. See src/places.js.
   */
  places: {
    suggestUrl: process.env.LISTING_VIDEO_PLACE_SUGGEST || `${explorerWidgetUrl}autocomplete/`,
    resolveUrl: process.env.LISTING_VIDEO_PLACE_RESOLVE || `${explorerWidgetUrl}geocode/`,
  },

  /*
   * The live School Explorer.
   *
   * Filmed the same way as the Neighborhood Explorer: opened at the listing's
   * own address, and photographed. The default is the embed the popup snippet
   * loads on a realtor's page.
   */
  schoolExplorer: {
    embedUrl: process.env.LISTING_VIDEO_SCHOOL_EXPLORER_URL || "https://www.dreamneighborhoodschools.com/embed",
    accentColor: process.env.LISTING_VIDEO_SCHOOL_EXPLORER_ACCENT || "#1f7a4d",
  },

  // Address to coordinates when the Explorer's own geocoder cannot place it.
  // Keyless; see src/geocode.js.
  geocoderUrl: process.env.LISTING_VIDEO_GEOCODER || "https://nominatim.openstreetmap.org/search",

  /*
   * The QUAL account, for realtor sites that put a listing behind a login.
   *
   * Off unless an email and a password are both set, and they are only set on
   * staging - which is what keeps this off production rather than a flag
   * somebody could flip by accident. See src/site-account.js for what it does
   * with them, and the README for what it cannot do.
   *
   * registerAllowed is deliberately its own switch and deliberately off. Signing
   * in to an account that already exists is quiet; REGISTERING on an IDX site is
   * how that site's agent gets a "you have a new lead" email, and not emailing
   * realtors is a hard rule here. Turn it on per site, knowingly, or leave it
   * alone.
   */
  qualAccount: {
    email: (process.env.LISTING_VIDEO_QUAL_EMAIL || "").trim(),
    password: process.env.LISTING_VIDEO_QUAL_PASSWORD || "",
    name: (process.env.LISTING_VIDEO_QUAL_NAME || "Motormouth QUAL").trim(),
    phone: (process.env.LISTING_VIDEO_QUAL_PHONE || "").trim(),
    registerAllowed: bool(process.env.LISTING_VIDEO_QUAL_REGISTER, false),
    // Empty means any site. A list means only these hostnames, which is the
    // safer way to switch it on for one customer at a time.
    hosts: (process.env.LISTING_VIDEO_QUAL_HOSTS || "")
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toLowerCase().replace(/^www\./, ""))
      .filter(Boolean),
  },
};

config.mailConfigured = Boolean(config.smtp.host);

module.exports = config;
