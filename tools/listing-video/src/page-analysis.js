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

/*
 * Street types and directions in either the mixed case people write or the
 * SHOUTING that IDX headings use. The regex below cannot simply be made
 * case-insensitive, because the capital that begins each street-name word is
 * what stops it matching a sentence, so the two spellings are listed instead.
 *
 * Andy Harris's listing is titled "1908 SW MILES ST, Portland, OR 97219". With
 * only mixed case here, "ST" did not match, no heading address was found, and a
 * "Recently viewed" address from further down the page was filmed instead.
 */
const bothCases = (words) => words.flatMap((word) => [word, word.toUpperCase()]);
const TYPE_GROUP = bothCases(STREET_TYPES).join("|");
const DIR_GROUP = bothCases(DIRECTIONS).join("|");
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
    // A numbered rural road: "252 County Rd 156", "1420 State Route 9". Without
    // this the route number was dropped and the house became "252 County Rd".
    "(?:\\s+(\\d{1,4})\\b)?" +
    `(?:\\s+(${DIR_GROUP})\\b\\.?)?`,
  "g"
);

/*
 * A road that is named by a number rather than by a word.
 *
 * "1420 Highway 50 W" and "8500 FM 1960 Rd W" have no capitalised name word
 * between the house number and the street type, so the pattern above cannot see
 * them at all.
 */
const NUMBERED_ROAD_RE = new RegExp(
  "(?<![\\w.,$-])" +
    "(\\d{1,6})\\s+" +
    `(?:(?:${DIR_GROUP})\\.?\\s+)?` +
    "((?:US|U\\.S\\.|State|County|Farm|Ranch|FM|RR|SR|CR|Route|Rte|Highway|Hwy|Hiway|Road|Rd)" +
    "(?:\\s+(?:Route|Rte|Highway|Hwy|Road|Rd|Line))?)\\s+" +
    "(\\d{1,4})\\b" +
    `(?:\\s+(${TYPE_GROUP})\\b\\.?)?` +
    `(?:\\s+(${DIR_GROUP})\\b\\.?)?`,
  "gi"
);

/*
 * Every state, by code and by name.
 *
 * A listing heading reads "252 COUNTY RD 156, ABIQUIU, NEW MEXICO 87510" as
 * often as it reads "NM". With only two-letter codes accepted, that heading
 * yielded no town at all and the town was then taken from the site's own tagline
 * - "Placitas, NM 87043", the agent's patch, 150 miles from the house.
 */
const STATE_CODES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC",
};
const STATE_ABBREVIATIONS = new Set(Object.values(STATE_CODES));

/** The two-letter code for a state written either way, or "" if it is not one. */
function stateCodeFor(value) {
  const text = tidy(value).replace(/\./g, "");
  if (!text) return "";
  if (text.length === 2 && STATE_ABBREVIATIONS.has(text.toUpperCase())) return text.toUpperCase();
  return STATE_CODES[text.toLowerCase()] || "";
}

/*
 * City, then something that might be a state, then a ZIP. The state is checked
 * against the list above rather than by its shape.
 *
 * The whitespace before the comma is not cosmetic. IDX Broker builds its heading
 * out of one span per part:
 *
 *   <span class="IDX-detailsAddressName">Cranes Nest Court</span>
 *   <span class="IDX-detailsEndAddressComma">,&nbsp;</span>
 *   <span class="IDX-detailsAddressCity">Orlando</span>
 *
 * Depending on how those spans lay out, the text can come through as
 * "Cranes Nest Court , Orlando , FL 32824". Requiring the comma to sit tight
 * against the city meant no town was found at all, and a street with no town
 * produced no geocode query - the dead end Bill hit on 14918 Cranes Nest Court.
 */
