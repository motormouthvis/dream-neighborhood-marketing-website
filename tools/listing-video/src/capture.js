"use strict";

/**
 * Opens the customer's website and screenshots one of their live listing
 * DETAIL pages: one address, beds and baths, a price, photos.
 *
 * Three things this module refuses to do, because each one produced a bad
 * video:
 *
 *   - It will not film a search, map or results page. Those are an IDX form and
 *     a map, not a house.
 *   - It will not screenshot with an overlay on screen. Cookie bars, chat
 *     bubbles and voice-command widgets all sit exactly where the caption or
 *     the house button goes.
 *   - It will not fall back to the homepage. If it cannot find a clean listing
 *     it says so and asks for a listing URL.
 */

const path = require("path");
const {
  classifyPage,
  extractAddress,
  looksLikeSingleListingUrl,
  looksLikeIdxSearchUrl,
  REGISTRATION_GATE_RE,
} = require("./page-analysis");
const { closeStartupPage } = require("./browser");

const LISTING_HREF_HINTS =
  /(listing|listings|property|properties|homes?-for-sale|for-sale|home-details|homedetail|idx|mls|\/p\/|\/home\/|\/l\/|realestate|real-estate)/i;

const NON_LISTING_HREF =
  /(blog|about|contact|privacy|terms|careers|team|agents?\/|login|signin|sign-in|register|\.pdf$|mailto:|tel:|\/idx\/(mortgage|home-?valuation|contact|roster|saved|signup|forgot|emailupdate))/i;

// Links that lead to another search rather than to a house.
const SEARCH_HREF =
  /(\/search|\/results|\/map\b|advanced-?search|property-?search|\/browse\b|[?&](q|query|search|keyword|sort|minprice|maxprice)=)/i;

// Pages that usually hold a grid of live listings, tried when the entry page
// does not link to any. These are not filmed themselves - they are where the
// links to the actual listings live.
const LISTING_INDEX_PATHS = [
  "/listings",
  "/properties",
  "/homes",
  "/homes-for-sale",
  "/featured-listings",
  "/our-listings",
  "/new-listings",
  "/open-houses",
  "/for-sale",
  "/property-search",
  "/idx",
];

/**
 * Things that are always an overlay, whatever they claim to be. Matched on id
 * and class, so a wrapper called "voice-command-modal" goes even if it is not
 * position: fixed.
 */
const OVERLAY_SELECTORS = [
  "[role=dialog]",
  "[aria-modal=true]",
  "dialog[open]",
  '[class*="modal"]',
  '[id*="modal"]',
  '[class*="dialog"]',
  '[class*="cookie"]',
  '[id*="cookie"]',
  '[class*="consent"]',
  '[id*="consent"]',
  '[class*="gdpr"]',
  '[class*="ccpa"]',
  '[class*="popup"]',
  '[id*="popup"]',
  '[class*="overlay"]',
  '[class*="backdrop"]',
  '[class*="lightbox"]',
  '[class*="fancybox"]',
  '[class*="voice"]',
  '[id*="voice"]',
  '[class*="speech"]',
  '[class*="microphone"]',
  '[id*="microphone"]',
  '[class*="chat-widget"]',
  '[class*="livechat"]',
  '[id*="livechat"]',
  '[class*="intercom"]',
  '[id*="intercom"]',
  '[class*="drift-"]',
  '[id*="tawk"]',
  '[class*="olark"]',
  '[id*="hubspot-messages"]',
  '[class*="newsletter"]',
  '[class*="subscribe-modal"]',
  '[class*="toast"]',
  '[class*="snackbar"]',
  "#onetrust-consent-sdk",
  "#CybotCookiebotDialog",
  ".osano-cm-window",
];

/**
 * Wording that gives an overlay away even when its markup does not.
 *
 * The lead-capture phrases are here because an IDX "Create Your Free Account"
 * modal appeared over a listing a second after the page settled, and a form for
 * somebody else's mailing list is not the house we came to film.
 */
const OVERLAY_TEXT =
  /(microphone access|microphone is blocked|allow microphone|voice command|voice search|available voice commands|speech recognition|we use cookies|this site uses cookies|accept cookies|cookie policy|your privacy choices|subscribe to our newsletter|sign up for our newsletter|join our mailing list|enable notifications|create your free account|create an account|get instant access|sign up to (see|view|save)|register to (see|view|continue)|log in to (see|view|continue)|save your search|unlock (this|all) (listing|photo|home)|see all photos.{0,20}sign|enter your email|already have an account)/i;

/*
 * Buttons that make an overlay go away.
 *
 * Deliberately does NOT include "continue", "next", "submit" or anything that
 * could be a step in a registration form. We do not create accounts and we do
 * not fill forms in, so nothing here may advance one.
 */
const DISMISS_LABELS =
  /^(accept|accept all|accept all cookies|accept cookies|allow all|i agree|agree|understood|got it|ok|okay|close|dismiss|no thanks|no, thanks|not now|maybe later|later|reject all|reject|decline|deny|skip|skip for now|x|\u00d7|\u2715)$/i;

/**
 * Copy that means a box is asking for an account. Used to keep our hands off it:
 * nothing inside one of these is clicked, whatever its label says.
 */
const SIGNUP_FORM_TEXT =
  /(create an account|create your free account|create a free account|register to|please register|sign up|sign in|log in|become a member|already have an account|password)/i;

/* ---------------------------------------------------------------- */
/* cookie banners                                                   */
/* ---------------------------------------------------------------- */

/**
 * The accept button of the consent tools that actually turn up on realtor
 * sites. Going for these by name is quicker and far more reliable than reading
 * labels, and it presses "accept" rather than "reject", so the banner does not
 * come straight back.
 */
const COOKIE_ACCEPT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  ".onetrust-close-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  "#CybotCookiebotDialogBodyLevelButtonAccept",
  ".osano-cm-accept-all",
  ".osano-cm-accept",
  ".cky-btn-accept",
  "#cookiescript_accept",
  "#cookiescript_accept_all",
  ".cc-btn.cc-allow",
  ".cc-btn.cc-dismiss",
  "#hs-eu-confirmation-button",
  ".iubenda-cs-accept-btn",
  ".cmplz-accept",
  "#cn-accept-cookie",
  "#gdpr-cookie-accept",
  "#accept-cookies",
  ".accept-cookies",
  ".accept-all-cookies",
  '[data-cookiebanner="accept_button"]',
  '[data-testid="uc-accept-all-button"]',
  '[aria-label="Accept cookies"]',
  '[aria-label="Accept all cookies"]',
  '[aria-label="Accept all"]',
  "#cmpwelcomebtnyes",
  "#cmpbntyestxt",
  ".qc-cmp2-summary-buttons > button:last-of-type",
  ".fc-cta-consent",
  ".truste-button1",
  "#truste-consent-button",
  ".evidon-banner-acceptbutton",
  "#didomi-notice-agree-button",
  ".didomi-continue-without-agreeing",
  ".termsfeed-com---nb-interstitial-overlay button",
];

/** Containers, so a banner that will not take a click can still be hidden. */
const COOKIE_CONTAINER_SELECTORS = [
  "#onetrust-banner-sdk",
  "#onetrust-consent-sdk",
  "#CybotCookiebotDialog",
  ".osano-cm-window",
  ".cky-consent-container",
  "#cookiescript_injected",
  ".cc-window",
  "#hs-eu-cookie-confirmation",
  ".iubenda-cs-container",
  "#cmplz-cookiebanner-container",
  "#cookie-notice",
  "#gdpr-cookie-message",
  ".qc-cmp2-container",
  ".fc-consent-root",
  "#truste-consent-track",
  "#evidon-banner",
  "#didomi-host",
  '[class*="cookie-banner"]',
  '[class*="cookie-bar"]',
  '[class*="cookie-notice"]',
  '[class*="cookie-consent"]',
  '[id*="cookie-banner"]',
  '[id*="cookie-bar"]',
  '[id*="cookie-consent"]',
  '[class*="consent-banner"]',
  '[aria-label*="cookie" i]',
];

/** Wording that gives a consent banner away when its markup does not. */
const COOKIE_TEXT =
  /(cookie|cookies|consent|gdpr|ccpa|privacy preferences|tracking technolog|your privacy choices|we value your privacy)/i;

const COOKIE_ACCEPT_LABEL =
  /^(accept|accept all|accept all cookies|accept cookies|accept & ?close|accept and close|accept & ?continue|allow all|allow all cookies|allow cookies|i agree|i accept|agree|agree & ?continue|agree and continue|got it|ok|okay|understood|continue|yes, i agree|enable all|save & ?accept|allow|i understand)$/i;

/* eslint-disable no-undef */
/**
 * Press "accept" on a cookie banner. Runs in the page.
 *
 * Returns what it pressed, so the caller can say so in the log and can tell the
 * difference between "there was nothing to accept" and "I pressed it".
 */
