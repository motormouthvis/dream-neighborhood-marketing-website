"use strict";

/**
 * Turning the listing's street address into coordinates.
 *
 * The Neighborhood Explorer takes a lat/lng on its widget URL. Its own search
 * box cannot be driven from headless Chrome - the input stays collapsed - so the
 * address captured from the realtor page is resolved here and handed to the
 * Explorer through the parameter it already supports.
 *
 * OpenStreetMap's Nominatim is the default because it needs no key. Their usage
 * policy asks for an identifying User-Agent and no more than one request a
 * second, and both are honoured below. Point LISTING_VIDEO_GEOCODER somewhere
 * else if staging ever needs a different service.
 */

const config = require("./config");

const USER_AGENT =
  "DreamNeighborhoodListingVideo/1.0 (internal staging tool; support@dreamneighborhood.com)";
const MIN_GAP_MS = 1100;

let lastCallAt = 0;

function geocodeError(message) {
  const error = new Error(message);
  error.code = "ADDRESS_NOT_FOUND";
  error.isCaptureRefusal = true;
  return error;
}

/**
 * A typed address that cannot be used, which is a filled-in form rather than a
 * failed lookup - so it is answered on the request instead of failing a job.
 */
function addressError(message) {
  const error = new Error(message);
  error.code = "ADDRESS_INCOMPLETE";
  error.status = 400;
  error.isCaptureRefusal = true;
  return error;
}

async function politePause() {
  const since = Date.now() - lastCallAt;
  if (since < MIN_GAP_MS) await new Promise((resolve) => setTimeout(resolve, MIN_GAP_MS - since));
  lastCallAt = Date.now();
}

/*
 * A geocoder will happily answer a loose query with a street of the same name in
 * another country. "123 Main St, Long Beach, CA" once came back in Lake Huron,
 * and filming that would have put another town's schools and commutes in the
 * video. So every answer is checked against the state and town we asked for.
 */
const STATES = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california",
  CO: "colorado", CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia",
  HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa",
  KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi",
  MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire",
  NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina",
  ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee",
  TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington",
  WV: "west virginia", WI: "wisconsin", WY: "wyoming", DC: "district of columbia",
};

const flat = (value) => String(value || "").toLowerCase().replace(/[^a-z]/g, "");

/** "illinois" and "IL" both mean IL, so a person can type either. */
const STATE_CODE_BY_NAME = new Map(Object.entries(STATES).map(([code, name]) => [flat(name), code]));

function stateCodeFor(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (STATES[upper]) return upper;
  return STATE_CODE_BY_NAME.get(flat(raw)) || "";
}

/**
 * The address as a person typed it, in the shape the rest of the tool uses.
 *
 * Used when the listing picture was uploaded rather than photographed, so there
 * is no page to read an address off. Nothing here is inferred from the image:
 * the Explorer is pointed at coordinates, and a house number guessed off a
 * screenshot would film another street's schools and commutes while looking
 * entirely convincing. What is typed is what gets looked up.
 *
 * The street is required. The town is not, because the geocoder can still place
 * a distinctive street on its own and says so when it has - but a state that
 * cannot be recognised is refused rather than quietly dropped, since "Peoria, XX"
 * would throw away the one check on the answer being in the right place.
 */
function addressFromFields({ street, city, state, zip } = {}) {
  const tidy = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const streetText = tidy(street);
  const cityText = tidy(city).replace(/,+$/, "");
  const zipText = tidy(zip).replace(/^(\d{5})-\d{4}$/, "$1");
  const stateText = tidy(state);

  if (!streetText) {
    throw addressError(
      "Type the listing's street address. The Neighborhood Explorer is pointed at coordinates, and nothing here reads an address off the picture."
    );
  }
  if (zipText && !/^\d{5}$/.test(zipText)) {
    throw addressError(`"${zipText}" is not a five digit ZIP code. Correct it, or leave it empty.`);
  }

  const stateCode = stateCodeFor(stateText);
  if (stateText && !stateCode) {
    throw addressError(`"${stateText}" is not a US state. Use the two letter code, like IL.`);
  }

  // The shape expectationsFrom parses back out: "City, ST", or just one of them.
  let cityState = "";
  if (cityText && stateCode) cityState = `${cityText}, ${stateCode}`;
  else if (cityText) cityState = cityText;
  else if (stateCode) cityState = stateCode;

  return {
    street: streetText,
    cityState,
    zip: zipText,
    source: "typed",
    // Typed in by somebody looking at the listing, so it is what the video is
    // about - the same standing a heading read off the page would have.
    isSubject: true,
  };
}

/** What the listing said, so an answer can be checked against it. */
function expectationsFrom(address) {
  const cityState = String((address && address.cityState) || "").trim();
  const [cityPart, statePart] = cityState.split(",").map((part) => (part || "").trim());
  const code = (statePart || "").toUpperCase().slice(0, 2);
  return {
    city: flat(cityPart),
    stateCode: STATES[code] ? code : "",
    stateName: STATES[code] || "",
    zip: String((address && address.zip) || "").trim(),
  };
}