const CITY_STATE_RE =
  /\b([A-Z][A-Za-z.'\u2019-]+(?:\s+[A-Z][A-Za-z.'\u2019-]+){0,3})\s*,\s*([A-Za-z][A-Za-z.'\u2019 -]{0,18}?)\s+(\d{5})(?:-\d{4})?\b/;

/* ---------------------------------------------------------------- */
/* addresses                                                        */
/* ---------------------------------------------------------------- */

function tidy(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

/** "ABIQUIU" reads as "Abiquiu" in a caption; a mixed-case name is left alone. */
function titleCase(value) {
  const text = tidy(value);
  if (!text || text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
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

  // A road named by a number is tried first, because the ordinary pattern would
  // match a shorter piece of it - "252 County Rd" out of "252 County Rd 156".
  NUMBERED_ROAD_RE.lastIndex = 0;
  let numbered;
  while ((numbered = NUMBERED_ROAD_RE.exec(text)) !== null) {
    const candidate = tidy(numbered[0]);
    if (looksLikeStreetAddress(candidate)) return candidate;
  }

  STREET_RE.lastIndex = 0;
  let match;
  while ((match = STREET_RE.exec(text)) !== null) {
    const candidate = tidy(match[0]);
    if (looksLikeStreetAddress(candidate)) return candidate;
  }
  return "";
}

function cityStateIn(value) {
  const text = tidy(value);
  const match = text.match(CITY_STATE_RE);
  if (!match) return null;
  const state = stateCodeFor(match[2]);
  // Something in the shape of a state that is not one, e.g. "Suite 200 87510".
  if (!state) return null;
  // "2135 Bellflower Blvd Long Beach, CA" would otherwise report the city as
  // "Bellflower Blvd Long Beach". Drop everything up to the street type.
  const words = match[1].split(/\s+/);
  let start = 0;
  for (let index = 0; index < words.length; index += 1) {
    if (STREET_TYPE_SET.has(words[index].toLowerCase().replace(/\.$/, ""))) start = index + 1;
  }
  const city = words.slice(start).join(" ") || match[1];
  return { cityState: `${titleCase(city)}, ${state}`, zip: match[3] };
}

/**
 * Structured-data types whose address is a home.
 *
 * Deliberately narrow. "Place" used to be in here, and every WordPress SEO
 * plugin emits a site-wide Place for the agent's office, so a condo page on
 * redwagonteam.com reported its address as 2135 Bellflower Blvd - the office.
 */
const ADDRESS_TYPES = new Set(
  [
    "singlefamilyresidence", "house", "apartment", "condominium", "residence",
    "accommodation", "realestatelisting", "home", "townhouse", "suite",
    "singlefamilyhome",
  ].map((type) => type.toLowerCase())
);

// An agent, an office or an organisation has an address too, and it is not the
// listing's. Bill's video put "2135 Bellflower Blvd" - the Fathom office - on
// the tooltip.
const OFFICE_TYPES = new Set(
  [
    "realestateagent", "organization", "localbusiness", "corporation", "person",
    "website", "webpage", "breadcrumblist", "postaladdress", "place",
    "collectionpage", "itempage", "searchresultspage", "aboutpage",
    "contactpage", "profilepage", "imageobject", "product", "offer",
  ].map((type) => type.toLowerCase())
);

// SEO plugins hang the site-wide business off ids like "#place" and
// "#organization". Those are never the listing.
const SITE_WIDE_ID_RE = /#(place|organization|website|localbusiness|person|logo|breadcrumb|schema-)/i;

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
  const isOffice =
    types.some((type) => OFFICE_TYPES.has(type)) || SITE_WIDE_ID_RE.test(String(node["@id"] || ""));
  const isResidence = types.some((type) => ADDRESS_TYPES.has(type));
  const address = node.address;

  // Only a node that says it is a home gets to name the address. An untyped
  // node with an address is as likely to be the office as the house.
  if (address && isResidence && !isOffice) {
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
  if (isResidence && !isOffice) {
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

/*
 * A URL that reads like a search.
 *
 * "/idx/" used to be in here, which condemned every page on an idxbroker-hosted
 * site - including /idx/details/listing/b001/114051774, a single house. So the
 * IDX paths are named individually instead.
 */
const SEARCH_URL_RE =
  /(\/search\b|\/results\b|\/map\b|advanced-?search|property-?search|\/browse\b|\/sold\b|\/idx\/(search|results|map|city|area|zipcode|county|subdivision|neighborhood|community|advanced)\b|[?&](q|query|search|keyword|city|zip|minprice|maxprice|beds|baths|sort)=)/i;

/**
 * A URL that is one house, by its shape alone.
 *
 * /idx/details/listing/b001/114051774, /listing/12345, /properties/listing/...
 * A path like this is a single property on every IDX and every agent site I have
 * seen, and no search or index page looks like it. Somebody pasting one of these
 * has told us exactly which house they mean, and that is not overruled by a map
 * widget or a search box sitting in the page furniture.
 */
const SINGLE_LISTING_PATH_RE =
  /\/(?:idx\/)?(?:details\/)?(?:listing|listings|property|properties|home|homes|mls|estate)\/[^/?#]+/i;

/** Somewhere on the site's own search, rather than on one property. */
const IDX_SEARCH_PATH_RE = /\/idx\/(search|results|map|city|area|zipcode|county|subdivision|neighborhood|community|advanced)\b/i;

function looksLikeSingleListingUrl(url) {
  let path;
  try {
    const parsed = new URL(url);
    path = decodeURIComponent(parsed.pathname);
    // A listing URL does not carry search filters.
    if (/[?&](q|query|search|keyword|minprice|maxprice|beds|baths|sort)=/i.test(parsed.search)) return false;
  } catch (_) {
    return false;
  }
  if (IDX_SEARCH_PATH_RE.test(path)) return false;
  if (/\/(search|results|browse)\b/i.test(path)) return false;
  return SINGLE_LISTING_PATH_RE.test(path);
}

function looksLikeIdxSearchUrl(url) {
  try {
    return IDX_SEARCH_PATH_RE.test(decodeURIComponent(new URL(url).pathname));
  } catch (_) {
    return false;
  }
}

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
 * Copy that means the site will not show the listing without an account.
 *
 * This is the narrow list on purpose. An earlier version also treated "create an
 * account" as a wall, and that is marketing on most IDX sites rather than a gate:
 * opening the same listing URL in a clean profile shows the whole house with
 * nothing but an optional "Sign In" link in the header. So these are only the
 * phrases that say you must register to see THIS, and a link in a header can
 * never match one.
 *
 * We do not get past a real gate, and we do not try: no accounts, no forms, no
 * carrying on to the next listing.
 */
const REGISTRATION_GATE_RE =
  /(register to continue|register to view|register to see|registration is required|please register|you must register|sign in to see|sign in to view|sign in to continue|sign up to see|sign up to view|sign up to continue|log in to see|log in to view|log in to continue|become a member|membership is required|free account to view|account is required to view|unlock this listing|you have viewed \d+ of \d+)/i;

/**
 * Is the site actually gating the listing?
 *
 * Structure, not just words. It counts when a box carrying gate wording covers
 * the page, or when the page itself is the gate and there is no listing on it.
 * Wording alone anywhere in the body does not, because a footer link or a
 * marketing promo is not a locked door.
 */
function looksLikeRegistrationWall(facts) {
  if (!facts) return false;
  const gate = facts.registrationGate;
  if (!gate) return false;
  return Boolean(gate.blocking || gate.wholePage);
}

// A path segment that says "this is one property", not a section of the site.
const LISTING_URL_SEGMENT_RE = /\/(listing|listings|property|properties|home|homes|mls|idx)\//i;

/**
 * Does the URL itself name the same house the page says it is about?
 *
 * A URL like /properties/listing/CRMLS/OC26141010/850-E-Ocean-Boulevard-B3-Long-Beach-CA-90802/
 * is about as clear as evidence gets, and it matters because some IDX systems
 * draw the price, beds and baths client-side, so a real listing page can look
 * bare at the moment it is read. A homepage or a market report can never have a
 * street address in its path, so this cannot let one of those through.
 */
function urlNamesTheSameHouse(url, street) {
  if (!street) return false;
  let path;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch (_) {
    return false;
  }
  if (!LISTING_URL_SEGMENT_RE.test(path)) return false;

  const fromUrl = firstStreetIn(path.replace(/[/_+]/g, " ").replace(/-/g, " "));
  if (!fromUrl) return false;

  // Same house number and same first word of the street name.
  const key = (value) => {
    const parts = tidy(value).split(/\s+/);
    return `${parts[0]} ${(parts[1] || "").toLowerCase()}`;
  };
  return key(fromUrl) === key(street);
}

/**
 * "detail"    - one listing, safe to film
 * "wall"      - the site wants an account before it will show the listing
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

  const urlNamesHouse = address.isSubject && urlNamesTheSameHouse(url, address.street);
  if (urlNamesHouse) markers.push(`the address is in both the page's URL and its heading (${address.street})`);

  // The URL is the shape of one property. On its own that is a listing marker,
  // and below it also stops a map or a search box in the furniture calling this
  // a search page.
  const urlIsOneListing = looksLikeSingleListingUrl(url);
  if (urlIsOneListing) markers.push("the URL is for a single property");

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

  /*
   * A registration gate, checked before search and marketing because "they want
   * an account" is the useful thing to say.
   *
   * A box covering the page is a gate however readable the listing behind it is:
   * that is a locked door and we do not go through it. A gate that is the whole
   * page is one too. Wording on its own is not - an optional "Sign In" in a
   * header, or a "create an account" marketing promo, is not a locked door.
   */
  if (looksLikeRegistrationWall(facts)) {
    const gate = facts.registrationGate || {};
    return {
      kind: "wall",
      reasons: [
        gate.blocking
          ? "a register-to-view box is covering the page"
          : "this page is a registration form, not a listing",
      ],
      address,
    };
  }

  /*
   * A URL for one property is not a search page, however much search furniture
   * is on it. IDX detail pages carry a map of the neighbourhood and the site's
   * own search box in the header, and Bill pasted exactly such a URL and was
   * told to paste a listing URL.
   */
  if (searchReasons.length >= 2 && !stronglyDetail && !urlIsOneListing) {
    return { kind: "search", reasons: searchReasons, address };
  }
  if (INDEX_PATH_RE.test(path) && !stronglyDetail) {
    return { kind: "index", reasons: ["this is their listings index, not one listing"], address };
  }
  if (marketingReasons.length >= 2 && !stronglyDetail && !urlIsOneListing) {
    return { kind: "marketing", reasons: marketingReasons, address };
  }
  // One search-ish signal on its own is not much: a site-wide search widget sits
  // in the header of plenty of real listing pages.
  if (searchReasons.length === 1 && markers.length < 2 && !urlNamesHouse && !urlIsOneListing) {
    return { kind: "search", reasons: searchReasons, address };
  }

  // One listing needs the page to say which house it is about, and to carry at
  // least two things only a listing page has. Photos and the words "bed" and
  // "bath" somewhere in the copy are not enough - that is what filmed a city
  // landing page.
  if (!address.isSubject && !urlIsOneListing) {
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
  // Two listing markers, or one that is the URL and the heading naming the same
  // house, which no landing page can manage.
  if (markers.length < 2 && !urlNamesHouse && !urlIsOneListing) {
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
  urlNamesTheSameHouse,
  looksLikeSingleListingUrl,
  looksLikeIdxSearchUrl,
  looksLikeRegistrationWall,
  REGISTRATION_GATE_RE,
  SEARCH_URL_RE,
};