function clickCookieAccept(acceptSelectors, containerSelectors, cookieTextSource, acceptLabelSource, signupTextSource) {
  const cookieText = new RegExp(cookieTextSource, "i");
  const acceptLabel = new RegExp(acceptLabelSource, "i");
  // A registration form's small print mentions cookies and privacy, so it can
  // look like a consent banner. Nothing inside one gets clicked.
  const signupText = new RegExp(signupTextSource, "i");
  const isSignupForm = (el) => {
    const text = el.innerText || "";
    if (!signupText.test(text)) return false;
    return Boolean(el.querySelector("input[type=email], input[type=password], input[name*=email i], form"));
  };

  const visible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity || 1) <= 0.05) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const press = (el, how) => {
    try {
      el.click();
      return { pressed: how, label: (el.innerText || el.value || "").trim().slice(0, 40) };
    } catch (_) {
      return null;
    }
  };

  // 1. The known consent tools, by name.
  for (const selector of acceptSelectors) {
    let el;
    try {
      el = document.querySelector(selector);
    } catch (_) {
      continue;
    }
    if (visible(el)) {
      const done = press(el, selector);
      if (done) return done;
    }
  }

  // 2. A known container, then the accept button inside it.
  const containers = [];
  for (const selector of containerSelectors) {
    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (_) {
      continue;
    }
    for (const el of Array.from(nodes)) if (visible(el)) containers.push(el);
  }

  // 3. Anything floating that talks about cookies and has a button in it.
  for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 3000)) {
    if (!visible(el)) continue;
    const style = window.getComputedStyle(el);
    const floats = style.position === "fixed" || style.position === "sticky" || Number(style.zIndex || 0) >= 100;
    if (!floats) continue;
    const text = el.innerText || "";
    if (text.length > 2000 || !cookieText.test(text)) continue;
    if (!el.querySelector("button, a, [role='button']")) continue;
    // Prefer the smallest box that still holds the whole banner.
    if (!Array.from(el.children).some((child) => visible(child) && cookieText.test(child.innerText || ""))) {
      containers.push(el);
    } else if (!containers.length) {
      containers.push(el);
    }
  }

  for (const container of containers) {
    if (isSignupForm(container)) continue;
    const buttons = Array.from(container.querySelectorAll("button, a, [role='button'], input[type='submit']"));
    for (const button of buttons) {
      const label = (button.innerText || button.value || button.getAttribute("aria-label") || "").trim();
      if (label && acceptLabel.test(label) && visible(button)) {
        const done = press(button, "label in a cookie banner");
        if (done) return done;
      }
    }
    // No exact match, so take a button that at least says accept or agree.
    for (const button of buttons) {
      const label = (button.innerText || button.value || button.getAttribute("aria-label") || "").trim();
      if (label && /accept|agree|allow|got it|understand/i.test(label) && !/reject|decline|deny|manage|settings|preferences|customi/i.test(label) && visible(button)) {
        const done = press(button, "accept-ish button in a cookie banner");
        if (done) return done;
      }
    }
  }

  return { pressed: null, label: "" };
}

/**
 * Cookie banners still on screen. Runs in the page.
 *
 * Only things that float are considered, so the words "we use cookies" inside a
 * privacy policy in the page body are not mistaken for a banner.
 */
function findCookieBanners(containerSelectors, cookieTextSource) {
  const cookieText = new RegExp(cookieTextSource, "i");
  const out = [];
  const seen = new Set();

  const visible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity || 1) <= 0.05) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width * rect.height < 4000) return false;
    return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
  };

  const note = (el, how) => {
    if (seen.has(el)) return;
    seen.add(el);
    out.push({
      how,
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      cls: typeof el.className === "string" ? el.className.slice(0, 60) : "",
      text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 90),
    });
  };

  for (const selector of containerSelectors) {
    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (_) {
      continue;
    }
    for (const el of Array.from(nodes)) if (visible(el)) note(el, "a known cookie banner");
  }

  for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 3000)) {
    if (!visible(el)) continue;
    const style = window.getComputedStyle(el);
    const floats = style.position === "fixed" || style.position === "sticky" || Number(style.zIndex || 0) >= 100;
    if (!floats) continue;
    const text = el.innerText || "";
    if (text.length > 2000 || !cookieText.test(text)) continue;
    if (Array.from(el.children).some((child) => cookieText.test(child.innerText || ""))) continue;
    note(el, "something floating that talks about cookies");
    if (out.length >= 5) break;
  }

  return out;
}

/** Last resort: take the banner off the page so it cannot cover the listing. */
function hideCookieBanners(containerSelectors, cookieTextSource) {
  const cookieText = new RegExp(cookieTextSource, "i");
  let hidden = 0;
  const kill = (el) => {
    if (!el || el === document.body || el === document.documentElement) return;
    el.style.setProperty("display", "none", "important");
    hidden += 1;
  };

  for (const selector of containerSelectors) {
    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (_) {
      continue;
    }
    for (const el of Array.from(nodes)) kill(el);
  }
  for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 3000)) {
    const style = window.getComputedStyle(el);
    const floats = style.position === "fixed" || style.position === "sticky" || Number(style.zIndex || 0) >= 100;
    if (!floats) continue;
    const text = el.innerText || "";
    if (text.length > 2000 || !cookieText.test(text)) continue;
    kill(el);
  }

  // Consent tools often lock scrolling while their dialog is up.
  for (const el of [document.documentElement, document.body]) {
    el.style.setProperty("overflow", "visible", "important");
    el.style.removeProperty("position");
  }
  return hidden;
}
/* eslint-enable no-undef */

/**
 * Accept the cookie banner and wait until it is actually gone.
 *
 * Clicking is not the same as dismissed, so this presses accept, waits, and
 * checks. It tries a few times, since some tools show a second banner. If the
 * banner survives all that, it gets hidden, because a cookie bar in the frame
 * is a failed capture.
 */
async function acceptCookies(page, log) {
  const banners = () => page.evaluate(findCookieBanners, COOKIE_CONTAINER_SELECTORS, COOKIE_TEXT.source).catch(() => []);

  let found = await banners();
  if (!found.length) return { accepted: false, hidden: 0, remaining: [] };

  log(`Cookie banner on the page ("${String(found[0].text || found[0].cls).slice(0, 50)}") - accepting it`);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Some consent dialogs live in their own iframe, so every frame gets a go.
    for (const frame of page.frames()) {
      try {
        const result = await frame.evaluate(
          clickCookieAccept,
          COOKIE_ACCEPT_SELECTORS,
          COOKIE_CONTAINER_SELECTORS,
          COOKIE_TEXT.source,
          COOKIE_ACCEPT_LABEL.source,
          SIGNUP_FORM_TEXT.source
        );
        if (result && result.pressed) break;
      } catch (_) {
        /* a cross-origin frame we cannot touch is not fatal */
      }
    }
    await sleep(500);
    found = await banners();
    if (!found.length) {
      log("Cookie banner accepted and gone");
      return { accepted: true, hidden: 0, remaining: [] };
    }
  }

  const hidden = await page.evaluate(hideCookieBanners, COOKIE_CONTAINER_SELECTORS, COOKIE_TEXT.source).catch(() => 0);
  await sleep(250);
  const remaining = await banners();
  if (remaining.length) {
    log(`That cookie banner will not go away ("${remaining[0].text || remaining[0].cls}")`);
  } else {
    log("Cookie banner would not take a click, so it was taken off the page");
  }
  return { accepted: false, hidden, remaining };
}

/*
 * A capture has to finish or fail inside a minute. It used to be allowed four,
 * and on a 512MB dyno that meant Chrome climbing past a gigabyte and killing
 * the web process, which took the job folder with it.
 */
const CAPTURE_BUDGET_MS = 60000;
const GOTO_TIMEOUT_MS = 12000;
const IDLE_TIMEOUT_MS = 4000;

/*
 * Exactly one listing detail page per capture.
 *
 * IDX sites count how many listings a visitor has looked at and put up a
 * "create an account to view more listings" wall after a few. We are not going
 * to trip that counter, and we are certainly not going to get past it, so one
 * listing is opened and that is the one that gets filmed.
 */
const MAX_LISTING_VIEWS = 1;
// Pages opened purely to get at their links - a listings index, a search page.
// These are not listing views and do not count against the one above.
const MAX_NAV_VISITS = 3;
// A backstop on opening candidates that turn out not to be listings at all.
const MAX_CANDIDATE_OPENS = 4;
// Homepage, then their listings page, then the house. Three hops is enough.
const MAX_CRAWL_DEPTH = 3;
const VIEWPORT = { width: 1920, height: 1080 };
// Smaller while hunting: a 1920x1080 render of every candidate is memory we do
// not need until the shot itself.
const CRAWL_VIEWPORT = { width: 1024, height: 768 };

/**
 * Everything that costs memory and tells us nothing about whether a page is a
 * listing. Blocked for the whole crawl, then allowed again for the one page that
 * actually gets photographed.
 */
const HEAVY_RESOURCE_TYPES = new Set(["image", "font", "media"]);

/**
 * Analytics, ads and session recording. Consent tools are deliberately absent
 * from this list: blocking those would leave a half-drawn cookie banner that
 * cannot be accepted.
 */
const JUNK_HOSTS =
  /(googletagmanager\.com|google-analytics\.com|googlesyndication\.com|doubleclick\.net|googleadservices\.com|facebook\.net|connect\.facebook|hotjar\.(com|io)|fullstory\.com|mouseflow\.com|clarity\.ms|segment\.(io|com)|mixpanel\.com|amplitude\.com|newrelic\.com|nr-data\.net|bat\.bing\.com|ads-twitter\.com|analytics\.tiktok\.com|criteo\.(com|net)|taboola\.com|outbrain\.com|scorecardresearch\.com|quantserve\.com\/pixel|bing\.com\/bat)/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("Website URL is required.");
  // "example.com" is fine and gets https:// put on the front, but a scheme we
  // cannot open has to be rejected rather than glued onto https://.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) {
    throw new Error("Website URL must be http or https.");
  }
  const parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Website URL must be http or https.");
  if (!/^[a-z0-9.-]+$/i.test(parsed.hostname) || !parsed.hostname.includes(".")) {
    throw new Error("Website URL needs a domain name, like domorealty.com.");
  }
  return parsed.toString();
}

function captureError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.isCaptureRefusal = true;
  return error;
}

/**
 * The site wants an account. Bill's words, because this is the one refusal where
 * the person reading it can fix the problem in five seconds.
 */
function registrationWallError() {
  return captureError(
    "REGISTRATION_WALL",
    "This site asks for an account after a few listing views. Paste a listing URL."
  );
}

/**
 * What an HTTP status actually means, in words.
 *
 * A 403 is the site refusing an automated browser, not a missing page. Telling
 * somebody "there is no page there" when curl gets a 302 from their laptop sends
 * them looking for a typo that is not there.
 */
