"use strict";

/**
 * The Neighborhood Explorer's own place picker.
 *
 * Bill uploaded a screenshot of a Peoria listing, typed the address into four
 * free-text boxes, and got a video whose School Explorer showed schools in
 * Smyrna, Georgia. Part of that was the School Explorer being a drawing (see
 * src/school-explorer.js); the other part was this: a typed address was a guess
 * until a geocoder was asked about it, and a geocoder will answer a loose query
 * with a street of the same name in another state.
 *
 * The Explorer already solved this. Its search box asks its own server for
 * suggestions as you type, and resolves the one you pick. Both are plain
 * unauthenticated POSTs on the widget's own host:
 *
 *   POST <widget>/autocomplete/  {query, lat, lng, radius} -> {suggestions:[...]}
 *   POST <widget>/geocode/       {address}                  -> {success, lat, lng, formatted_address}
 *
 * So there is no second picker here and no second geocoder: the address chosen
 * on the form is a place the Explorer itself named, and the coordinates behind it
 * are the ones the Explorer would use. Whatever this resolves is what both
 * Explorers are filmed at.
 *
 * These are called from the server rather than the browser, so the tool stays one
 * origin and a staging box can be pointed at a staging Explorer with
 * LISTING_VIDEO_EXPLORER_URL without CORS coming into it.
 */

const config = require("./config");

const TIMEOUT_MS = 9000;
// The radius the Explorer's own search box asks for, so suggestions near the
// map's centre come back in the same order they would there.
const NEARBY_RADIUS_M = 50000;
const MAX_SUGGESTIONS = 6;

/** A place that cannot be used, answered on the request rather than failing a job. */
function placeError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.isCaptureRefusal = true;
  return error;
}

async function postJson(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    // Unreachable, refused, or slow. The caller decides what that means: a form
    // must not be blocked because the Explorer's host had a bad minute.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const tidy = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

/**
 * Split one of the picker's descriptions into the parts the rest of the tool
 * uses.
 *
 * The picker hands back "6031 N Rosemead Dr" and "Peoria, IL 61614" already
 * separated, and the full description is the two joined - so this is only needed
 * for a description that arrived on its own, from an older form or from a job
 * saved before the picker existed.
 */
function splitPlace(description) {
  const text = tidy(description);
  if (!text) return { street: "", city: "", state: "", zip: "" };

  const parts = text.split(",").map(tidy).filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const stateZip = last.match(/^([A-Za-z]{2})(?:\s+(\d{5}))?(?:-\d{4})?$/);

  if (!stateZip) return { street: parts[0] || text, city: parts[1] || "", state: "", zip: "" };
  return {
    street: parts.length > 2 ? parts.slice(0, parts.length - 2).join(", ") : "",
    city: parts.length > 2 ? parts[parts.length - 2] : parts[0] || "",
    state: stateZip[1].toUpperCase(),
    zip: stateZip[2] || "",
  };
}

/**
 * What the Explorer would offer for what has been typed so far.
 *
 * An empty list is a real answer - "nothing matches that" - and so is an empty
 * list from an unreachable picker. The form says which, so nobody is left staring
 * at a box that has quietly stopped suggesting.
 */
async function suggestPlaces(query, { lat = null, lng = null, timeoutMs = TIMEOUT_MS } = {}) {
  const text = tidy(query);
  // Two letters is not a street. The Explorer's own box waits too.
  if (text.length < 3) return { suggestions: [], asked: false, reachable: true };

  const body = { query: text, radius: NEARBY_RADIUS_M };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    body.lat = lat;
    body.lng = lng;
  }

  const answer = await postJson(config.places.suggestUrl, body, timeoutMs);
  if (!answer) return { suggestions: [], asked: true, reachable: false };

  const suggestions = (Array.isArray(answer.suggestions) ? answer.suggestions : [])
    .map((entry) => {
      const description = tidy(entry && entry.description);
      if (!description) return null;
      const street = tidy(entry.main_text);
      const rest = tidy(entry.secondary_text);
      const parts = street && rest ? { street, ...splitPlace(`${street}, ${rest}`) } : splitPlace(description);
      return {
        description,
        street: parts.street || street,
        city: parts.city,
        state: parts.state,
        zip: parts.zip,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_SUGGESTIONS);

  return { suggestions, asked: true, reachable: true };
}

/**
 * Where the Explorer puts this place.
 *
 * Returns null when the picker could not be reached at all, and throws when it
 * was reached and does not know the address - the difference matters. A form
 * should not be refused because a host was down, but it must be refused for an
 * address the Explorer cannot place, because that is a video of the wrong town.
 */
async function resolvePlace(description, { timeoutMs = TIMEOUT_MS } = {}) {
  const address = tidy(description);
  if (!address) {
    throw placeError("PLACE_EMPTY", "There is no address to look up.");
  }

  const answer = await postJson(config.places.resolveUrl, { address }, timeoutMs);
  if (!answer) return null;

  const lat = Number(answer.lat);
  const lng = Number(answer.lng);
  if (!answer.success || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw placeError(
      "PLACE_NOT_FOUND",
      `The Explorer cannot place "${address}", so it cannot be filmed there. Start typing the address again and pick one of the suggestions.`
    );
  }

  return {
    lat,
    lng,
    formattedAddress: tidy(answer.formatted_address) || address,
    source: tidy(answer.source) || "",
  };
}

module.exports = {
  suggestPlaces,
  resolvePlace,
  splitPlace,
  placeError,
  NEARBY_RADIUS_M,
  MAX_SUGGESTIONS,
};
