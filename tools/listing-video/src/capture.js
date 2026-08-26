"use strict";

/**
 * Opens the customer's website and screenshots a live listing page.
 *
 * The whole point of the video is "here is your own listing, with School
 * Explorer added". So this module will not quietly settle for a homepage: if it
 * cannot find a live listing, or every listing it finds already has School
 * Explorer or Neighborhood Explorer on it, it refuses and says why. Whoever is
 * making the video can then retry, or paste one listing URL by hand.
 */

const path = require("path");

const STREET_TYPES =
  "St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court|Cir|Circle|Way|Pl|Place|Ter|Terrace|Trl|Trail|Pkwy|Parkway|Hwy|Highway|Loop|Run|Row|Path|Commons|Crossing|Xing";

const ADDRESS_RE = new RegExp(
  `\\b\\d{1,6}\\s+(?:[A-Z0-9][A-Za-z0-9.'\\u2019-]*\\s+){0,4}(?:${STREET_TYPES})\\b(?:\\s+(?:NE|NW|SE|SW|N|S|E|W))?`,
  "g"
);

const CITY_STATE_RE = /\b([A-Z][A-Za-z.'\u2019-]+(?:\s+[A-Z][A-Za-z.'\u2019-]+){0,3}),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/;

const LISTING_HREF_HINTS =
  /(listing|listings|property|properties|homes?-for-sale|for-sale|home-details|homedetail|idx|mls|\/p\/|\/home\/|\/l\/|realestate|real-estate)/i;

const NON_LISTING_HREF = /(blog|about|contact|privacy|terms|careers|team|agents?\/|login|signin|sign-in|register|search\?|\.pdf$|mailto:|tel:)/i;

// Pages that usually hold a grid of live listings, tried when the homepage
// itself does not link to any.
const LISTING_INDEX_PATHS = [
  "/listings",
  "/properties",
  "/homes-for-sale",
  "/featured-listings",
  "/our-listings",
  "/property-search",
];

const MAX_CANDIDATE_VISITS = 8;
const OVERALL_BUDGET_MS = 210000;

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

async function dismissOverlays(page) {
  try {
    await page.evaluate(() => {
      const accept = /^(accept|accept all|allow all|i agree|agree|got it|ok|okay|continue|close|dismiss)$/i;
      const clickable = Array.from(
        document.querySelectorAll("button, a, [role=button], input[type=button], input[type=submit]")
      );
      for (const el of clickable) {
        const label = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim();
        if (accept.test(label)) {
          try {
            el.click();
          } catch (_) {
            /* ignore */
          }
        }
      }
      // Full-screen overlays that survive the click pass get pulled out of the way.
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const style = window.getComputedStyle(el);
        if (style.position !== "fixed" || style.display === "none") continue;
        const rect = el.getBoundingClientRect();
        const coversScreen = rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.7;
        if (coversScreen && Number(style.zIndex || 0) > 100) el.style.display = "none";
      }
    });
  } catch (_) {
    /* a page that will not run our script is still capturable */
  }
}

async function findAddress(page) {
  try {
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 20000));
    const street = text.match(ADDRESS_RE);
    const cityState = text.match(CITY_STATE_RE);
    return {
      street: street ? street[0].trim() : "",
      cityState: cityState ? `${cityState[1]}, ${cityState[2]}` : "",
      zip: cityState ? cityState[3] : "",
    };
  } catch (_) {
    return { street: "", cityState: "", zip: "" };
  }
}

async function looksLikeListing(page) {
  try {
    return await page.evaluate(() => {
      const text = document.body.innerText;
      const hasPrice = /\$\s?\d{2,3}[,.]\d{3}/.test(text);
      const hasSpecs = /\b(bed|beds|bedroom|bath|baths|bathroom|sq\s?ft|square feet)\b/i.test(text);
      const hasMls = /\bMLS\s*#?\s*[:\s]?\s*[A-Z0-9-]{5,}/i.test(text);
      return hasPrice && (hasSpecs || hasMls);
    });
  } catch (_) {
    return false;
  }
}

/**
 * Whether the page already has our own School Explorer or Neighborhood
 * Explorer on it. Those pages are useless as a "before" shot.
 *
 * Returns how it was spotted, because the two signals deserve different
 * treatment: an actual embed is proof, while the words appearing in the page
 * copy is only a strong hint and can be a false alarm on a page that merely
 * talks about schools.
 *
 *   { found: false }
 *   { found: true, how: "embed" }  - our script, iframe or data attribute
 *   { found: true, how: "text" }   - only the wording on the page
 */