function statusError(status, { pastedListing = false } = {}) {
  const ask = pastedListing
    ? "Try a different listing URL."
    : "Paste one listing URL and try again.";

  let code = "SITE_UNREACHABLE";
  let message = `That address came back as ${status}. ${ask}`;

  if (status === 401 || status === 403 || status === 451) {
    code = "SITE_BLOCKED";
    message = `That site blocked the capture (HTTP ${status}). Some sites refuse automated browsers even though the page opens fine in your own. ${ask}`;
  } else if (status === 429) {
    code = "SITE_BLOCKED";
    message = `That site is rate limiting us (HTTP 429), so it would not load the page. Wait a minute, then ${ask.toLowerCase()}`;
  } else if (status === 404 || status === 410) {
    code = "PAGE_NOT_FOUND";
    message = `There is no page at that address (HTTP ${status}). Check it and try again.`;
  } else if (status >= 500) {
    code = "SITE_ERROR";
    message = `That site returned an error (HTTP ${status}), so nothing could be filmed. Try again in a minute, or ${ask.toLowerCase()}`;
  }

  const error = captureError(code, message);
  // The status travels with the refusal, so the failure log can record the one
  // that actually caused it rather than whatever the last page happened to say.
  error.httpStatus = status;
  return error;
}

/*
 * Where an IDX site keeps a plain list of its listings.
 *
 * Their Map Search is tried before any of these, because it is the control on
 * the page, but it draws into a canvas that stays empty in a headless browser.
 */
const IDX_RESULT_PATHS = ["/idx/results/listings", "/idx/featured"];

/** Wait for listing links to be drawn, since IDX fills its cards in after load. */
async function waitForListingHrefs(page, ms) {
  if (!page || ms <= 0) return false;
  try {
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("a[href]")).some((anchor) =>
          /\/(idx\/details\/listing|details\/listing|listing|listings|property|properties)\/[^/?#]+/i.test(
            anchor.getAttribute("href") || ""
          )
        ),
      { timeout: ms, polling: 250 }
    );
    return true;
  } catch (_) {
    return false;
  }
}

/* How long a picture of a failed page is worth waiting for, and no longer. */
const FAILURE_SHOT_TIMEOUT_MS = 4000;

/** A refusal about a search page, which is what it stopped on. */
function searchOnlyError(pageUrl, message) {
  const error = captureError("SITE_IS_SEARCH_ONLY", message);
  error.pageKind = "search";
  error.pageUrl = pageUrl || "";
  return error;
}

/** The same page, allowing for a trailing slash or a redirect to itself. */
function sameTarget(a, b) {
  if (!a || !b) return false;
  const tidy = (value) => {
    try {
      const parsed = new URL(value);
      return `${parsed.host}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`.toLowerCase();
    } catch (_) {
      return String(value).toLowerCase();
    }
  };
  return tidy(a) === tidy(b);
}

/*
 * A customer who already has an Explorer is not a dead end, he is the upgrade
 * pitch. Andy Harris has our School Explorer on his listings, so the two
 * before-and-after scripts have no "before" to film there - and the third script
 * exists for exactly that customer. Say so, rather than only saying no.
 */
const EXPLORER_ALREADY_THERE =
  "That page already has a Dream Neighborhood Explorer on it, so it cannot be the \u201cbefore\u201d shot for this script. " +
  "This customer is already on School Explorer, so the \u201cSE to NE upgrade\u201d script is the one to use - it opens on their listing with School Explorer and pitches Neighborhood Explorer. " +
  "Otherwise paste one of their listings that does not have it yet.";

/** One refusal for "something is over the page", naming a cookie bar as such. */
function blockedError(left) {
  const worst = left[0] || {};
  const what = worst.text || worst.cls || worst.tag || "something";
  return worst.cookie
    ? captureError(
        "COOKIE_BANNER_IN_THE_WAY",
        `A cookie banner on that page would not close ("${what}"), so the listing behind it cannot be filmed cleanly. Try a different listing URL.`
      )
    : captureError(
        "OVERLAY_IN_THE_WAY",
        `Something on that page keeps covering it up (${what}), so the screenshot would show a popup instead of the listing. Try a different listing URL.`
      );
}

/* ---------------------------------------------------------------- */
/* stop the overlays before the page can ask for anything           */
/* ---------------------------------------------------------------- */

/**
 * A realtor site's voice-command widget asks for the microphone, headless
 * Chrome has no microphone, and the site puts a "Microphone access denied"
 * panel in the middle of the page. The cure is to make the browser look like it
 * has no speech support at all, so the widget never starts.
 */
async function silenceMediaFeatures(page) {
  await page.evaluateOnNewDocument(() => {
    const gone = () => undefined;
    for (const name of [
      "SpeechRecognition",
      "webkitSpeechRecognition",
      "SpeechGrammarList",
      "webkitSpeechGrammarList",
      "SpeechRecognitionEvent",
      "webkitSpeechRecognitionEvent",
    ]) {
      try {
        delete window[name];
        Object.defineProperty(window, name, { get: gone, configurable: true });
      } catch (_) {
        /* some builds will not let us, and that is survivable */
      }
    }
    try {
      Object.defineProperty(navigator, "mediaDevices", { get: gone, configurable: true });
    } catch (_) {
      /* ignore */
    }
    try {
      Object.defineProperty(navigator, "permissions", { get: gone, configurable: true });
    } catch (_) {
      /* ignore */
    }
    // Notification and location prompts draw their own bars across the top.
    try {
      window.Notification = undefined;
    } catch (_) {
      /* ignore */
    }
    try {
      Object.defineProperty(navigator, "geolocation", { get: gone, configurable: true });
    } catch (_) {
      /* ignore */
    }
  });
}

/**
 * One pass of: press the buttons that make overlays go away, then hide whatever
 * is still floating over the middle of the page or over the bottom strip where
 * the house button goes.
 *
 * Runs in the page. Returns how many things it hid.
 */
/* eslint-disable no-undef */
function dismissPass(selectors, overlayTextSource, dismissLabelSource) {
  const overlayText = new RegExp(overlayTextSource, "i");
  const dismissLabel = new RegExp(dismissLabelSource, "i");
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let hidden = 0;

  const hide = (el) => {
    if (!el || el === document.body || el === document.documentElement) return;
    // Hide it again every time. A lead-capture modal that reappears on scroll
    // has to be hidden again, so this cannot skip anything it has seen before -
    // the marker only stops it being counted twice.
    el.style.setProperty("display", "none", "important");
    // Marked with an expando, not an attribute. An earlier version used
    // data-dn-hidden, which the Explorer check then read as a Dream
    // Neighborhood widget on every page we had cleaned.
    if (!el.__lvmHidden) {
      el.__lvmHidden = true;
      hidden += 1;
    }
  };

  const visible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return Number(style.opacity || 1) > 0.05;
  };

  // 1. Click the obvious "go away" controls, but never one that sits inside a
  //    form asking for an account.
  const signupText = /(create an account|create your free account|register to|please register|sign up|sign in|log in|become a member|already have an account|password)/i;
  const inSignupForm = (el) => {
    let node = el;
    for (let up = 0; node && up < 6; up += 1) {
      if (node.querySelector && node.querySelector("input[type=email], input[type=password]")) {
        if (signupText.test(node.innerText || "")) return true;
      }
      node = node.parentElement;
    }
    return false;
  };

  const clickable = document.querySelectorAll(
    "button, a, [role=button], input[type=button], input[type=submit], [aria-label]"
  );
  for (const el of Array.from(clickable)) {
    const label = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim();
    if (!label || label.length > 30) continue;
    if (!dismissLabel.test(label)) continue;
    if (inSignupForm(el)) continue;
    try {
      el.click();
    } catch (_) {
      /* ignore */
    }
  }

  // 2. Anything whose own markup says "I am an overlay".
  for (const selector of selectors) {
    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (_) {
      continue;
    }
    for (const el of Array.from(nodes)) {
      if (!visible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 24) continue;
      // A gallery lightbox that IS the page content would take the photos with
      // it, so only hide things that float or that read like an overlay.
      const style = window.getComputedStyle(el);
      const floats = style.position === "fixed" || Number(style.zIndex || 0) >= 100;
      if (!floats && !overlayText.test(el.innerText || "")) continue;
      hide(el);
    }
  }

  // 3. Anything that reads like an overlay, wherever it sits.
  for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 3000)) {
    if (!visible(el)) continue;
    const own = el.innerText || "";
    if (own.length > 1200 || !overlayText.test(own)) continue;
    // Take the smallest box that still contains the wording.
    const inner = Array.from(el.querySelectorAll("*")).some(
      (child) => visible(child) && overlayText.test(child.innerText || "")
    );
    if (inner) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 20) continue;
    hide(el);
  }

  // 4. Things floating over the middle, or over the bottom where our button
  //    goes. An absolutely positioned modal inside a fixed backdrop counts too,
  //    which is how an IDX sign-up form got into a finished frame.
  const centre = { left: vw * 0.18, right: vw * 0.82, top: vh * 0.22, bottom: vh * 0.82 };
  for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 3000)) {
    if (!visible(el)) continue;
    const style = window.getComputedStyle(el);
    const floats =
      style.position === "fixed" ||
      ((style.position === "absolute" || style.position === "sticky") && Number(style.zIndex || 0) >= 100);
    if (!floats) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 30 || rect.height < 30) continue;
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;

    const overCentre =
      rect.right > centre.left && rect.left < centre.right && rect.bottom > centre.top && rect.top < centre.bottom;
    const overBottom = rect.bottom > vh * 0.72;
    const coversPage = rect.width * rect.height > vw * vh * 0.4;
    if (overCentre || overBottom || coversPage) hide(el);
  }

  // 5. Modals lock scrolling and blur the page behind them. Put that back.
  for (const el of [document.documentElement, document.body]) {
    el.style.setProperty("overflow", "visible", "important");
    el.style.removeProperty("position");
    el.style.removeProperty("filter");
    if (el.className && typeof el.className === "string") {
      el.className = el.className
        .split(/\s+/)
        .filter((name) => !/(modal|no-?scroll|overflow-hidden|scroll-lock|locked|popup-open|menu-open)/i.test(name))
        .join(" ");
    }
  }
  const main = document.querySelector("main, #main, #content, .content");
  if (main) main.style.removeProperty("filter");

  return hidden;
}

/**
 * What, if anything, is still in the way. Used to decide whether the page is
 * safe to screenshot at all.
 */