/** Is this result actually in the town the listing said it was in? */
function resultMatches(result, expect) {
  const details = result.address || {};
  if (expect.stateName) {
    const state = flat(details.state);
    if (state && state !== flat(expect.stateName)) return false;
    const country = flat(details.country_code || details.country);
    if (country && country !== "us" && country !== "unitedstates") return false;
  }
  if (expect.zip && details.postcode && String(details.postcode).slice(0, 5) === expect.zip) return true;
  if (expect.city) {
    const town = flat(details.city || details.town || details.village || details.hamlet || details.suburb);
    const inName = flat(result.display_name).includes(expect.city);
    if (town === expect.city || inName) return true;
    // A neighbouring town in the right state is close enough for a
    // neighborhood-level fallback, but not for something claiming to be exact.
    return false;
  }
  return Boolean(expect.stateName);
}

async function askNominatim(query, expect, timeoutMs) {
  await politePause();
  const url = `${config.geocoderUrl}?format=json&limit=5&addressdetails=1&q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const results = await response.json();
    if (!Array.isArray(results)) return null;

    for (const result of results) {
      const lat = Number(result.lat);
      const lng = Number(result.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (!resultMatches(result, expect)) continue;
      return { lat, lng, matched: String(result.display_name || query) };
    }
    return null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The queries to try, most precise first.
 *
 * A full street address does not always resolve - "4697 Wehunt Commons Drive SE"
 * is not in OpenStreetMap - and the Explorer is a neighborhood product, so the
 * town and postcode still put it in the right neighborhood. Which one was used
 * is reported back so the job can say so rather than quietly rounding off.
 */
function queriesFor(address) {
  const street = String((address && address.street) || "").trim();
  const cityState = String((address && address.cityState) || "").trim();
  const zip = String((address && address.zip) || "").trim();

  const queries = [];
  const add = (value, precision) => {
    const text = value.replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();
    if (text && !queries.some((entry) => entry.query === text)) queries.push({ query: text, precision });
  };

  if (street && cityState) add(`${street}, ${cityState} ${zip}`, "address");
  if (street && cityState) add(`${street}, ${cityState}`, "address");
  if (street && zip) add(`${street}, ${zip}`, "address");
  // Drop a unit number: "850 E Ocean Boulevard B3" rarely resolves, the street does.
  const withoutUnit = street.replace(/\s+(apt|unit|ste|suite|#)\s*[\w-]+$/i, "").replace(/\s+[A-Z]?\d{1,4}[A-Z]?$/i, "");
  if (withoutUnit && withoutUnit !== street && cityState) add(`${withoutUnit}, ${cityState} ${zip}`, "address");
  if (cityState && zip) add(`${cityState} ${zip}`, "neighborhood");
  if (cityState) add(cityState, "town");

  /*
   * A street on its own, last, when the page gave up no town.
   *
   * There is nothing to check the answer against, so this is the least trusted
   * query and it goes after every other one - but it is worth having. Refusing
   * outright was a dead end: the listing was right there on the page, and the
   * job stopped with "did not give an address to look up".
   */
  if (street && !cityState) {
    add(street, "street-only");
    if (withoutUnit && withoutUnit !== street) add(withoutUnit, "street-only");
  }

  return queries;
}

/**
 * Where on the map this listing is.
 *
 * Refuses rather than guessing: an Explorer walk pinned to the wrong place would
 * put another town's schools and commutes in the video.
 */
async function locateAddress(address, { log = () => {}, timeoutMs = 12000 } = {}) {
  const queries = queriesFor(address);
  if (!queries.length) {
    throw geocodeError(
      "The listing page did not give an address to look up, so the Neighborhood Explorer cannot be pointed at it. Paste a listing URL with a clear street address."
    );
  }

  const expect = expectationsFrom(address);
  for (const { query, precision } of queries) {
    const found = await askNominatim(query, expect, timeoutMs);
    if (!found) continue;
    if (precision === "street-only") {
      // Say so plainly: with no town on the page there was nothing to check the
      // answer against, so whoever reviews the video should look at the map.
      log(`The listing page gave no town, so the Explorer was placed on "${query}" alone - check the map in the review`);
    } else if (precision !== "address") {
      log(`Could not place "${queries[0].query}" exactly, so the Explorer is centred on ${query}`);
    }
    return { ...found, precision, query };
  }

  throw geocodeError(
    `"${queries[0].query}" could not be found on the map, so the Neighborhood Explorer cannot be pointed at it. Try a different listing.`
  );
}

module.exports = { locateAddress, queriesFor, resultMatches, expectationsFrom, addressFromFields, stateCodeFor };
