"use strict";

/**
 * Deciding what a page is, and what address it is about.
 *
 * All of this works on plain facts gathered from the page (see
 * collectPageFacts in capture.js) rather than on a live DOM, so it can be
 * unit tested without opening Chrome.
 *
 * Two jobs:
 *
 *   classifyPage  - is this a single listing detail page, or a search / map /
 *                   results page? A search page is not a usable backdrop: the
 *                   video is supposed to show one of their listings.
 *
 *   extractAddress - the one street address the page is about. This has to be
 *                    strict. A loose match once produced the tooltip
 *                    "032 SQFT 4497 Chase Drive", which is the tail of
 *                    "1,032 SQFT" glued onto the next listing's address.
 */

const STREET_TYPES = [
  "Street", "St", "Avenue", "Ave", "Road", "Rd", "Drive", "Dr", "Lane", "Ln",
  "Boulevard", "Blvd", "Court", "Ct", "Circle", "Cir", "Way", "Place", "Pl",
  "Terrace", "Ter", "Trail", "Trl", "Parkway", "Pkwy", "Highway", "Hwy",
  "Loop", "Run", "Row", "Path", "Commons", "Crossing", "Xing", "Square", "Sq",
  "Point", "Pt", "Ridge", "Rdg", "Cove", "Bend", "Pass", "Walk", "Alley",
  "Plaza", "Hollow", "Landing", "Manor", "Meadow", "Meadows", "Mill", "Park",
  "Ranch", "Trace", "View", "Vista", "Glen", "Grove", "Harbor", "Heights",
  "Hill", "Hills", "Island", "Knoll", "Lake", "Springs", "Station", "Summit",
  "Valley", "Village", "Creek", "Bluff", "Branch", "Bridge", "Brook", "Canyon",
  "Cliff", "Club", "Corner", "Dale", "Dam", "Estate", "Estates", "Falls",
  "Field", "Fields", "Ford", "Forest", "Fork", "Garden", "Gardens", "Gate",
  "Green", "Haven", "Isle", "Junction", "Key", "Lodge", "Mount", "Mountain",
  "Oaks", "Orchard", "Overlook", "Pike", "Pines", "Port", "Prairie", "Reserve",
  "Rest", "River", "Shore", "Shores", "Spring", "Spur", "Stream", "Turnpike",
  "Union", "Wells", "Woods",
];

const DIRECTIONS = [
  "NE", "NW", "SE", "SW", "N", "S", "E", "W",
  "North", "South", "East", "West", "Northeast", "Northwest", "Southeast", "Southwest",
];

/**
 * Words that are never part of a street name. These are the listing-spec words
 * that sit next to the price and square footage, which is exactly where a loose
 * address match goes wrong.
 */
const NOISE_WORDS = new Set(
  [
    "SQFT", "SQ", "FT", "SF", "SQUARE", "FEET", "FOOT", "ACRE", "ACRES",
    "BED", "BEDS", "BEDROOM", "BEDROOMS", "BD", "BDS", "BR",
    "BATH", "BATHS", "BATHROOM", "BATHROOMS", "BA", "BTH",
    "MLS", "LOT", "LOTS", "PRICE", "USD", "DOM", "DAYS", "STATUS",
    "GARAGE", "STORIES", "STORY", "BUILT", "YEAR", "SOLD", "ACTIVE", "PENDING",
    "LISTING", "LISTINGS", "PROPERTY", "PROPERTIES", "RESULTS", "TOTAL",
    "FROM", "TO", "AND", "OR", "OF", "THE", "MORE", "LESS", "MIN", "MAX",
  ].map((word) => word.toUpperCase())
);

const TYPE_GROUP = STREET_TYPES.join("|");
const DIR_GROUP = DIRECTIONS.join("|");

/*
 * A house number, then one to four capitalised street-name words, then a street
 * type, then an optional trailing direction.
 *
 * The lookbehind is what rejects "1,032 SQFT ..." - the "032" is preceded by a
 * comma, so it is part of a number, not a house number. The name words must
 * start with a letter, so a second number like "4497" can never be swallowed
 * into the middle of an address.
 */
const STREET_RE = new RegExp(
  "(?<![\\w.,$-])" +
    "(\\d{1,6})\\s+" +
    `(?:(?:${DIR_GROUP})\\.?\\s+)?` +
    "((?:[A-Z][A-Za-z0-9.'\\u2019-]{0,20}\\s+){1,4})" +
    `(${TYPE_GROUP})\\b\\.?` +
    `(?:\\s+(${DIR_GROUP})\\b\\.?)?`,
  "g"
);

const CITY_STATE_RE =
  /\b([A-Z][A-Za-z.'\u2019-]+(?:\s+[A-Z][A-Za-z.'\u2019-]+){0,3}),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/;