function findBlockers() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const centre = { left: vw * 0.2, right: vw * 0.8, top: vh * 0.25, bottom: vh * 0.8 };
  const out = [];
  for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 3000)) {
    const style = window.getComputedStyle(el);
    // Fixed, or a high-layer absolute/sticky box: a modal is often absolutely
    // positioned inside a fixed backdrop.
    const floats =
      style.position === "fixed" ||
      ((style.position === "absolute" || style.position === "sticky") && Number(style.zIndex || 0) >= 100);
    if (!floats) continue;
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (Number(style.opacity || 1) <= 0.05) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 60 || rect.height < 40) continue;
    const overCentre =
      rect.right > centre.left && rect.left < centre.right && rect.bottom > centre.top && rect.top < centre.bottom;
    const overBottom = rect.bottom > vh * 0.75 && rect.width > vw * 0.25;
    if (!overCentre && !overBottom) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      cls: typeof el.className === "string" ? el.className.slice(0, 60) : "",
      text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
    });
    if (out.length >= 5) break;
  }
  return out;
}
/* eslint-enable no-undef */

async function clearOverlays(page, { passes = 2 } = {}) {
  let hidden = 0;
  for (let pass = 0; pass < passes; pass += 1) {
    try {
      hidden += await page.evaluate(dismissPass, OVERLAY_SELECTORS, OVERLAY_TEXT.source, DISMISS_LABELS.source);
    } catch (_) {
      /* a page that will not run our script is still worth checking */
    }
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(150);
  }
  return hidden;
}

async function blockers(page) {
  try {
    const overlays = await page.evaluate(findBlockers);
    const cookies = await page.evaluate(findCookieBanners, COOKIE_CONTAINER_SELECTORS, COOKIE_TEXT.source);
    // A cookie bar counts wherever it sits, including pinned to the very top,
    // which the overlay check ignores so it does not eat sticky site headers.
    // Cookies come first because "the cookie banner would not close" is a far
    // more useful thing to tell someone than "something is covering the page".
    return cookies.map((entry) => ({ ...entry, cookie: true })).concat(overlays);
  } catch (_) {
    return [];
  }
}

/* ---------------------------------------------------------------- */
/* what is on this page                                             */
/* ---------------------------------------------------------------- */

/* eslint-disable no-undef */
/**
 * Is the site gating this listing behind an account? Runs in the page, before
 * anything has been cleared off it, because the overlay pass would hide the very
 * thing we are looking for.
 *
 * Two shapes count:
 *   blocking  - a box carrying gate wording, with a way to register in it, that
 *               covers a good part of the page or sits over the middle of it
 *   wholePage - the page itself is the registration form, with no listing on it
 *
 * An optional "Sign In" link in a header matches neither, which is the point:
 * the same listing URL in a clean profile shows the whole house with nothing but
 * that link, so it must never be mistaken for a locked door.
 */
function readRegistrationGate(gateSource) {
  const gate = new RegExp(gateSource, "i");
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const centre = { left: vw * 0.25, right: vw * 0.75, top: vh * 0.2, bottom: vh * 0.8 };

  const canRegister = (el) =>
    Boolean(
      el.querySelector("input[type=password], input[type=email], input[name*='email' i]") ||
        Array.from(el.querySelectorAll("button, a, input[type=submit]")).some((control) =>
          /register|create account|create an account|sign up|join now/i.test(
            control.innerText || control.value || ""
          )
        )
    );

  let blocking = null;
  for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 4000)) {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (Number(style.opacity || 1) <= 0.05) continue;
    const floats =
      style.position === "fixed" ||
      ((style.position === "absolute" || style.position === "sticky") && Number(style.zIndex || 0) >= 100);
    if (!floats) continue;

    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 1500 || !gate.test(text)) continue;
    if (!canRegister(el)) continue;

    const rect = el.getBoundingClientRect();
    const coverage = (rect.width * rect.height) / (vw * vh);
    const overCentre =
      rect.right > centre.left && rect.left < centre.right && rect.bottom > centre.top && rect.top < centre.bottom;
    if (coverage < 0.15 && !overCentre) continue;

    blocking = { text: text.slice(0, 120), coverage: Math.round(coverage * 100) };
    break;
  }

  // The page itself is the gate: its heading asks you to register, there is
  // somewhere to type a password, and there is no house on it.
  const body = (document.body.innerText || "").replace(/\s+/g, " ");
  const heading = `${document.title || ""} ${Array.from(document.querySelectorAll("h1, h2"))
    .slice(0, 3)
    .map((el) => el.innerText || "")
    .join(" ")}`;
  const hasPrice = /\$\s?\d{2,3}(?:,\d{3})+/.test(body);
  const wholePage =
    gate.test(heading) && Boolean(document.querySelector("input[type=password], input[type=email]")) && !hasPrice;

  return {
    blocking: blocking ? true : false,
    wholePage,
    text: blocking ? blocking.text : wholePage ? heading.replace(/\s+/g, " ").trim().slice(0, 120) : "",
    coverage: blocking ? blocking.coverage : 0,
  };
}

function readPageFacts() {
  const attr = (selector, name) => {
    const el = document.querySelector(selector);
    return el ? (el.getAttribute(name) || "").trim() : "";
  };
  const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

  const bodyText = clean(document.body.innerText);

  /* ---- the page's own content, without the site furniture ----
   * The office address in a footer is not the listing address. Bill's video put
   * "2135 Bellflower Blvd" - the Fathom office - on the tooltip, so the footer
   * is kept out of the text everything else is judged on. A listing page's own
   * header is left in, because that is usually where the address lives.
   */
  const FOOTER_SEL =
    "footer, [class*='footer'], [id*='footer'], [class*='contact-info'], [class*='office-info']";
  const CHROME_SEL =
    "nav, [role='navigation'], script, style, noscript, [class*='cookie'], [id*='cookie'], [class*='consent'], [class*='gdpr'], body > header, #masthead, .site-header, .main-header, .global-header, .topbar, .top-bar";

  /*
   * A footer is a footer because of where it is, not only what it is called. A
   * wrapper called "page-footer-wrap" round the whole document used to swallow
   * the listing's own heading, which then counted as footer text and was thrown
   * away. So a named footer only counts when it actually sits low on the page.
   */
  const docHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight, 1);
  const isLowOnPage = (el) => {
    const box = el.getBoundingClientRect();
    return box.top + window.scrollY > docHeight * 0.55;
  };
  const footerNodes = Array.from(document.querySelectorAll(FOOTER_SEL)).filter(
    (el) => el.tagName === "FOOTER" || isLowOnPage(el)
  );

  const skip = new Set(footerNodes);
  for (const el of Array.from(document.querySelectorAll(CHROME_SEL))) skip.add(el);
  const inFooter = (el) => footerNodes.some((footer) => footer === el || footer.contains(el));

  const collect = (root) => {
    const parts = [];
    const walk = (node) => {
      if (skip.has(node)) return;
      for (const child of node.childNodes) {
        if (child.nodeType === 3) parts.push(child.nodeValue);
        else if (child.nodeType === 1) walk(child);
      }
    };
    walk(root);
    return clean(parts.join(" "));
  };
  const mainText = collect(document.body);
  const footerText = clean(footerNodes.map((el) => el.innerText || "").join(" "));

  /* ---- which address is this page about ---- */
  const addressCandidates = [];
  const pushCandidate = (text, where, el) => {
    const value = clean(text);
    if (!value || value.length > 200) return;
    addressCandidates.push({ text: value, where, inFooter: el ? inFooter(el) : false });
  };
  for (const el of Array.from(document.querySelectorAll("h1")).slice(0, 3)) {
    pushCandidate(el.innerText, "heading", el);
  }
  pushCandidate(attr('meta[property="og:title"]', "content"), "heading", null);
  pushCandidate(document.title, "heading", null);
  const ADDRESS_EL_SEL =
    "[itemprop='streetAddress'], [class*='street-address'], [class*='listing-address'], [class*='property-address'], [class*='address-line'], [data-address], .address, .addr";
  for (const el of Array.from(document.querySelectorAll(ADDRESS_EL_SEL)).slice(0, 8)) {
    pushCandidate(el.getAttribute("content") || el.innerText, "address-element", el);
  }
  for (const el of Array.from(document.querySelectorAll("h2")).slice(0, 4)) {
    pushCandidate(el.innerText, "heading", el);
  }

  /* ---- beds, baths and size for ONE home, in one block ----
   * A landing page can easily say "3 bedroom and 2 bathroom homes are the most
   * common", so a real spec row also has to carry a price or a size.
   */
  const beds = /\b\d+(\.\d)?\s*(bed|beds|bedroom|bedrooms|bd|bds|br)\b/i;
  const baths = /\b\d+(\.\d)?\s*(bath|baths|bathroom|bathrooms|ba|bth)\b/i;
  const money = /\$\s?\d{2,3}(?:,\d{3})+/;
  const size = /\b[\d,]{3,}\s*(sq\.?\s?ft|sqft|square feet)\b/i;
  let specRowText = "";
  // Capped, because reading innerText forces a layout each time and a big page
  // has tens of thousands of these. The spec row is never near the bottom.
  const specCandidates = Array.from(
    document.querySelectorAll("div, p, ul, ol, section, span, li, tr, dl, h2, h3")
  ).slice(0, 2500);
  for (const el of specCandidates) {
    if (skip.has(el)) continue;
    const text = clean(el.innerText);
    if (!text || text.length > 220) continue;
    if (!beds.test(text) || !baths.test(text)) continue;
    if (!money.test(text) && !size.test(text)) continue;
    if (!specRowText || text.length < specRowText.length) specRowText = text;
  }

  /* ---- buttons that sell a search rather than showing a house ---- */
  const ctaLabels = [];
  for (const el of Array.from(document.querySelectorAll("a, button, [role='button']")).slice(0, 400)) {
    if (skip.has(el) || el.closest(CHROME_SEL) || el.closest(FOOTER_SEL)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 24) continue;
    if (rect.top > window.innerHeight * 2) continue;
    const label = clean(el.innerText);
    if (label && label.length <= 60) ctaLabels.push(label);
    if (ctaLabels.length >= 30) break;
  }

  /* ---- a hero banner with buttons over it ---- */
  let hasHeroBanner = false;
  for (const el of Array.from(document.querySelectorAll("div, section, header")).slice(0, 600)) {
    const rect = el.getBoundingClientRect();
    if (rect.top > 900 || rect.width < window.innerWidth * 0.7 || rect.height < 200) continue;
    const style = window.getComputedStyle(el);
    const hasBackdrop =
      style.backgroundImage !== "none" ||
      Array.from(el.querySelectorAll("img, video")).some((media) => {
        const r = media.getBoundingClientRect();
        return r.width > window.innerWidth * 0.6 && r.height > 180;
      });
    if (!hasBackdrop) continue;
    if (el.querySelectorAll("a, button").length >= 2) {
      hasHeroBanner = true;
      break;
    }
  }

  const pricesIn = (text) =>
    new Set((text.match(/\$\s?\d{2,3}(?:,\d{3})+/g) || []).map((price) => price.replace(/\s/g, ""))).size;

  let listingLinks = 0;
  const hrefs = new Set();
  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") || "";
    if (/(listing|property|home-detail|homedetail|\/p\/|\/l\/|mls)/i.test(href) && !hrefs.has(href)) {
      hrefs.add(href);
      listingLinks += 1;
    }
  }

  let mapArea = 0;
  const mapSelector =
    '.leaflet-container, .gm-style, [class*="mapboxgl"], #map, #map-canvas, [class*="map-canvas"], [id*="map-container"], [class*="map-container"]';
  for (const el of Array.from(document.querySelectorAll(mapSelector))) {
    const rect = el.getBoundingClientRect();
    mapArea = Math.max(mapArea, (rect.width * rect.height) / (window.innerWidth * window.innerHeight));
  }

  let searchInputs = 0;
  for (const el of Array.from(document.querySelectorAll("input, select"))) {
    const hint = `${el.name || ""} ${el.id || ""} ${el.placeholder || ""} ${el.getAttribute("aria-label") || ""}`;
    if (/(price|bed|bath|city|zip|location|keyword|search|sort|min|max|type|status|area)/i.test(hint)) {
      searchInputs += 1;
    }
  }

  let galleryImages = 0;
  for (const img of Array.from(document.querySelectorAll("img, [class*='photo'], [class*='gallery'] > *"))) {
    const rect = img.getBoundingClientRect();
    if (rect.width >= 180 && rect.height >= 120) galleryImages += 1;
  }

  const mls = mainText.match(/\bMLS\s*#?\s*:?\s*([A-Z0-9-]{5,})/i);

  const microNode = document.querySelector('[itemtype*="PostalAddress"], [itemprop="address"]');
  const micro = {};
  if (microNode && !inFooter(microNode)) {
    for (const key of ["streetAddress", "addressLocality", "addressRegion", "postalCode"]) {
      const el = microNode.querySelector(`[itemprop="${key}"]`);
      if (el) micro[key] = clean(el.getAttribute("content") || el.textContent);
    }
  }

  return {
    url: location.href,
    title: document.title || "",
    ogTitle: attr('meta[property="og:title"]', "content"),
    h1s: Array.from(document.querySelectorAll("h1, h2"))
      .slice(0, 6)
      .map((el) => clean(el.innerText))
      .filter(Boolean),
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .slice(0, 12)
      .map((el) => (el.textContent || "").slice(0, 60000)),
    microdata: micro,
    addressCandidates,
    bodyText: bodyText.slice(0, 30000),
    mainText: mainText.slice(0, 30000),
    footerText: footerText.slice(0, 4000),
    specRowText,
    ctaLabels,
    hasHeroBanner,
    priceCount: pricesIn(bodyText),
    mainPriceCount: pricesIn(mainText),
    listingLinkCount: listingLinks,
    addressCount: (mainText.match(
      /\b\d{2,6}\s+[A-Z][A-Za-z]+\s+(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Ct|Court|Way|Pl|Place)\b/g
    ) || []).length,
    mapAreaFraction: mapArea,
    searchInputCount: searchInputs,
    galleryImageCount: galleryImages,
    hasBeds: beds.test(mainText),
    hasBaths: baths.test(mainText),
    hasSqft: size.test(mainText),
    mlsId: mls ? mls[1] : "",
  };
}

