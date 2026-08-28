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
    if (precision !== "address") {
      log(`Could not place "${queries[0].query}" exactly, so the Explorer is centred on ${query}`);
    }
    return { ...found, precision, query };
  }

  throw geocodeError(
    `"${queries[0].query}" could not be found on the map, so the Neighborhood Explorer cannot be pointed at it. Try a different listing.`
  );
}

module.exports = { locateAddress, queriesFor, resultMatches, expectationsFrom };