async function detectExplorer(page) {
  try {
    return await page.evaluate(() => {
      const sources = [];
      for (const el of Array.from(document.querySelectorAll("script[src], iframe[src], link[href]"))) {
        sources.push(el.getAttribute("src") || el.getAttribute("href") || "");
      }
      for (const el of Array.from(document.querySelectorAll("[id], [class]"))) {
        sources.push(`${el.id || ""} ${typeof el.className === "string" ? el.className : ""}`);
      }
      for (const el of Array.from(document.querySelectorAll("*"))) {
        for (const name of el.getAttributeNames ? el.getAttributeNames() : []) {
          if (name.startsWith("data-dn-")) sources.push(name);
        }
      }
      const inline = Array.from(document.querySelectorAll("script:not([src])"))
        .map((el) => el.textContent || "")
        .join(" ")
        .slice(0, 200000);

      if (/dreamneighborhood|dream-neighborhood|dn-explorer|dn-popup|data-dn-/i.test(`${sources.join(" ")} ${inline}`)) {
        return { found: true, how: "embed" };
      }

      const text = document.body.innerText || "";
      if (/(School Explorer|Neighborhood Explorer|Find Your Dream School)/i.test(text)) {
        return { found: true, how: "text" };
      }
      return { found: false, how: null };
    });
  } catch (_) {
    return { found: false, how: null };
  }
}

async function collectListingLinks(page, origin) {
  try {
    return await page.evaluate(
      (originValue, hintSource, blockSource) => {
        const hint = new RegExp(hintSource, "i");
        const block = new RegExp(blockSource, "i");
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
          if (/^\d{1,6}\s+\w/.test(label)) score += 2;
          if (anchor.querySelector("img")) score += 1;
          if (score > 0) out.push({ href, score, label: label.slice(0, 120) });
        }
        return out.sort((a, b) => b.score - a.score).slice(0, 20);
      },
      origin,
      LISTING_HREF_HINTS.source,
      NON_LISTING_HREF.source
    );
  } catch (_) {
    return [];
  }
}

async function settle(page) {
  await page.evaluate(async () => {
    // Nudge lazy images into loading, then come back to the top for the shot.
    window.scrollTo(0, 900);
    await new Promise((r) => setTimeout(r, 450));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 350));
  });
  try {
    await page.evaluate(() => document.fonts && document.fonts.ready);
  } catch (_) {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 600));
}

async function open(page, url, timeout) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await page.waitForNetworkIdle({ idleTime: 700, timeout: 12000 }).catch(() => {});
  await dismissOverlays(page);
  await settle(page);
}

/**
 * Screenshot a live listing on the customer's site.
 *
 * Throws a refusal (error.isCaptureRefusal) when there is nothing usable, so
 * the job can tell the user what to do next instead of shipping a homepage.
 */