/**
 * Whether the page already has our own School Explorer or Neighborhood
 * Explorer on it, and how it was spotted. An actual embed is proof; the words
 * appearing in the page copy is only a hint.
 */
function readExplorer() {
  const sources = [];
  for (const el of Array.from(document.querySelectorAll("script[src], iframe[src], link[href]"))) {
    sources.push(el.getAttribute("src") || el.getAttribute("href") || "");
  }
  for (const el of Array.from(document.querySelectorAll("[id], [class]"))) {
    sources.push(`${el.id || ""} ${typeof el.className === "string" ? el.className : ""}`);
  }
  for (const el of Array.from(document.querySelectorAll("*"))) {
    for (const name of el.getAttributeNames ? el.getAttributeNames() : []) {
      if (name.startsWith("data-dn-") && name !== "data-dn-hidden") sources.push(name);
    }
  }
  const inline = Array.from(document.querySelectorAll("script:not([src])"))
    .map((el) => el.textContent || "")
    .join(" ")
    .slice(0, 200000);

  if (/dreamneighborhood|dream-neighborhood|dn-explorer|dn-popup|data-dn-/i.test(`${sources.join(" ")} ${inline}`)) {
    return { found: true, how: "embed" };
  }
  if (/(School Explorer|Neighborhood Explorer|Find Your Dream School)/i.test(document.body.innerText || "")) {
    return { found: true, how: "text" };
  }
  return { found: false, how: null };
}
/* eslint-enable no-undef */

async function collectPageFacts(page) {
  try {
    return await page.evaluate(readPageFacts);
  } catch (_) {
    return null;
  }
}

async function detectExplorer(page) {
  try {
    return await page.evaluate(readExplorer);
  } catch (_) {
    return { found: false, how: null };
  }
}

async function collectListingLinks(page, origin) {
  try {
    return await page.evaluate(
      (originValue, hintSource, blockSource, searchSource) => {
        const hint = new RegExp(hintSource, "i");
        const block = new RegExp(blockSource, "i");
        const search = new RegExp(searchSource, "i");
        const seen = new Set();
        const out = [];
        for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
          let href;
          try {
            href = new URL(anchor.getAttribute("href"), document.baseURI).toString();
          } catch (_) {
            continue;
          }
          if (!href.startsWith("http")) continue;
          // Their own site, including an IDX subdomain: plenty of agents serve
          // listings from idx.theirsite.com, and that is still their listing.
          const base = new URL(originValue).hostname.split(".").slice(-2).join(".");
          const host = new URL(href).hostname;
          if (host !== new URL(originValue).hostname && !host.endsWith(`.${base}`) && host !== base) continue;
          if (seen.has(href)) continue;
          seen.add(href);

          const label = (anchor.innerText || "").replace(/\s+/g, " ").trim();
          const parsed = new URL(href);
          const path = parsed.pathname;
          // Match on the path, never the whole URL. "redwagonteam.com" contains
          // "team", so testing the href threw away every link on that site.
          const where = `${path}${parsed.search}`;
          if (block.test(where)) continue;

          let score = 0;
          if (hint.test(where) || /(^|\.)idx\./i.test(host)) score += 3;
          // A concrete listing URL: /listings/123-main-st, /homes/4497-chase-dr.
          if (/\/\d{1,6}-[a-z]/i.test(path)) score += 5;
          if (/\/\d{4,}/.test(path) || /-\d{5,}/.test(path)) score += 2;
          // An IDX card: a price, beds and baths, and a photo.
          if (/\$\s?\d/.test(label)) score += 3;
          if (/\b\d+\s*(bd|bed|beds)\b/i.test(label)) score += 2;
          if (/\b\d+\s*(ba|bath|baths)\b/i.test(label)) score += 2;
          if (/^\d{1,6}\s+[A-Z]/.test(label)) score += 4;
          if (anchor.querySelector("img")) score += 1;
          // Deeper paths are listings; a single segment is usually a landing page.
          if (path.replace(/^\/|\/$/g, "").split("/").length >= 2) score += 1;
          // Another search page, or a page that is never one listing.
          if (search.test(where)) score -= 6;
          if (/^\/?(about|contact|blog|news|team|agents?|market-report|home-value|sell|buy|privacy|terms|faq)\b/i.test(path)) {
            score -= 8;
          }
          if (score > 0) out.push({ href, score, label: label.slice(0, 120) });
        }
        return out.sort((a, b) => b.score - a.score).slice(0, 30);
      },
      origin,
      LISTING_HREF_HINTS.source,
      NON_LISTING_HREF.source,
      SEARCH_HREF.source
    );
  } catch (_) {
    return [];
  }
}

async function settle(page, { forShot = false } = {}) {
  try {
    await page.evaluate(async (nudge) => {
      // Nudge lazy images into loading, then come back to the top for the shot.
      if (nudge) {
        window.scrollTo(0, 900);
        await new Promise((r) => setTimeout(r, 400));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 250));
    }, forShot);
  } catch (_) {
    /* ignore */
  }
  if (forShot) {
    try {
      await page.evaluate(() => document.fonts && document.fonts.ready);
    } catch (_) {
      /* ignore */
    }
  }
  await sleep(forShot ? 500 : 200);
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * A fresh page, set up the way capture needs it.
 *
 * One page at a time, and a new one for every navigation: closing the old page
 * hands its renderer memory back, which is the difference between finishing a
 * capture and being killed for using a gigabyte.
 */
async function preparePage(browser, { heavy = false } = {}) {
  const page = await browser.newPage();
  await silenceMediaFeatures(page);
  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ ...(heavy ? VIEWPORT : CRAWL_VIEWPORT), deviceScaleFactor: 1 });
  page.setDefaultNavigationTimeout(GOTO_TIMEOUT_MS);
  page.setDefaultTimeout(GOTO_TIMEOUT_MS);
  // A renderer that runs out of memory takes its page down with it. That must
  // be one bad page to skip, not an unhandled rejection that kills the job.
  page.on("error", () => {});

  if (!heavy) {
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      try {
        if (HEAVY_RESOURCE_TYPES.has(request.resourceType()) || JUNK_HOSTS.test(request.url())) {
          request.abort();
        } else {
          request.continue();
        }
      } catch (_) {
        /* the request was already handled */
      }
    });
  }
  return page;
}

