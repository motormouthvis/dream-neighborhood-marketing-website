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
 *   classifyPage    - is this ONE listing, or a homepage, a city landing page, a
 *                     search, a map, a market report? Only one listing is worth
 *                     filming, and everything else has to be refused.
 *
 *   extractAddress  - the one street address the page is about.
 *
 * Both have been burnt before, so both are deliberately strict:
 *
 *   - A loose address match produced the tooltip "032 SQFT 4497 Chase Drive",
 *     which was the tail of "1,032 SQFT" glued onto the next listing's address.
 *   - A Fathom Realty city landing page got filmed because the words "bed" and
 *     "bath" appeared somewhere in its marketing copy, it had a few photos, and
 *     an address could be scraped out of the office details in its footer. So an
 *     address only counts when the page itself declares it as its subject, and
 *     photos and stray spec words no longer add up to a listing.
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
const STREET_TYPE_SET = new Set(STREET_TYPES.map((type) => type.toLowerCase()));

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
  // "2135 Bellflower Blvd Long Beach, CA" would otherwise report the city as
  // "Bellflower Blvd Long Beach". Drop everything up to the street type.
  const words = match[1].split(/\s+/);
  let start = 0;
  for (let index = 0; index < words.length; index += 1) {
    if (STREET_TYPE_SET.has(words[index].toLowerCase().replace(/\.$/, ""))) start = index + 1;
  }
  const city = words.slice(start).join(" ") || match[1];
  return { cityState: `${city}, ${match[2]}`, zip: match[3] };
}

const ADDRESS_TYPES = new Set(
  [
    "singlefamilyresidence", "house", "apartment", "condominium", "residence",
    "accommodation", "place", "product", "offer", "realestatelisting",
    "home", "townhouse", "suite",
  ].map((type) => type.toLowerCase())
);

// An agent, an office or an organisation has an address too, and it is not the
// listing's. Bill's video put "2135 Bellflower Blvd" - the Fathom office - on
// the tooltip.
const OFFICE_TYPES = new Set(
  [
    "realestateagent", "organization", "localbusiness", "corporation", "person",
    "website", "webpage", "breadcrumblist", "postaladdress",
  ].map((type) => type.toLowerCase())
);

function typesOf(node) {
  return []
    .concat(node["@type"] || [])
    .map((type) => String(type).toLowerCase());
}

/** Walk any parsed JSON-LD looking for a residence with a street address. */
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

  const types = typesOf(node);
  const isOffice = types.some((type) => OFFICE_TYPES.has(type));
  const address = node.address;

  if (address && !isOffice) {
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

// Where an address came from, and whether that makes it the page's subject.
// Anything scraped out of running text is a guess, and a guess is not good
// enough to call a page a listing.
const SUBJECT_SOURCES = new Set(["json-ld", "microdata", "heading", "address-element"]);

/**
 * The address the page is about.
 *
 * Structured data beats a heading, a heading beats an element marked up as an
 * address, and all of those beat scraping the running text - which is only used
 * as a last resort and never counts as the page's subject.
 */
function extractAddress(facts) {
  const empty = { street: "", cityState: "", zip: "", source: "none", isSubject: false };
  if (!facts) return empty;

  const finish = (found, source) => ({
    street: found.street,
    cityState: found.cityState || "",
    zip: found.zip || "",
    source,
    isSubject: SUBJECT_SOURCES.has(source),
  });

  const fromJsonLd = addressFromJsonLd(facts.jsonLd);
  if (fromJsonLd) return finish(fromJsonLd, "json-ld");

  const micro = facts.microdata || {};
  if (looksLikeStreetAddress(micro.streetAddress)) {
    const locality = tidy(micro.addressLocality);
    const region = tidy(micro.addressRegion);
    return finish(
      {
        street: tidy(micro.streetAddress),
        cityState: locality && region ? `${locality}, ${region}` : locality || "",
        zip: tidy(micro.postalCode),
      },
      "microdata"
    );
  }

  // Candidates the collector marked up, in order, skipping anything that sits
  // in a footer or a contact block: that is the office, not the house.
  const candidates = Array.isArray(facts.addressCandidates)
    ? facts.addressCandidates
    : [].concat(facts.h1s || [], facts.ogTitle || [], facts.title || []).map((text) => ({ text, where: "heading" }));

  for (const candidate of candidates) {
    if (!candidate || candidate.inFooter) continue;
    const street = firstStreetIn(candidate.text);
    if (!street) continue;
    const place = cityStateIn(candidate.text) || cityStateIn(facts.mainText || facts.bodyText);
    return finish(
      { street, cityState: place ? place.cityState : "", zip: place ? place.zip : "" },
      candidate.where === "address-element" ? "address-element" : "heading"
    );
  }

  // Last resort. Good enough to caption a tooltip, not good enough to decide
  // that this page is a listing.
  const street = firstStreetIn(facts.mainText || facts.bodyText);
  if (street) {
    const place = cityStateIn(facts.mainText || facts.bodyText);
    return finish({ street, cityState: place ? place.cityState : "", zip: place ? place.zip : "" }, "body-text");
  }

  return empty;
}

/* ---------------------------------------------------------------- */
/* what kind of page is this?                                       */
/* ---------------------------------------------------------------- */

const SEARCH_URL_RE =
  /(\/search|\/results|\/map\b|\/idx\/|advanced-?search|property-?search|\/browse\b|\/sold\b|[?&](q|query|search|keyword|city|zip|minprice|maxprice|beds|baths|sort)=)/i;

// A whole path that is never one listing. The empty path is the homepage.
const NEVER_LISTING_PATH_RE =
  /^\/?(|index\.html?|home|blog|news|press|about|about-us|our-story|contact|contact-us|team|our-team|agents?|staff|testimonials?|reviews?|careers?|jobs|privacy|privacy-policy|terms|sitemap|faq|services|sell|sellers?|selling|buy|buyers?|buying|financing|mortgage|calculator|market-report|market-reports|market-update|home-value|home-valuation|whats-my-home-worth|cma|valuation|neighborhoods?|communities|areas?|cities|lifestyle|resources|guides?|login|register|dashboard)\/?$/i;

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
  "refine search",
  "clear filters",
  "reset filters",
  "results found",
  "properties found",
  "no results",
  "search results",
];