async function captureListing({ browser, url, listingUrl, outDir, log }) {
  const home = normalizeUrl(url);
  const origin = new URL(home).origin;
  const deadline = Date.now() + OVERALL_BUDGET_MS;
  const outOfTime = () => Date.now() > deadline;

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

  const checked = [];
  let listingsSeen = 0;
  let listingsWithExplorer = 0;

  const shoot = async (pageUrl, notes) => {
    const address = await findAddress(page);
    const shotPath = path.join(outDir, "site.png");
    await page.screenshot({ path: shotPath, type: "png", captureBeyondViewport: false });
    log("Screenshot captured");
    return { screenshot: shotPath, pageUrl, address, checked, notes: notes || [] };
  };

  try {
    /* ---- a listing URL pasted by hand wins, no searching ---- */
    if (listingUrl) {
      const target = normalizeUrl(listingUrl);
      log(`Opening the listing page you gave me: ${new URL(target).pathname}`);
      try {
        await open(page, target, 45000);
      } catch (error) {
        throw captureError(
          "LISTING_URL_UNREACHABLE",
          `That listing page would not open (${error.message}). Check the address and try again.`
        );
      }
      const found = await detectExplorer(page);
      if (found.found && found.how === "embed") {
        throw captureError(
          "LISTING_HAS_EXPLORER",
          "That page already has a Dream Neighborhood Explorer embedded on it, so it cannot be the \u201cbefore\u201d shot. Pick one of their listings that does not have it yet."
        );
      }
      const notes = [];
      if (found.found) {
        // Only the wording, no embed. The person pasting the URL gets to decide,
        // but they are told what was seen.
        notes.push(
          "This page mentions School Explorer or Neighborhood Explorer in its text, but no Explorer embed was found on it. Check the video before you send it."
        );
        log("That page talks about an Explorer but does not have one embedded - using it, since you picked it");
      }
      if (!(await looksLikeListing(page))) {
        notes.push("This page does not read like a listing (no price and beds/baths found), but you chose it, so it was used.");
        log("Heads up: that page does not read like a listing, but it is the one you picked");
      }
      checked.push({ url: target, listing: true, explorer: false, chosen: true });
      return await shoot(target, notes);
    }

    /* ---- otherwise: hunt for one on their site ---- */
    log(`Opening ${new URL(home).hostname}`);
    try {
      await open(page, home, 45000);
    } catch (error) {
      throw captureError(
        "SITE_UNREACHABLE",
        `Their website would not open (${error.message}). Check the address, or paste one listing URL by hand and try again.`
      );
    }

    const consider = async (candidateUrl) => {
      if (await looksLikeListing(page)) {
        listingsSeen += 1;
        const found = await detectExplorer(page);
        if (found.found) {
          listingsWithExplorer += 1;
          checked.push({ url: candidateUrl, listing: true, explorer: true, how: found.how });
          log("That listing already shows an Explorer - looking for another one");
          return false;
        }
        checked.push({ url: candidateUrl, listing: true, explorer: false, chosen: true });
        return true;
      }
      checked.push({ url: candidateUrl, listing: false, explorer: false });
      return false;
    };

    if (await consider(page.url())) {
      log("Their entry page is already a live listing");
      return await shoot(page.url());
    }

    log("Looking for a live listing on their site");
    const queue = await collectListingLinks(page, origin);
    const tried = new Set([home, page.url()]);
    let visits = 0;

    const drain = async () => {
      while (queue.length && visits < MAX_CANDIDATE_VISITS && !outOfTime()) {
        const candidate = queue.shift();
        if (tried.has(candidate.href)) continue;
        tried.add(candidate.href);
        visits += 1;
        try {
          await open(page, candidate.href, 35000);
        } catch (_) {
          continue;
        }
        if (await consider(candidate.href)) return true;
      }
      return false;
    };

    if (await drain()) {
      log("Found a live listing with no Explorer on it yet");
      return await shoot(page.url());
    }

    // Nothing on the homepage. Their listings are probably one click deeper.
    for (const indexPath of LISTING_INDEX_PATHS) {
      if (outOfTime() || visits >= MAX_CANDIDATE_VISITS) break;
      const indexUrl = new URL(indexPath, origin).toString();
      if (tried.has(indexUrl)) continue;
      tried.add(indexUrl);
      try {
        await open(page, indexUrl, 30000);
      } catch (_) {
        continue;
      }
      log(`Checking ${indexPath}`);
      if (await consider(indexUrl)) {
        log("Found a live listing with no Explorer on it yet");
        return await shoot(page.url());
      }
      const more = await collectListingLinks(page, origin);
      queue.push(...more.filter((entry) => !tried.has(entry.href)));
      if (await drain()) {
        log("Found a live listing with no Explorer on it yet");
        return await shoot(page.url());
      }
    }

    if (listingsWithExplorer > 0 && listingsSeen === listingsWithExplorer) {
      throw captureError(
        "ALL_LISTINGS_HAVE_EXPLORER",
        `Every listing found on that site (${listingsWithExplorer}) already has School Explorer or Neighborhood Explorer on it, so there is no \u201cbefore\u201d page to film. Paste a listing URL that does not have it yet, or pick a different customer.`
      );
    }

    throw captureError(
      "NO_LISTING_FOUND",
      `No live listing page could be found on ${new URL(home).hostname} (${checked.length} pages checked). Nothing was sent. Paste one listing URL by hand and try again - the homepage is not used as a stand-in.`
    );
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { captureListing, normalizeUrl, detectExplorer, looksLikeListing };