async function closePage(page) {
  if (!page) return;
  await page.close({ runBeforeUnload: false }).catch(() => {});
}

/**
 * Load a page and get it presentable: cookie banner accepted, overlays gone,
 * scrolled back to the top.
 */
async function open(page, url, timeout, log = () => {}) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  const status = response ? response.status() : 0;
  // No point cleaning up a 404; the caller skips it.
  if (status >= 400) return { status, registrationGate: null };
  await page.waitForNetworkIdle({ idleTime: 500, timeout: IDLE_TIMEOUT_MS }).catch(() => {});

  // Cookies first, and on every page, because the banner has to be gone before
  // anything is judged or photographed.
  await acceptCookies(page, log);

  /*
   * Look for a registration gate BEFORE anything is cleared off the page.
   *
   * A "register to view this listing" box is exactly the sort of thing the
   * overlay pass hides, and a gate we have hidden is still a gate.
   */
  let registrationGate = { blocking: false, wholePage: false, text: "" };
  try {
    registrationGate = await page.evaluate(readRegistrationGate, REGISTRATION_GATE_RE.source);
  } catch (_) {
    /* a page that will not run our script gets the benefit of the doubt */
  }

  await clearOverlays(page);
  await settle(page);
  // Consent tools and popups often only appear a second or two after load.
  await acceptCookies(page, log);
  await clearOverlays(page);
  return { status, registrationGate };
}

/* ---------------------------------------------------------------- */
/* the hunt                                                         */
/* ---------------------------------------------------------------- */

/**
 * Screenshot one live listing detail page on the customer's site.
 *
 * explorerRule decides what to do about a listing that already has one of our
 * Explorers on it:
 *
 *   "absent"         - refuse it. The video is a "before" shot, so a page that
 *                      already has School Explorer is useless.
 *   "prefer-present" - look for one, because the video is an upgrade pitch to a
 *                      customer who already has School Explorer. A listing
 *                      without one is still accepted, and the renderer draws
 *                      School Explorer on it for the "what you have today" shot.
 *
 * Throws a refusal (error.isCaptureRefusal) when there is nothing usable, so
 * the job can tell the user what to do next instead of shipping a search page.
 */
