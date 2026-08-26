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
const { classifyPage, extractAddress } = require("./page-analysis");

const LISTING_HREF_HINTS =
  /(listing|listings|property|properties|homes?-for-sale|for-sale|home-details|homedetail|idx|mls|\/p\/|\/home\/|\/l\/|realestate|real-estate)/i;

const NON_LISTING_HREF =
  /(blog|about|contact|privacy|terms|careers|team|agents?\/|login|signin|sign-in|register|\.pdf$|mailto:|tel:)/i;

// Links that lead to another search rather than to a house.
const SEARCH_HREF =
  /(\/search|\/results|\/map\b|advanced-?search|property-?search|\/browse\b|[?&](q|query|search|keyword|sort|minprice|maxprice)=)/i;

// Pages that usually hold a grid of live listings, tried when the entry page
// does not link to any.
const LISTING_INDEX_PATHS = [
  "/listings",
  "/properties",
  "/homes-for-sale",
  "/featured-listings",
  "/our-listings",
  "/property-search",
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

/** Wording that gives an overlay away even when its markup does not. */
const OVERLAY_TEXT =
  /(microphone access|microphone is blocked|allow microphone|voice command|voice search|available voice commands|speech recognition|we use cookies|this site uses cookies|accept cookies|cookie policy|your privacy choices|subscribe to our newsletter|sign up for our newsletter|join our mailing list|enable notifications)/i;

const DISMISS_LABELS =
  /^(accept|accept all|accept all cookies|accept cookies|allow all|i agree|agree|understood|got it|ok|okay|continue|close|dismiss|no thanks|no, thanks|not now|maybe later|later|reject all|reject|decline|deny|skip|skip for now|x|\u00d7|\u2715)$/i;

const MAX_CANDIDATE_VISITS = 10;
const OVERALL_BUDGET_MS = 240000;
const VIEWPORT = { width: 1920, height: 1080 };

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
    // Marked with an expando, not an attribute. An earlier version used
    // data-dn-hidden, which the Explorer check then read as a Dream
    // Neighborhood widget on every page we had cleaned.
    if (el.__lvmHidden) return;
    el.style.setProperty("display", "none", "important");
    el.__lvmHidden = true;
    hidden += 1;
  };

  const visible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return Number(style.opacity || 1) > 0.05;
  };

  // 1. Click the obvious "go away" controls.
  const clickable = document.querySelectorAll(
    "button, a, [role=button], input[type=button], input[type=submit], [aria-label]"
  );
  for (const el of Array.from(clickable)) {
    const label = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim();
    if (!label || label.length > 30) continue;
    if (!dismissLabel.test(label)) continue;
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
  for (const el of Array.from(document.querySelectorAll("body *"))) {
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

  // 4. Fixed things over the middle, or over the bottom where our button goes.
  const centre = { left: vw * 0.18, right: vw * 0.82, top: vh * 0.22, bottom: vh * 0.82 };
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (!visible(el)) continue;
    const style = window.getComputedStyle(el);
    if (style.position !== "fixed") continue;
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
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const style = window.getComputedStyle(el);
    if (style.position !== "fixed") continue;
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

async function clearOverlays(page) {
  let hidden = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      hidden += await page.evaluate(dismissPass, OVERLAY_SELECTORS, OVERLAY_TEXT.source, DISMISS_LABELS.source);
    } catch (_) {
      /* a page that will not run our script is still worth checking */
    }
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(300);
  }
  return hidden;
}

async function blockers(page) {
  try {
    return await page.evaluate(findBlockers);
  } catch (_) {
    return [];
  }
}

/* ---------------------------------------------------------------- */
/* what is on this page                                             */
/* ---------------------------------------------------------------- */