// Buttons and links that belong on a landing page selling a search, not on one
// house. These are Bill's page word for word: "Search Long Beach Homes",
// "Long Beach Market Report", "Custom List Of Homes".
const MARKETING_CTA_RE =
  /(search\s+(all\s+)?[\w\s]{0,24}\bhomes?\b|search\s+(listings|properties)|market\s+report|custom\s+list\s+of\s+homes|home\s+valuation|what.?s\s+my\s+home\s+worth|free\s+home\s+value|browse\s+(all\s+)?(homes|listings|properties)|view\s+all\s+(homes|listings|properties)|find\s+(a\s+|your\s+)?(home|dream\s+home)|start\s+(your\s+)?search|get\s+pre-?approved|home\s+search|featured\s+(homes|listings)|new\s+listings|sell\s+my\s+home|list\s+my\s+home|request\s+a\s+(showing\s+)?list)/i;

// Copy that only ever appears on a city or landing page.
const MARKETING_COPY_RE =
  /(real estate offers|popular\s+[\w\s]{0,30}home types|we help\s+[\w\s]{0,30}buyers|this guide gives you|updated daily from the mls|homes currently for sale|homes for sale in|real estate & homes for sale|real estate and homes for sale|welcome to our|meet the team|browse our|search our|our listings|why work with)/i;

// Field labels that only a real listing page bothers to print.
const DETAIL_LABELS = [
  /year built/i,
  /lot size/i,
  /property type/i,
  /days on (the )?market/i,
  /\bmls\s*#/i,
  /list price/i,
  /\bhoa\b/i,
  /\bapn\b/i,
  /subdivision/i,
  /parcel/i,
  /property details/i,
  /listing details/i,
  /schedule a (tour|showing)/i,
  /request (a )?(tour|showing|info)/i,
];

const INDEX_PATH_RE =
  /^\/?(listings?|properties|homes|homes-for-sale|for-sale|our-listings|featured-listings|new-listings|open-houses)\/?$/i;

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch (_) {
    return "";
  }
}

function countDetailLabels(text) {
  return DETAIL_LABELS.filter((pattern) => pattern.test(text)).length;
}

/**
 * "detail"    - one listing, safe to film
 * "search"    - a search, map or results page
 * "index"     - a bare listing index, e.g. /listings
 * "marketing" - a homepage, city landing page, market report or other sales page
 * "other"     - anything else
 */