async function captureListing({
  browser,
  url,
  listingUrl,
  outDir,
  log,
  explorerRule = "absent",
  budgetMs = CAPTURE_BUDGET_MS,
}) {
  const wantExplorer = explorerRule === "prefer-present";
  const home = normalizeUrl(url);
  const origin = new URL(home).origin;
  /* Pages holding their listings that the site refused outright. */
  let blockedFromSearch = 0;
  const start = listingUrl ? normalizeUrl(listingUrl) : home;
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  const outOfTime = () => Date.now() > deadline;
  const secondsLeft = () => Math.max(0, Math.round((deadline - Date.now()) / 1000));

  await closeStartupPage(browser);

  // One page at a time. The previous one is closed before the next opens, so
  // the renderer's memory goes back rather than piling up.
  let page = null;
  let registrationGate = null;
  /* Where we are, and whether it arrived with its photos, so nothing is loaded twice. */
  let loadedUrl = "";
  let loadedHeavy = false;
  /* The last status a navigation came back with, so a refusal can name it. */
  let lastStatus = 0;

  const visit = async (target, { heavy = false } = {}) => {
    await closePage(page);
    page = null;
    registrationGate = null;
    loadedUrl = "";
    loadedHeavy = false;
    if (outOfTime()) return 0;
    page = await preparePage(browser, { heavy });
    const opened = await open(page, target, Math.min(GOTO_TIMEOUT_MS, Math.max(3000, deadline - Date.now())), log);
    registrationGate = opened.registrationGate || null;
    loadedUrl = page.url();
    loadedHeavy = heavy;
    lastStatus = opened.status || 0;
    return opened.status;
  };

  /*
   * How many listing DETAIL pages have been opened.
   *
   * IDX sites count listing views and put up a "create an account" wall after a
   * few, so exactly one is opened per capture. Homepages, listings indexes and
   * search pages are not listing views and do not count.
   */
  let listingViews = 0;

  const checked = [];
  const tally = { detail: 0, wall: 0, search: 0, index: 0, marketing: 0, other: 0, withExplorer: 0, blocked: 0 };
  const KIND_LABELS = {
    wall: "a page asking for an account",
    search: "a search page",
    index: "a listings index",
    marketing: "a homepage or landing page",
    other: "a page that is not a listing",
  };

  /**
   * Is the page we are on right now the one to film? Records why not, either
   * way. "preferred" means it is exactly what this template wants; "ok" without
   * "preferred" means it will do if nothing better turns up.
   */
  const assess = async (pageUrl) => {
    const facts = await collectPageFacts(page);
    // Spotted before the overlays were cleared, so a hidden gate still counts.
    if (facts) facts.registrationGate = registrationGate;
    const verdict = classifyPage(facts);
    const explorer = await detectExplorer(page);
    const left = await blockers(page);

    const note = {
      url: pageUrl,
      kind: verdict.kind,
      why: verdict.reasons.slice(0, 2),
      address: verdict.address ? verdict.address.street : "",
      explorer: explorer.found ? explorer.how : null,
      blockers: left.length,
    };
    checked.push(note);
    tally[verdict.kind] = (tally[verdict.kind] || 0) + 1;
    if (verdict.kind === "detail" && explorer.found) tally.withExplorer += 1;
    // Opening a listing is the thing IDX sites count, so it is counted here too.
    if (verdict.kind === "detail") listingViews += 1;

    if (verdict.kind === "wall") {
      log(`That page will not show the listing without an account (${verdict.reasons[0]}) - stopping`);
      return { ok: false, reason: "wall", verdict, explorer, left };
    }
    if (verdict.kind !== "detail") {
      log(`Skipped ${KIND_LABELS[verdict.kind] || "a page that is not a listing"}: ${note.why[0] || verdict.kind}`);
      return { ok: false, reason: verdict.kind, verdict, explorer, left };
    }
    if (explorer.found && !wantExplorer) {
      log("That listing already shows an Explorer - looking for another one");
      return { ok: false, reason: "explorer", verdict, explorer, left };
    }
    if (left.length) {
      tally.blocked += 1;
      note.cookieBlocked = Boolean(left[0].cookie);
      log(
        `${left[0].cookie ? "A cookie banner is still on" : "Something is still covering"} that page (${
          left[0].text || left[0].cls || left[0].tag
        }) - looking for another one`
      );
      return { ok: false, reason: "blocked", verdict, explorer, left };
    }

    if (wantExplorer && !explorer.found) {
      // Only one listing gets opened, so there is no hunting for a better one.
      // School Explorer is drawn onto this listing for the opening shot instead.
      log("That listing does not have School Explorer on it yet - using it and adding School Explorer to the shot");
      return { ok: true, preferred: false, verdict, explorer, left, facts };
    }
    if (wantExplorer) log("That listing already has School Explorer on it - that is the one we want");
    return { ok: true, preferred: true, verdict, explorer, left, facts };
  };

  /**
   * Photograph the page we settled on.
   *
   * The crawl runs with images, fonts and analytics blocked, which is most of
   * the memory saving, so the one page that gets filmed is loaded again with
   * everything allowed and at full size. That reload happens once per capture.
   */
  const shoot = async (target, verdict, notes) => {
    /*
     * Already here with the photos loaded, so it is not fetched again.
     *
     * Loading a page twice costs a second listing view on sites that count them,
     * and Andy Harris's IDX answered 200 the first time and 403 the second - its
     * bot protection reacting to the repeat hit.
     */
    if (loadedHeavy && sameTarget(loadedUrl, target)) {
      log("The listing is already open with its photos");
      return finishShot(verdict, notes);
    }
    log("Loading the listing with its photos");
    /*
     * This page already loaded once during the crawl, so a failure here is a
     * hiccup rather than a verdict on the page. It gets one more go before we
     * give up, and a refusal that says which of the two things went wrong.
     */
    let status = 0;
    let trouble = null;
    for (const attempt of [1, 2]) {
      try {
        status = await visit(target, { heavy: true });
      } catch (error) {
        status = 0;
        trouble = error;
      }
      if (status && status < 400) break;
      if (attempt === 1) log("The page did not come back with its photos - one more try");
    }
    if (status >= 400) throw statusError(status, { pastedListing: Boolean(listingUrl) });
    if (!status) {
      throw captureError(
        "LISTING_URL_UNREACHABLE",
        `That listing page stopped answering while it was being photographed${
          trouble ? ` (${trouble.message})` : ""
        }. Try again, or paste a listing URL.`
      );
    }
    return finishShot(verdict, notes);
  };

  /** Clear the late overlays, then take the picture. */
  const finishShot = async (verdict, notes) => {
    await settle(page, { forShot: true });

    /*
     * Last look before the shutter, twice, with a pause between.
     *
     * Lead-capture modals are on a timer, and scrolling the page to load its
     * photos is exactly the sort of thing that triggers them. Checking once
     * straight after settling let an IDX "Create Your Free Account" form into a
     * finished frame, so this waits for the late arrivals and then insists.
     */
    for (let look = 0; look < 3; look += 1) {
      const left = await blockers(page);
      if (!left.length && look > 0) break;
      if (left.length) {
        log(`Clearing ${left[0].cookie ? "a cookie banner" : "a popup"} over the listing`);
        await acceptCookies(page, log);
        await clearOverlays(page);
      }
      await sleep(900);
    }

    const left = await blockers(page);
    if (left.length) throw blockedError(left);

    const address = verdict.address && verdict.address.street ? verdict.address : extractAddress(null);
    const shotPath = path.join(outDir, "site.png");
    await page.screenshot({ path: shotPath, type: "png", captureBeyondViewport: false });
    log(address.street ? `Filmed ${address.street}` : "Screenshot captured");
    return {
      screenshot: shotPath,
      pageUrl: page.url(),
      address,
      checked,
      tally,
      notes: notes || [],
      tookSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
  };

  /**
   * Get one house off a site that opens on its own IDX search.
   *
   * homes.dukecitysunrise.com bounces its homepage onto /idx/search, which is a
   * form, not a listing. Its listings are still there, so this walks the site's
   * own way to them and opens exactly ONE - the thing IDX counts - rather than
   * refusing on the spot or wandering through results.
   *
   * Map Search is tried first, because that is the control on the page. On IDX
   * the map is an Azure/Leaflet canvas that reports "Found 0 of 0" to a headless
   * browser however long it is given, with or without WebGL, so their plain
   * results list is tried after it. Both are one page load each.
   *
   * No account is created, no form is filled in, and nothing that could register
   * anybody is clicked.
   */
  const filmOneFromIdxSearch = async (searchUrl) => {
    log("Their site opens on its own property search - looking for one of their listings");

    const routes = [];
    const mapHref = await page
      .evaluate(() => {
        const control = Array.from(document.querySelectorAll("a[href]")).find((el) =>
          /map\s*search/i.test(`${el.innerText || ""} ${el.getAttribute("href") || ""}`)
        );
        return control ? new URL(control.getAttribute("href"), location.href).toString() : "";
      })
      .catch(() => "");
    if (mapHref) routes.push({ label: "their Map Search", url: mapHref });
    for (const path of IDX_RESULT_PATHS) {
      routes.push({ label: `their listings list (${path})`, url: new URL(path, origin).toString() });
    }

    for (const route of routes) {
      if (outOfTime()) break;
      log(`Opening ${route.label} (${secondsLeft()}s left)`);

      let status;
      try {
        status = await visit(route.url);
      } catch (_) {
        continue;
      }
      if (!status || status >= 400) {
        if (status === 401 || status === 403 || status === 429 || status === 451) blockedFromSearch += 1;
        continue;
      }

      // Their cards are drawn after load, so give the pins and cards a moment.
      await waitForListingHrefs(page, Math.min(8000, Math.max(0, deadline - Date.now())));

      const links = (await collectListingLinks(page, origin))
        .filter((entry) => looksLikeSingleListingUrl(entry.href))
        .sort((a, b) => b.score - a.score);
      if (!links.length) {
        log(`No listings could be reached from ${route.label}`);
        continue;
      }

      // One listing. This is the counter that puts the account wall up, so there
      // is no trying a second if the first turns out to be no good.
      const target = links[0].href;
      log(`Opening one listing: ${new URL(target).pathname}`);
      let listingStatus;
      try {
        listingStatus = await visit(target, { heavy: true });
      } catch (_) {
        listingStatus = 0;
      }
      if (listingStatus >= 400) throw statusError(listingStatus);
      if (!listingStatus) {
        throw captureError(
          "LISTING_URL_UNREACHABLE",
          "The listing on their search would not open. Try again, or paste one listing URL."
        );
      }

      const verdict = await assess(target);
      if (verdict.reason === "wall") throw registrationWallError();
      if (verdict.ok) return await shoot(target, verdict.verdict, verdict.preferred ? [] : fallbackNote);
      if (verdict.reason === "blocked") throw blockedError(verdict.left);
      if (verdict.reason === "explorer") throw captureError("LISTING_HAS_EXPLORER", EXPLORER_ALREADY_THERE);
      throw captureError(
        "LISTING_NOT_USABLE",
        `The one listing opened from their search cannot be filmed as it is (${
          (verdict.verdict.reasons || []).join("; ") || verdict.reason
        }). Paste one listing URL instead.`
      );
    }

    if (blockedFromSearch > 0) {
      throw captureError(
        "SITE_BLOCKED",
        `${new URL(home).hostname} blocked the capture (HTTP 403) on the pages that hold its listings. Some sites refuse automated browsers even though the pages open fine in your own. Open one of their listings in your browser and paste that URL.`
      );
    }
    /*
     * Go back to the search page before giving up, so the picture kept with the
     * failure is the page being refused rather than the last path that was tried
     * on the way. Best effort: if it will not load, the refusal stands anyway.
     */
    if (!sameTarget(loadedUrl, searchUrl) && !outOfTime()) {
      await visit(searchUrl).catch(() => 0);
    }
    throw searchOnlyError(
      searchUrl,
      `${new URL(home).hostname} opens on its property search (${new URL(searchUrl).pathname}), and no single listing could be reached from it - its map and results came back empty. A search or map page is never filmed. Open one of their listings in your own browser and paste that URL - the page for a single house, with its street address, price, beds and baths.`
    );
  };

  try {
    /* ---- the page we were pointed at ---- */
    const startedOnListingUrl = Boolean(listingUrl);
    log(startedOnListingUrl ? `Opening the listing page you gave me` : `Opening ${new URL(home).hostname}`);
    /*
     * A pasted listing is loaded with its photos straight away.
     *
     * Blocking images pays for itself while crawling a site, but there is no
     * crawl when we have been handed the page: loading it lean and then loading
     * it again for the shutter costs a second listing view on sites that count
     * them, and it is the repeat hit that Andy Harris's IDX answered with a 403.
     */
    const startHeavy = Boolean(listingUrl) && looksLikeSingleListingUrl(start);
    let startStatus;
    try {
      startStatus = await visit(start, { heavy: startHeavy });
    } catch (error) {
      throw captureError(
        startedOnListingUrl ? "LISTING_URL_UNREACHABLE" : "SITE_UNREACHABLE",
        startedOnListingUrl
          ? `That listing page would not open (${error.message}). Check the address and try again.`
          : `Their website would not open (${error.message}). Check the address, or paste one listing URL by hand and try again.`
      );
    }
    if (startStatus >= 400) {
      throw statusError(startStatus, { pastedListing: startedOnListingUrl });
    }

    const fallbackNote = [
      "This listing does not have School Explorer on it yet, so the opening shot shows School Explorer added to it.",
    ];

    const startUrl = page.url();

    /*
     * Whether we were handed one property. Judged on the URL we landed on, so a
     * pasted listing that redirects to itself still counts and a pasted homepage
     * that bounces onto a search page does not.
     */
    const pastedOneListing =
      startedOnListingUrl && (looksLikeSingleListingUrl(start) || looksLikeSingleListingUrl(startUrl));

    /*
     * A site that opens on its own IDX search still has listings behind it, so
     * one of them is fetched by hand rather than refusing on the spot.
     */
    if (!pastedOneListing && looksLikeIdxSearchUrl(startUrl) && !looksLikeSingleListingUrl(startUrl)) {
      return await filmOneFromIdxSearch(startUrl);
    }

    const first = await assess(startUrl);
    if (first.reason === "wall") throw registrationWallError();

    // The first usable listing is the one we film. There is no looking around
    // for a better one, because that would mean opening a second listing.
    if (first.ok) {
      log("That page is a single listing - using it");
      return await shoot(startUrl, first.verdict, first.preferred ? [] : fallbackNote);
    }

    // A pasted listing with our own embed on it is a dead end. An embed on a
    // pasted search page is neither here nor there, so that case falls through
    // to the crawl below.
    if (startedOnListingUrl && first.reason === "explorer") {
      throw captureError(
        "LISTING_HAS_EXPLORER",
        EXPLORER_ALREADY_THERE
      );
    }
    if (startedOnListingUrl && first.reason === "blocked") {
      throw blockedError(first.left);
    }

    /*
     * A pasted URL shaped like one property is taken at its word.
     *
     * Bill pasted /idx/details/listing/b001/114051774 and was told to paste a
     * listing URL. An IDX detail page carries a neighbourhood map and the site's
     * own search box in its header, and that furniture is not grounds for
     * overruling somebody who has told us exactly which house they mean. The
     * page still has to be free of an account wall, of our own Explorer and of
     * overlays, all checked above.
     */
    if (pastedOneListing) {
      // Still never film through a cookie bar, whatever the page was classified as.
      if (first.left && first.left.length) throw blockedError(first.left);
      if (first.explorer && first.explorer.found && !wantExplorer) {
        throw captureError(
          "LISTING_HAS_EXPLORER",
          EXPLORER_ALREADY_THERE
        );
      }
      log("That URL is one property, so it is being filmed as it is");
      return await shoot(startUrl, first.verdict, first.preferred ? [] : fallbackNote);
    }

    // A pasted URL that was a listing but is unusable stops here: opening
    // another listing is exactly what trips the account wall.
    if (listingViews >= MAX_LISTING_VIEWS) {
      throw captureError(
        "LISTING_NOT_USABLE",
        `That page is a listing, but it cannot be filmed as it is (${(first.verdict.reasons || []).join("; ") || first.reason}). Paste a different listing URL.`
      );
    }
    if (startedOnListingUrl) {
      log(`That URL is ${first.reason === "search" ? "a search page" : "not a listing detail page"} - looking for one of their listings from there`);
    }

    /* ---- follow links into an actual listing ---- */
    log(`Looking for one of their listing pages (${secondsLeft()}s left to find one)`);
    /*
     * One key per page, so the same page reached by two slightly different links
     * is opened once. Without this the crawl spent three of its visits on the
     * same /idx/mortgage page.
     */
    const keyFor = (href) => {
      try {
        const parsed = new URL(href);
        return `${parsed.host}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`.toLowerCase();
      } catch (_) {
        return String(href).toLowerCase();
      }
    };
    const tried = new Set([keyFor(start), keyFor(startUrl)]);
    const queue = [];
    /* Pages the site refused outright, which is a different story to not finding one. */
    let blockedPages = 0;
    let visits = 0;

    /**
     * Add links found on the page we are on. Their listings are usually two
     * clicks away - homepage, then a listings page, then the house - so pages
     * that are not listings themselves still get harvested for links. Missing
     * that second hop is what left capture stuck on the homepage.
     */
    /** IDX cards are often drawn after load, so give them a moment to appear. */
    const waitForCards = async (ms) => {
      if (outOfTime()) return;
      try {
        await page.waitForFunction(
          () =>
            Array.from(document.querySelectorAll("a[href]")).some((anchor) =>
              /(listing|property|home-detail|homedetail|\/homes?\/|\/p\/|\/l\/|mls)/i.test(anchor.getAttribute("href") || "")
            ),
          { timeout: Math.min(ms, Math.max(0, deadline - Date.now())), polling: 250 }
        );
      } catch (_) {
        /* no cards turned up; carry on with whatever links there are */
      }
    };

    const harvest = async (depth) => {
      if (depth > MAX_CRAWL_DEPTH) return;
      await waitForCards(2500);
      const found = await collectListingLinks(page, origin);
      for (const entry of found) {
        if (tried.has(keyFor(entry.href)) || queue.some((queued) => keyFor(queued.href) === keyFor(entry.href))) continue;
        queue.push({ ...entry, depth });
      }
      // Best-looking link first: a concrete listing URL with a price and beds
      // on its card beats a link to another index.
      queue.sort((a, b) => b.score - a.score || a.depth - b.depth);
    };

    await harvest(1);

    const drain = async () => {
      while (queue.length && visits < MAX_CANDIDATE_OPENS && !outOfTime()) {
        // One listing view, so once a listing has been opened there is no
        // second one, whatever came of the first.
        if (listingViews >= MAX_LISTING_VIEWS) return null;

        const candidate = queue.shift();
        if (tried.has(keyFor(candidate.href))) continue;
        tried.add(keyFor(candidate.href));
        visits += 1;
        // Keep the progress list moving: a long wait must never look silent.
        log(`Checking ${new URL(candidate.href).pathname || "/"} (${secondsLeft()}s left)`);
        let status;
        try {
          status = await visit(candidate.href);
        } catch (_) {
          continue;
        }
        if (!status || status >= 400) {
          if (status === 401 || status === 403 || status === 429 || status === 451) {
            blockedPages += 1;
            log(`Their site blocked that page (HTTP ${status})`);
          }
          continue;
        }

        const verdict = await assess(candidate.href);
        if (verdict.reason === "wall") return { wall: true };
        if (verdict.ok) return { ...verdict, url: candidate.href };
        // That was a listing, just not one we can use. Stop rather than open
        // another: this is the counter that puts the account wall up.
        if (verdict.verdict.kind === "detail") {
          return { spent: true, verdict: verdict.verdict, reason: verdict.reason, left: verdict.left };
        }
        // Not a listing, but a listings page links to them.
        await harvest(candidate.depth + 1);
      }
      return null;
    };

    /** Turn whatever drain stopped on into either a shot or a refusal. */
    const settleWith = async (found) => {
      if (!found) return null;
      if (found.wall) throw registrationWallError();
      if (found.spent) {
        if (found.reason === "explorer") {
          throw captureError(
            "ALL_LISTINGS_HAVE_EXPLORER",
            "The listing found on their site already has School Explorer or Neighborhood Explorer on it, so there is no \u201cbefore\u201d page to film. Paste a listing URL that does not have it yet."
          );
        }
        if (found.reason === "blocked") throw blockedError(found.left || []);
        throw captureError(
          "LISTING_NOT_USABLE",
          "The one listing found on their site cannot be filmed as it is. Paste a listing URL."
        );
      }
      log("Found a listing page with nothing in the way");
      return shoot(found.url, found.verdict, found.preferred ? [] : fallbackNote);
    };

    const shotFromQueue = await settleWith(await drain());
    if (shotFromQueue) return shotFromQueue;

    // Their listings are often only reachable through a listings or search page.
    // Opening one of those is navigation, not a listing view, so it has its own
    // small budget - otherwise the cards on it could never be followed.
    let navVisits = 0;
    for (const indexPath of LISTING_INDEX_PATHS) {
      if (outOfTime() || navVisits >= MAX_NAV_VISITS) break;
      if (listingViews >= MAX_LISTING_VIEWS) break;
      const indexUrl = new URL(indexPath, origin).toString();
      if (tried.has(keyFor(indexUrl))) continue;
      tried.add(keyFor(indexUrl));
      navVisits += 1;
      log(`Trying ${indexPath} (${secondsLeft()}s left)`);
      let indexStatus;
      try {
        indexStatus = await visit(indexUrl);
      } catch (_) {
        continue;
      }
      // A site without /listings just 404s; that is not a page we "checked".
      if (!indexStatus || indexStatus >= 400) continue;
      const here = await assess(indexUrl);
      if (here.reason === "wall") throw registrationWallError();
      if (here.ok) {
        log("Found a listing page with nothing in the way");
        return await shoot(indexUrl, here.verdict, here.preferred ? [] : fallbackNote);
      }
      await harvest(2);
      const shotFromIndex = await settleWith(await drain());
      if (shotFromIndex) return shotFromIndex;
    }

    /* ---- nothing usable: say exactly what was wrong ---- */
    const host = new URL(home).hostname;
    if (tally.wall) throw registrationWallError();
    // Every page it tried was refused outright. That is the site turning an
    // automated browser away, not a site without any listings on it.
    if (blockedPages > 0 && !tally.detail) {
      throw captureError(
        "SITE_BLOCKED",
        `${host} blocked the capture on ${blockedPages} page${
          blockedPages === 1 ? "" : "s"
        } (HTTP 403), so none of them could be read. Some sites refuse automated browsers even though the pages open fine in your own. Open one of their listings in your browser and paste that URL.`
      );
    }
    if (outOfTime()) {
      log("Could not find a listing in time");
      throw captureError(
        "CAPTURE_TIMED_OUT",
        `Their site took longer than ${Math.round(budgetMs / 1000)} seconds to search, so nothing was rendered. ${
          checked.length
        } page${checked.length === 1 ? "" : "s"} were checked and none was a single listing. Paste one listing URL and it will go straight there.`
      );
    }
    if (!wantExplorer && tally.withExplorer > 0 && tally.detail === tally.withExplorer) {
      throw captureError(
        "ALL_LISTINGS_HAVE_EXPLORER",
        `Every listing found on ${host} (${tally.withExplorer}) already has School Explorer or Neighborhood Explorer on it, so there is no \u201cbefore\u201d page to film. Paste a listing URL that does not have it yet, or pick a different customer.`
      );
    }
    if (wantExplorer) {
      throw captureError(
        "NO_LISTING_FOUND",
        `No listing page could be found on ${host} (${checked.length} pages checked), with or without School Explorer on it. This script is the upgrade pitch, so paste one of their listings - ideally one that already has School Explorer on it.`
      );
    }
    if (tally.blocked > 0) {
      const cookies = checked.filter((entry) => entry.cookieBlocked).length;
      throw captureError(
        cookies ? "COOKIE_BANNER_IN_THE_WAY" : "OVERLAY_IN_THE_WAY",
        `${tally.blocked} listing page${tally.blocked === 1 ? "" : "s"} on ${host} kept ${
          cookies ? "a cookie banner" : "a popup"
        } over the page that would not close, so filming one would show that instead of the house. Paste a listing URL to try a specific one.`
      );
    }

    log("Could not find a listing on their site");
    const notListings = [];
    if (tally.marketing) notListings.push(`${tally.marketing} homepage or landing page${tally.marketing === 1 ? "" : "s"}`);
    if (tally.search) notListings.push(`${tally.search} search or map page${tally.search === 1 ? "" : "s"}`);
    if (tally.index) notListings.push(`${tally.index} listings index${tally.index === 1 ? "" : "es"}`);
    if (tally.other) notListings.push(`${tally.other} other page${tally.other === 1 ? "" : "s"}`);

    throw captureError(
      "NO_LISTING_FOUND",
      `No single listing page could be found on ${host}. ${checked.length} page${checked.length === 1 ? "" : "s"} were checked${
        notListings.length ? ` and they were ${notListings.join(", ")}` : ""
      }. Nothing was rendered: a homepage, a city landing page, a market report and a search page are never used as a stand-in. Paste one listing URL - the page for a single house, with its street address, price, beds, baths and photos of that house.`
    );
  } catch (error) {
    // A refusal should carry what was looked at, so the job log and anyone
    // debugging can see how it got there.
    error.checked = checked;
    error.tally = tally;

    /*
     * Photograph whatever Chrome was actually looking at.
     *
     * "No single listing page could be found" is not much to go on. The picture
     * of the search page, the account wall or the 403 is the thing that says why,
     * and it cannot be got afterwards - by the time anybody reads the error the
     * browser is closed.
     */
    // Only a refusal that really was about a status has one. The last page to
    // load might have been a 404 on a guessed path, which caused nothing.
    if (error.httpStatus == null) error.httpStatus = null;
    error.pageUrl = error.pageUrl || loadedUrl || "";
    const last = checked.length ? checked[checked.length - 1] : null;
    if (!error.pageKind) error.pageKind = last ? last.kind : "";
    if (page) {
      const shot = path.join(outDir, "failure.png");
      try {
        /*
         * Bounded, and the page is stopped first.
         *
         * A screenshot of a page that is still loading can sit there until the
         * protocol times out - thirty seconds, on a capture that had a four
         * second budget. A picture is worth having, but never at the cost of the
         * budget the whole thing exists to keep.
         */
        await page.evaluate(() => window.stop()).catch(() => {});
        await Promise.race([
          page.screenshot({ path: shot, type: "png", captureBeyondViewport: false }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("screenshot took too long")), FAILURE_SHOT_TIMEOUT_MS)
          ),
        ]);
        error.screenshot = shot;
        log("Saved a picture of the page it stopped on");
      } catch (_) {
        /* a crashed, closed or still-loading page cannot be photographed */
      }
    }
    throw error;
  } finally {
    await closePage(page);
  }
}

module.exports = {
  captureListing,
  normalizeUrl,
  detectExplorer,
  // Exposed so a page can be inspected on its own while working out why a real
  // site was read the way it was.
  collectPageFacts,
  CAPTURE_BUDGET_MS,
  MAX_LISTING_VIEWS,
  MAX_NAV_VISITS,
  JUNK_HOSTS,
  HEAVY_RESOURCE_TYPES,
  DISMISS_LABELS,
  OVERLAY_SELECTORS,
  OVERLAY_TEXT,
};