/* eslint-disable no-undef */
function readPageFacts() {
  const text = (document.body.innerText || "").replace(/\s+/g, " ");
  const attr = (selector, name) => {
    const el = document.querySelector(selector);
    return el ? (el.getAttribute(name) || "").trim() : "";
  };

  const prices = new Set((text.match(/\$\s?\d{2,3}(?:,\d{3})+/g) || []).map((price) => price.replace(/\s/g, "")));

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
  for (const img of Array.from(document.querySelectorAll("img"))) {
    const rect = img.getBoundingClientRect();
    if (rect.width >= 180 && rect.height >= 120) galleryImages += 1;
  }

  const mls = text.match(/\bMLS\s*#?\s*:?\s*([A-Z0-9-]{5,})/i);

  const microNode = document.querySelector('[itemtype*="PostalAddress"], [itemprop="address"]');
  const micro = {};
  if (microNode) {
    for (const key of ["streetAddress", "addressLocality", "addressRegion", "postalCode"]) {
      const el = microNode.querySelector(`[itemprop="${key}"]`) || document.querySelector(`[itemprop="${key}"]`);
      if (el) micro[key] = (el.getAttribute("content") || el.textContent || "").trim();
    }
  }

  return {
    url: location.href,
    title: document.title || "",
    ogTitle: attr('meta[property="og:title"]', "content"),
    h1s: Array.from(document.querySelectorAll("h1, h2"))
      .slice(0, 6)
      .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .slice(0, 12)
      .map((el) => (el.textContent || "").slice(0, 60000)),
    microdata: micro,
    bodyText: text.slice(0, 30000),
    priceCount: prices.size,
    listingLinkCount: listingLinks,
    addressCount: (text.match(/\b\d{2,6}\s+[A-Z][A-Za-z]+\s+(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Ct|Court|Way|Pl|Place)\b/g) || [])
      .length,
    mapAreaFraction: mapArea,
    searchInputCount: searchInputs,
    galleryImageCount: galleryImages,
    hasBeds: /\b\d+(\.\d)?\s*(bed|beds|bedroom|bedrooms|bd|bds|br)\b/i.test(text),
    hasBaths: /\b\d+(\.\d)?\s*(bath|baths|bathroom|bathrooms|ba)\b/i.test(text),
    hasSqft: /\b[\d,]{3,}\s*(sq\.?\s?ft|sqft|square feet)\b/i.test(text),
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
          if (new URL(href).origin !== originValue) continue;
          if (block.test(href)) continue;
          if (seen.has(href)) continue;
          seen.add(href);

          const label = (anchor.innerText || "").replace(/\s+/g, " ").trim();
          let score = 0;
          if (hint.test(href)) score += 3;
          if (/\/\d{4,}/.test(href) || /-\d{5,}/.test(href)) score += 2;
          if (/\$\s?\d/.test(label)) score += 3;
          if (/\b\d+\s*(bd|bed|beds)\b/i.test(label)) score += 2;
          if (/^\d{1,6}\s+[A-Z]/.test(label)) score += 3;
          if (anchor.querySelector("img")) score += 1;
          // Another search page is not what we are looking for.
          if (search.test(href)) score -= 6;
          if (score > 0) out.push({ href, score, label: label.slice(0, 120) });
        }
        return out.sort((a, b) => b.score - a.score).slice(0, 24);
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

async function settle(page) {
  try {
    await page.evaluate(async () => {
      // Nudge lazy images into loading, then come back to the top for the shot.
      window.scrollTo(0, 900);
      await new Promise((r) => setTimeout(r, 500));
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 350));
    });
  } catch (_) {
    /* ignore */
  }
  try {
    await page.evaluate(() => document.fonts && document.fonts.ready);
  } catch (_) {
    /* ignore */
  }
  await sleep(600);
}

/**
 * Load a page and get it presentable: overlays gone, lazy images in, scrolled
 * back to the top. Overlays are cleared twice because plenty of them only
 * appear a second or two after load.
 */