/* ---------------------------------------------------------------- */
/* addresses                                                        */
/* ---------------------------------------------------------------- */

function tidy(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Is this string a plausible street address on its own?
 *
 * Used both to check a regex hit and to sanity check a streetAddress handed to
 * us by the page's own structured data.
 */
function looksLikeStreetAddress(value) {
  const text = tidy(value);
  if (!text || text.length > 70) return false;
  if (!/\d/.test(text) || !/[A-Za-z]/.test(text)) return false;

  const houseNumber = text.match(/^(\d{1,6})\b/);
  if (!houseNumber) return false;
  // "032 SQFT ..." - a real house number does not have a leading zero.
  if (houseNumber[1].length > 1 && houseNumber[1].startsWith("0")) return false;

  const words = text.split(/[\s,]+/).slice(1);
  if (words.length === 0) return false;
  if (words.some((word) => NOISE_WORDS.has(word.replace(/[^A-Za-z]/g, "").toUpperCase()))) return false;
  // A price or a measurement got in.
  if (/[$%]/.test(text)) return false;
  if (/\b\d{1,3}(,\d{3})+\b/.test(text)) return false;

  return true;
}

function firstStreetIn(value) {
  const text = tidy(value);
  if (!text) return "";
  STREET_RE.lastIndex = 0;
  let match;
  while ((match = STREET_RE.exec(text)) !== null) {
    const candidate = tidy(match[0]);
    if (looksLikeStreetAddress(candidate)) return candidate;
  }
  return "";
}

function cityStateIn(value) {
  const match = tidy(value).match(CITY_STATE_RE);
  if (!match) return null;
  return { cityState: `${match[1]}, ${match[2]}`, zip: match[3] };
}

const ADDRESS_TYPES = new Set(
  [
    "singlefamilyresidence", "house", "apartment", "condominium", "residence",
    "accommodation", "place", "product", "offer", "realestatelisting",
    "realestateagent", "localbusiness", "home", "townhouse", "suite",
  ].map((type) => type.toLowerCase())
);

/** Walk any parsed JSON-LD looking for a PostalAddress with a street. */
function addressFromJsonLd(rawBlocks) {
  for (const raw of rawBlocks || []) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      continue;
    }
    const found = walkForAddress(parsed, 0);
    if (found) return found;
  }
  return null;
}