function classifyPage(facts) {
  if (!facts) return { kind: "other", reasons: ["nothing to look at"] };

  const url = String(facts.url || "");
  const path = pathOf(url);
  const main = String(facts.mainText || facts.bodyText || "");
  const mainLower = main.toLowerCase();
  const address = extractAddress(facts);

  /* ---- what makes this look like one listing ---- */
  const structured = address.source === "json-ld" || address.source === "microdata";
  const specRow = Boolean(facts.specRowText);
  const detailLabelCount = countDetailLabels(main);
  const prices = Number(facts.mainPriceCount == null ? facts.priceCount : facts.mainPriceCount) || 0;

  const markers = [];
  if (structured) markers.push(`the page's own data says it is a home at ${address.street}`);
  if (specRow) markers.push(`beds, baths and size for one home ("${String(facts.specRowText).slice(0, 60)}")`);
  if (facts.mlsId) markers.push(`an MLS number (${facts.mlsId})`);
  if (detailLabelCount >= 2) markers.push(`${detailLabelCount} listing detail fields`);
  if (prices >= 1 && facts.hasBeds && facts.hasBaths) markers.push("a price with beds and baths");
  if (Number(facts.galleryImageCount || 0) >= 4 && specRow) markers.push("photos of one home");

  // Structured data naming a home, plus a listing-only field, is about as sure
  // as this gets. That outranks a map or a "similar homes" strip further down.
  const stronglyDetail = structured && markers.length >= 2;

  /* ---- what makes this NOT one listing ---- */
  const searchReasons = [];
  if (SEARCH_URL_RE.test(url)) searchReasons.push("the address looks like a search");
  const phrases = SEARCH_PHRASES.filter((phrase) => mainLower.includes(phrase));
  if (phrases.length >= 2) searchReasons.push(`search controls on the page (${phrases.slice(0, 3).join(", ")})`);
  if (Number(facts.searchInputCount || 0) >= 3) searchReasons.push("a search form with several filters");
  if (Number(facts.mapAreaFraction || 0) >= 0.2) searchReasons.push("a big map takes up the page");
  if (prices >= 3) searchReasons.push(`${prices} different prices on one page`);
  if (Number(facts.listingLinkCount || 0) >= 8) searchReasons.push("a grid of links to other listings");
  if (Number(facts.addressCount || 0) >= 3) searchReasons.push(`${facts.addressCount} addresses on one page`);

  const marketingReasons = [];
  const ctas = (facts.ctaLabels || []).filter((label) => MARKETING_CTA_RE.test(label));
  if (ctas.length) marketingReasons.push(`buttons selling a search (${ctas.slice(0, 3).join(", ")})`);
  const copy = main.match(MARKETING_COPY_RE);
  if (copy) marketingReasons.push(`landing page copy ("${copy[0]}")`);
  if (facts.hasHeroBanner) marketingReasons.push("a big hero banner with buttons over it");
  if (!address.isSubject && Number(facts.galleryImageCount || 0) >= 3 && !specRow) {
    marketingReasons.push("photos but nothing that says which house this is");
  }

  /* ---- the verdict ---- */
  if (NEVER_LISTING_PATH_RE.test(path) && !stronglyDetail) {
    const home = path === "" || path === "/" || /^\/?(index\.html?|home)\/?$/i.test(path);
    return {
      kind: "marketing",
      reasons: [home ? "this is their homepage" : `this is their ${path.replace(/^\/|\/$/g, "")} page, not a listing`],
      address,
    };
  }

  if (searchReasons.length >= 2 && !stronglyDetail) {
    return { kind: "search", reasons: searchReasons, address };
  }
  if (INDEX_PATH_RE.test(path) && !stronglyDetail) {
    return { kind: "index", reasons: ["this is their listings index, not one listing"], address };
  }
  if (marketingReasons.length >= 2 && !stronglyDetail) {
    return { kind: "marketing", reasons: marketingReasons, address };
  }
  if (searchReasons.length === 1 && markers.length < 2) {
    return { kind: "search", reasons: searchReasons, address };
  }

  // One listing needs the page to say which house it is about, and to carry at
  // least two things only a listing page has. Photos and the words "bed" and
  // "bath" somewhere in the copy are not enough - that is what filmed a city
  // landing page.
  if (!address.isSubject) {
    return {
      kind: marketingReasons.length ? "marketing" : "other",
      reasons: [
        address.street
          ? `the only address here (${address.street}) is in the page text, not the page's subject - probably an office address`
          : "no address that this page is about",
      ].concat(marketingReasons.slice(0, 1)),
      address,
    };
  }
  if (markers.length < 2) {
    return {
      kind: "other",
      reasons: [`${address.street} is named, but there is no price, beds, baths or MLS detail for it`],
      address,
    };
  }

  return { kind: "detail", reasons: markers, address };
}

module.exports = {
  STREET_TYPES,
  NOISE_WORDS,
  SUBJECT_SOURCES,
  classifyPage,
  extractAddress,
  looksLikeStreetAddress,
  firstStreetIn,
  cityStateIn,
  countDetailLabels,
};