async function open(page, url, timeout) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  const status = response ? response.status() : 0;
  // No point cleaning up a 404; the caller skips it.
  if (status >= 400) return status;
  await page.waitForNetworkIdle({ idleTime: 700, timeout: 12000 }).catch(() => {});
  await clearOverlays(page);
  await settle(page);
  await clearOverlays(page);
  return status;
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
async function captureListing({ browser, url, listingUrl, outDir, log, explorerRule = "absent" }) {
  const wantExplorer = explorerRule === "prefer-present";
  const home = normalizeUrl(url);
  const origin = new URL(home).origin;
  const start = listingUrl ? normalizeUrl(listingUrl) : home;
  const deadline = Date.now() + OVERALL_BUDGET_MS;
  const outOfTime = () => Date.now() > deadline;

  const page = await browser.newPage();
  await silenceMediaFeatures(page);
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );
  await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 });

  const checked = [];
  const tally = { detail: 0, search: 0, index: 0, other: 0, withExplorer: 0, blocked: 0 };

  /**
   * Is the page we are on right now the one to film? Records why not, either
   * way. "preferred" means it is exactly what this template wants; "ok" without
   * "preferred" means it will do if nothing better turns up.
   */
  const assess = async (pageUrl) => {
    const facts = await collectPageFacts(page);
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

    if (verdict.kind !== "detail") {
      log(`Skipped ${verdict.kind === "search" ? "a search page" : "a page that is not a listing"}: ${note.why[0] || verdict.kind}`);
      return { ok: false, reason: verdict.kind, verdict, explorer, left };
    }
    if (explorer.found && !wantExplorer) {
      log("That listing already shows an Explorer - looking for another one");
      return { ok: false, reason: "explorer", verdict, explorer, left };
    }
    if (left.length) {
      tally.blocked += 1;
      log(`Something is still covering that page (${left[0].text || left[0].cls || left[0].tag}) - looking for another one`);
      return { ok: false, reason: "blocked", verdict, explorer, left };
    }

    if (wantExplorer && !explorer.found) {
      log("That listing does not have School Explorer on it yet - holding it in reserve and looking for one that does");
      return { ok: true, preferred: false, verdict, explorer, left, facts };
    }
    if (wantExplorer) log("That listing already has School Explorer on it - that is the one we want");
    return { ok: true, preferred: true, verdict, explorer, left, facts };
  };

  const shoot = async (verdict, notes) => {
    // Last look: nothing floating over the page at the moment of the shot.
    const left = await blockers(page);
    if (left.length) {
      await clearOverlays(page);
      const stillThere = await blockers(page);
      if (stillThere.length) {
        throw captureError(
          "OVERLAY_IN_THE_WAY",
          `Something on that page keeps covering it up (${stillThere[0].text || stillThere[0].cls || stillThere[0].tag}), so the screenshot would show a popup instead of the listing. Try a different listing URL.`
        );
      }
    }

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
    };
  };

  try {
    /* ---- the page we were pointed at ---- */
    const startedOnListingUrl = Boolean(listingUrl);
    log(startedOnListingUrl ? `Opening the listing page you gave me` : `Opening ${new URL(home).hostname}`);
    let startStatus;
    try {
      startStatus = await open(page, start, 45000);
    } catch (error) {
      throw captureError(
        startedOnListingUrl ? "LISTING_URL_UNREACHABLE" : "SITE_UNREACHABLE",
        startedOnListingUrl
          ? `That listing page would not open (${error.message}). Check the address and try again.`
          : `Their website would not open (${error.message}). Check the address, or paste one listing URL by hand and try again.`
      );
    }
    if (startStatus >= 400) {
      throw captureError(
        startedOnListingUrl ? "LISTING_URL_UNREACHABLE" : "SITE_UNREACHABLE",
        `That address came back as ${startStatus}, so there is no page there. Check it and try again.`
      );
    }

    // A listing that will do, kept in case nothing better turns up. Only ever
    // set for the upgrade rule, where the ideal page already has School
    // Explorer on it.
    let reserve = null;
    const fallbackNote = [
      "This listing does not have School Explorer on it yet, so the opening shot shows School Explorer added to it.",
    ];

    const first = await assess(page.url());
    if (first.ok && (first.preferred || startedOnListingUrl)) {
      log("That page is a single listing - using it");
      return await shoot(first.verdict, first.preferred ? [] : fallbackNote);
    }
    if (first.ok) reserve = { url: page.url(), verdict: first.verdict };

    // A pasted listing with our own embed on it is a dead end. An embed on a
    // pasted search page is neither here nor there, so that case falls through
    // to the crawl below.
    if (startedOnListingUrl && first.reason === "explorer") {
      throw captureError(
        "LISTING_HAS_EXPLORER",
        "That page already has a Dream Neighborhood Explorer embedded on it, so it cannot be the \u201cbefore\u201d shot. Pick one of their listings that does not have it yet."
      );
    }
    if (startedOnListingUrl && first.reason === "blocked") {
      throw captureError(
        "OVERLAY_IN_THE_WAY",
        `Something on that page keeps covering it up (${first.left[0].text || first.left[0].cls || first.left[0].tag}), so the screenshot would show a popup instead of the listing. Try a different listing URL.`
      );
    }
    if (startedOnListingUrl) {
      log(`That URL is ${first.reason === "search" ? "a search page" : "not a listing detail page"} - looking for a real listing from there`);
    }

    /* ---- follow links into an actual listing ---- */
    log("Looking for one of their listing pages");
    const queue = await collectListingLinks(page, origin);
    const tried = new Set([start, page.url()]);
    let visits = 0;

    const drain = async () => {
      while (queue.length && visits < MAX_CANDIDATE_VISITS && !outOfTime()) {
        const candidate = queue.shift();
        if (tried.has(candidate.href)) continue;
        tried.add(candidate.href);
        visits += 1;
        let status;
        try {
          status = await open(page, candidate.href, 35000);
        } catch (_) {
          continue;
        }
        if (status >= 400) continue;
        const verdict = await assess(candidate.href);
        if (verdict.ok && verdict.preferred) return verdict;
        if (verdict.ok && !reserve) reserve = { url: candidate.href, verdict: verdict.verdict };
      }
      return null;
    };

    let found = await drain();
    if (found) {
      log("Found a listing page with nothing in the way");
      return await shoot(found.verdict);
    }

    // Their listings are probably one click deeper than the entry page.
    for (const indexPath of LISTING_INDEX_PATHS) {
      if (outOfTime() || visits >= MAX_CANDIDATE_VISITS) break;
      const indexUrl = new URL(indexPath, origin).toString();
      if (tried.has(indexUrl)) continue;
      tried.add(indexUrl);
      let indexStatus;
      try {
        indexStatus = await open(page, indexUrl, 30000);
      } catch (_) {
        continue;
      }
      // A site without /listings just 404s; that is not a page we "checked".
      if (indexStatus >= 400) continue;
      log(`Checking ${indexPath}`);
      const here = await assess(indexUrl);
      if (here.ok && here.preferred) {
        log("Found a listing page with nothing in the way");
        return await shoot(here.verdict);
      }
      if (here.ok && !reserve) reserve = { url: indexUrl, verdict: here.verdict };
      const more = await collectListingLinks(page, origin);
      queue.push(...more.filter((entry) => !tried.has(entry.href)));
      found = await drain();
      if (found) {
        log("Found a listing page with nothing in the way");
        return await shoot(found.verdict);
      }
    }

    /* ---- no ideal page, but one we can work with ---- */
    if (reserve) {
      log("No listing with School Explorer already on it - using the best listing found and adding School Explorer to it");
      const status = await open(page, reserve.url, 35000).catch(() => 0);
      if (status && status < 400) {
        const again = await assess(reserve.url);
        if (again.ok) return await shoot(again.verdict, fallbackNote);
      }
    }

    /* ---- nothing usable: say exactly what was wrong ---- */
    const host = new URL(home).hostname;
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
      throw captureError(
        "OVERLAY_IN_THE_WAY",
        `${tally.blocked} listing page${tally.blocked === 1 ? "" : "s"} on ${host} kept a popup over the page that would not close, so filming one would show the popup instead of the house. Paste a listing URL to try a specific one.`
      );
    }

    const searchOnly = tally.search + tally.index;
    throw captureError(
      "NO_LISTING_FOUND",
      searchOnly > 0
        ? `${checked.length} pages on ${host} were checked and ${searchOnly} of them were search or index pages rather than a single listing. A search page and a map are not used as a stand-in. Paste one listing URL - the page with one address, beds and baths, and photos.`
        : `No listing page could be found on ${host} (${checked.length} pages checked). Nothing was sent. Paste one listing URL by hand and try again - the homepage is not used as a stand-in.`
    );
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  captureListing,
  normalizeUrl,
  detectExplorer,
  OVERLAY_SELECTORS,
  OVERLAY_TEXT,
};
