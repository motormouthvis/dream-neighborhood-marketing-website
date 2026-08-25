"use strict";

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

function normalizeUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("Website URL is required.");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Website URL must be http or https.");
  return parsed.toString();
}

async function dismissOverlays(page) {
  try {
    await page.evaluate(() => {
      const accept = /^(accept|accept all|allow all|i agree|agree|got it|ok|okay|continue|close|dismiss)$/i;
      const clickable = Array.from(document.querySelectorAll("button, a, [role=button], input[type=button], input[type=submit]"));
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
      return hasPrice && hasSpecs;
    });
  } catch (_) {
    return false;
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
        return out.sort((a, b) => b.score - a.score).slice(0, 12);
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

/**
 * Screenshot the customer's site: their listing page when one can be found,
 * otherwise the homepage. Never throws for "no listing found" - a homepage shot
 * still makes a usable video.
 */
async function captureSite({ browser, url, outDir, log }) {
  const target = normalizeUrl(url);
  const origin = new URL(target).origin;
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

  const result = { screenshot: "", pageUrl: target, usedListingPage: false, address: null, notes: [] };

  try {
    log(`Opening ${new URL(target).hostname}`);
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 }).catch(() => {});
    await dismissOverlays(page);
    await settle(page);

    let captured = false;

    if (await looksLikeListing(page)) {
      result.usedListingPage = true;
      captured = true;
      log("This page already looks like a listing");
    } else {
      log("Looking for a live listing on their site");
      const candidates = await collectListingLinks(page, origin);
      for (const candidate of candidates.slice(0, 5)) {
        try {
          await page.goto(candidate.href, { waitUntil: "domcontentloaded", timeout: 35000 });
          await page.waitForNetworkIdle({ idleTime: 700, timeout: 12000 }).catch(() => {});
          await dismissOverlays(page);
          await settle(page);
          if (await looksLikeListing(page)) {
            result.usedListingPage = true;
            result.pageUrl = candidate.href;
            captured = true;
            log("Found a live listing");
            break;
          }
        } catch (_) {
          /* try the next candidate */
        }
      }
    }

    if (!captured) {
      log("No live listing found - using their homepage instead");
      result.notes.push("No live listing page was found, so the video uses their homepage.");
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 }).catch(() => {});
      await dismissOverlays(page);
      await settle(page);
      result.pageUrl = target;
    }

    result.address = await findAddress(page);
    const shotPath = path.join(outDir, "site.png");
    await page.screenshot({ path: shotPath, type: "png", captureBeyondViewport: false });
    result.screenshot = shotPath;
    log("Screenshot captured");
  } finally {
    await page.close().catch(() => {});
  }

  return result;
}

module.exports = { captureSite, normalizeUrl };