function walkForAddress(node, depth) {
  if (!node || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = walkForAddress(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;

  const address = node.address;
  if (address) {
    if (typeof address === "string" && looksLikeStreetAddress(firstStreetIn(address))) {
      const street = firstStreetIn(address);
      const place = cityStateIn(address);
      return { street, cityState: place ? place.cityState : "", zip: place ? place.zip : "" };
    }
    if (typeof address === "object" && !Array.isArray(address)) {
      const street = tidy(address.streetAddress);
      if (looksLikeStreetAddress(street)) {
        const locality = tidy(address.addressLocality);
        const region = tidy(address.addressRegion);
        return {
          street,
          cityState: locality && region ? `${locality}, ${region}` : locality || "",
          zip: tidy(address.postalCode),
        };
      }
    }
  }

  // Some feeds put the address in the name of a residence-ish thing.
  const types = []
    .concat(node["@type"] || [])
    .map((type) => String(type).toLowerCase());
  if (types.some((type) => ADDRESS_TYPES.has(type))) {
    const street = firstStreetIn(node.name);
    if (street) {
      const place = cityStateIn(node.name) || cityStateIn(node.description);
      return { street, cityState: place ? place.cityState : "", zip: place ? place.zip : "" };
    }
  }

  for (const key of Object.keys(node)) {
    if (key === "address") continue;
    const found = walkForAddress(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * The address the page is about, taken from the most trustworthy source that
 * has one. Structured data beats a heading, and a heading beats scraping the
 * body text, because body text is where the neighbouring listing's square
 * footage lives.
 */
function extractAddress(facts) {
  const empty = { street: "", cityState: "", zip: "", source: "none" };
  if (!facts) return empty;

  const fromJsonLd = addressFromJsonLd(facts.jsonLd);
  if (fromJsonLd) return { ...fromJsonLd, source: "json-ld" };

  const micro = facts.microdata || {};
  if (looksLikeStreetAddress(micro.streetAddress)) {
    const locality = tidy(micro.addressLocality);
    const region = tidy(micro.addressRegion);
    return {
      street: tidy(micro.streetAddress),
      cityState: locality && region ? `${locality}, ${region}` : locality || "",
      zip: tidy(micro.postalCode),
      source: "microdata",
    };
  }

  const headings = [].concat(facts.h1s || [], facts.ogTitle || [], facts.title || []);
  for (const heading of headings) {
    const street = firstStreetIn(heading);
    if (!street) continue;
    const place = cityStateIn(heading) || cityStateIn(facts.bodyText);
    return {
      street,
      cityState: place ? place.cityState : "",
      zip: place ? place.zip : "",
      source: "heading",
    };
  }

  const street = firstStreetIn(facts.bodyText);
  if (street) {
    const place = cityStateIn(facts.bodyText);
    return {
      street,
      cityState: place ? place.cityState : "",
      zip: place ? place.zip : "",
      source: "body-text",
    };
  }

  return empty;
}

/* ---------------------------------------------------------------- */
/* is this one listing, or a search page?                           */
/* ---------------------------------------------------------------- */

const SEARCH_URL_RE =
  /(\/search|\/results|\/map\b|\/idx\/|advanced-?search|property-?search|\/browse\b|\/sold\b|[?&](q|query|search|keyword|city|zip|minprice|maxprice|beds|baths|sort)=)/i;

// Phrases that belong to a search UI, not to one house.
const SEARCH_PHRASES = [
  "advanced search",
  "save search",
  "filters applied",
  "add another location",
  "search in map",
  "newest listings",
  "sort by",
  "hide map",
  "draw",
  "for sale / multiple types",
  "refine search",
  "clear filters",
  "reset filters",
  "results found",
  "properties found",
  "homes for sale in",
  "no results",
  "view all listings",
  "search results",
];

const INDEX_PATH_RE = /^\/?(listings?|properties|homes|homes-for-sale|for-sale|our-listings|featured-listings)\/?$/i;

function pathOf(url) {
  try {
    return new URL(url).pathname;
    } catch (_) {
    return "";
  }
}

/**
 * "detail"  - one listing, safe to film
 * "search"  - a search, map or results page
 * "index"   - a bare listing index, e.g. /listings
 * "other"   - anything else (homepage, about page, ...)
 */
function classifyPage(facts) {
  if (!facts) return { kind: "other", reasons: ["nothing to look at"] };

  const text = String(facts.bodyText || "").toLowerCase();
  const url = String(facts.url || "");
  const searchReasons = [];
  const detailReasons = [];

  if (SEARCH_URL_RE.test(url)) searchReasons.push("the address looks like a search");

  const phrases = SEARCH_PHRASES.filter((phrase) => text.includes(phrase));
  if (phrases.length >= 2) searchReasons.push(`search controls on the page (${phrases.slice(0, 3).join(", ")})`);

  if (Number(facts.searchInputCount || 0) >= 3) searchReasons.push("a search form with several filters");
  if (Number(facts.mapAreaFraction || 0) >= 0.2) searchReasons.push("a big map takes up the page");
  if (Number(facts.priceCount || 0) >= 3) searchReasons.push(`${facts.priceCount} different prices on one page`);
  if (Number(facts.listingLinkCount || 0) >= 8) searchReasons.push("a grid of links to other listings");
  if (Number(facts.addressCount || 0) >= 3) searchReasons.push(`${facts.addressCount} addresses on one page`);

  const address = extractAddress(facts);
  const structured = address.source === "json-ld" || address.source === "microdata";

  if (structured) detailReasons.push(`the page says its address is ${address.street}`);
  else if (address.street && address.source === "heading") detailReasons.push(`the heading is an address (${address.street})`);
  if (facts.hasBeds && facts.hasBaths) detailReasons.push("beds and baths for one home");
  if (Number(facts.priceCount || 0) === 1) detailReasons.push("a single price");
  if (facts.mlsId) detailReasons.push(`an MLS number (${facts.mlsId})`);
  if (Number(facts.galleryImageCount || 0) >= 3) detailReasons.push("a photo gallery");

  // Structured data naming one address, with beds and baths, outranks a map or
  // a "similar homes" strip further down the page.
  const stronglyDetail = structured && facts.hasBeds && facts.hasBaths;

  if (searchReasons.length >= 2 && !stronglyDetail) {
    return { kind: "search", reasons: searchReasons, address };
  }
  if (INDEX_PATH_RE.test(pathOf(url)) && !stronglyDetail && detailReasons.length < 3) {
    return { kind: "index", reasons: ["this is their listings index, not one listing"], address };
  }
  if (searchReasons.length === 1 && detailReasons.length < 2) {
    return { kind: "search", reasons: searchReasons, address };
  }

  // One listing needs an address plus real listing detail behind it.
  if (address.street && detailReasons.length >= 2) {
    return { kind: "detail", reasons: detailReasons, address };
  }

  return { kind: "other", reasons: detailReasons.length ? detailReasons : ["no listing detail found"], address };
}

module.exports = {
  STREET_TYPES,
  NOISE_WORDS,
  classifyPage,
  extractAddress,
  looksLikeStreetAddress,
  firstStreetIn,
  cityStateIn,
};
