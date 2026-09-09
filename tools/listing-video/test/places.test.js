"use strict";

/*
 * The address on the upload path, and where it comes from.
 *
 * Bill uploaded a screenshot of a listing at 6031 N Rosemead Dr, Peoria, IL,
 * typed the address into four free-text boxes, and the video came back with
 * schools in Smyrna, Georgia in it. Part of that was the School Explorer being a
 * drawing - see school-explorer.test.js. This is the other part: a typed address
 * was not checked against anything until a job was already running, and a
 * geocoder will answer a loose query with a street of the same name elsewhere.
 *
 * So the form uses the Neighborhood Explorer's own picker - the same suggestions
 * and the same geocoder its search box uses - and the address is resolved before
 * the job exists. These cover that, with the Explorer's answers stubbed so they
 * run offline.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.LISTING_VIDEO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-places-"));
process.env.LISTING_VIDEO_TOKEN = "test-token";

const config = require("../src/config");
const { suggestPlaces, resolvePlace, splitPlace } = require("../src/places");
const { addressFromFields, confirmAddress, locateAddress, formattedMatches } = require("../src/geocode");

const realFetch = global.fetch;

/** The Explorer's autocomplete answer for Bill's address. */
const ROSEMEAD_SUGGESTIONS = {
  suggestions: [
    { description: "6031 N Rosemead Dr, Peoria, IL 61614", main_text: "6031 N Rosemead Dr", secondary_text: "Peoria, IL 61614" },
    { description: "6031 N Rosemary Ct, Peoria, IL 61614", main_text: "6031 N Rosemary Ct", secondary_text: "Peoria, IL 61614" },
  ],
};

const ROSEMEAD_POINT = {
  success: true,
  lat: 40.76117841579057,
  lng: -89.61833048148893,
  formatted_address: "6031 N Rosemead Dr, Peoria, IL 61614",
  source: "tiger",
};

/**
 * Stand in for the Explorer's own endpoints, and write down what was asked.
 *
 * `answers` is keyed by the last part of the path, so a test says what the
 * Explorer said and nothing here has to know the URL.
 */
function stubExplorer(answers) {
  const asked = [];
  global.fetch = async (url, options) => {
    const text = String(url);
    const body = JSON.parse((options && options.body) || "{}");
    asked.push({ url: text, body });

    const key = Object.keys(answers).find((name) => text.includes(name));
    if (!key) throw new Error(`nothing stubbed for ${text}`);
    const answer = answers[key];
    if (answer === "unreachable") throw new Error("connect ECONNREFUSED");
    return { ok: true, json: async () => answer };
  };
  return asked;
}

test.afterEach(() => {
  global.fetch = realFetch;
});

test.after(() => {
  fs.rmSync(process.env.LISTING_VIDEO_DATA_DIR, { recursive: true, force: true });
});

/* ---------------------------------------------------------------- */
/* the picker is the Explorer's, not a second one                    */
/* ---------------------------------------------------------------- */

test("the picker's endpoints are the Explorer's own, beside its widget", () => {
  // Not a parallel service: move LISTING_VIDEO_EXPLORER_URL to staging and the
  // suggestions and the geocoder move with it.
  assert.equal(config.places.suggestUrl, `${config.explorer.widgetUrl}autocomplete/`);
  assert.equal(config.places.resolveUrl, `${config.explorer.widgetUrl}geocode/`);
});

test("what is typed is asked of the Explorer's autocomplete", async () => {
  const asked = stubExplorer({ "autocomplete/": ROSEMEAD_SUGGESTIONS });
  const found = await suggestPlaces("6031 N Rosem");

  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, config.places.suggestUrl);
  assert.equal(asked[0].body.query, "6031 N Rosem");
  // The same radius the Explorer's own search box asks for.
  assert.equal(asked[0].body.radius, 50000);

  assert.equal(found.reachable, true);
  assert.equal(found.suggestions.length, 2);
  assert.equal(found.suggestions[0].description, "6031 N Rosemead Dr, Peoria, IL 61614");
  // Split into the shape the rest of the tool uses, so nothing has to parse the
  // description again.
  assert.deepEqual(
    { ...found.suggestions[0], description: undefined },
    { description: undefined, street: "6031 N Rosemead Dr", city: "Peoria", state: "IL", zip: "61614" }
  );
});

test("a couple of letters is not a street, so the Explorer is not asked", async () => {
  const asked = stubExplorer({ "autocomplete/": ROSEMEAD_SUGGESTIONS });
  const found = await suggestPlaces("60");
  assert.deepEqual(found.suggestions, []);
  assert.equal(found.asked, false);
  assert.equal(asked.length, 0, "nothing should have been asked");
});

/*
 * A picker that cannot be reached must not look like a picker with no answers.
 * "No suggestions" would leave somebody typing into a box that had quietly
 * stopped working; the form says which so they can type the whole address.
 */
test("an unreachable picker says so rather than answering with nothing", async () => {
  stubExplorer({ "autocomplete/": "unreachable" });
  const found = await suggestPlaces("6031 N Rosemead Dr");
  assert.deepEqual(found.suggestions, []);
  assert.equal(found.asked, true);
  assert.equal(found.reachable, false);
});

test("a description on its own can still be split back up", () => {
  assert.deepEqual(splitPlace("6031 N Rosemead Dr, Peoria, IL 61614"), {
    street: "6031 N Rosemead Dr",
    city: "Peoria",
    state: "IL",
    zip: "61614",
  });
  // A town with no street, which is what the picker offers for "Peoria, IL".
  assert.deepEqual(splitPlace("Peoria, IL"), { street: "", city: "Peoria", state: "IL", zip: "" });
  assert.deepEqual(splitPlace(""), { street: "", city: "", state: "", zip: "" });
});

/* ---------------------------------------------------------------- */
/* resolving is the Explorer's geocoder, not ours                    */
/* ---------------------------------------------------------------- */

test("a chosen place is resolved by the Explorer's own geocoder", async () => {
  const asked = stubExplorer({ "geocode/": ROSEMEAD_POINT });
  const placed = await resolvePlace("6031 N Rosemead Dr, Peoria, IL 61614");

  assert.equal(asked[0].url, config.places.resolveUrl);
  assert.equal(asked[0].body.address, "6031 N Rosemead Dr, Peoria, IL 61614");
  assert.equal(placed.lat, ROSEMEAD_POINT.lat);
  assert.equal(placed.lng, ROSEMEAD_POINT.lng);
  assert.equal(placed.formattedAddress, "6031 N Rosemead Dr, Peoria, IL 61614");
});

test("an address the Explorer does not know is refused, not guessed at", async () => {
  stubExplorer({ "geocode/": { success: false, error: "Address not found." } });
  await assert.rejects(
    () => resolvePlace("zzqq nowhere street, Narnia"),
    (error) => {
      assert.equal(error.code, "PLACE_NOT_FOUND");
      assert.equal(error.status, 400);
      assert.match(error.message, /pick one of the suggestions/i);
      return true;
    }
  );
});

/* Reached-and-does-not-know is a form to send back. Cannot-be-reached is not. */
test("a geocoder that cannot be reached is not the same as one that says no", async () => {
  stubExplorer({ "geocode/": "unreachable" });
  assert.equal(await resolvePlace("6031 N Rosemead Dr, Peoria, IL 61614"), null);
});

/* ---------------------------------------------------------------- */
/* settling the address before the job exists                        */
/* ---------------------------------------------------------------- */

test("a picked address is settled on the form, before anything is filmed", async () => {
  stubExplorer({ "geocode/": ROSEMEAD_POINT });
  const address = await confirmAddress(
    addressFromFields({
      street: "6031 N Rosemead Dr",
      city: "Peoria",
      state: "IL",
      zip: "61614",
      place: "6031 N Rosemead Dr, Peoria, IL 61614",
    })
  );

  assert.equal(address.place, "6031 N Rosemead Dr, Peoria, IL 61614");
  assert.equal(address.lat, ROSEMEAD_POINT.lat);
  assert.equal(address.lng, ROSEMEAD_POINT.lng);
  assert.equal(address.cityState, "Peoria, IL");
});

/*
 * The wrong-town answer, which is the shape of Bill's bug.
 *
 * The Explorer's geocoder is US-only, so it will not put a Peoria listing in
 * another country - but "123 Main St, Long Beach, CA" comes back in El Segundo,
 * and filming that would put another town's schools in the video.
 */
test("free text that resolves to another town is refused on the form", async () => {
  stubExplorer({
    "geocode/": {
      success: true,
      lat: 33.916722,
      lng: -118.415982,
      formatted_address: "123 MAIN ST, EL SEGUNDO, CA, 90245",
    },
  });

  await assert.rejects(
    () => confirmAddress(addressFromFields({ street: "123 Main St", city: "Long Beach", state: "CA" })),
    (error) => {
      assert.equal(error.code, "ADDRESS_INCOMPLETE");
      assert.equal(error.status, 400);
      assert.match(error.message, /EL SEGUNDO/i);
      assert.match(error.message, /not the town you typed/i);
      return true;
    }
  );
});

test("free text that resolves to the town that was typed is kept", async () => {
  stubExplorer({ "geocode/": ROSEMEAD_POINT });
  const address = await confirmAddress(
    addressFromFields({ street: "6031 N Rosemead Dr", city: "Peoria", state: "IL", zip: "61614" })
  );
  assert.equal(address.lat, ROSEMEAD_POINT.lat);
});

/*
 * The form must not be a dead end because a host had a bad minute: the address
 * goes on as typed and is looked up again at render time, where the town check
 * and Nominatim are both still there.
 */
test("an unreachable geocoder does not block the form", async () => {
  stubExplorer({ "geocode/": "unreachable" });
  const address = await confirmAddress(
    addressFromFields({ street: "6031 N Rosemead Dr", city: "Peoria", state: "IL", zip: "61614" })
  );
  assert.equal(address.lat, undefined);
  assert.equal(address.street, "6031 N Rosemead Dr");
});

test("the town is checked against what came back, whichever geocoder answered", () => {
  const peoria = { city: "peoria", stateCode: "IL", stateName: "illinois", zip: "61614" };
  assert.equal(formattedMatches("6031 N Rosemead Dr, Peoria, IL 61614", peoria), true);
  assert.equal(formattedMatches("6031 N Rosemead Dr, Smyrna, GA 30082", peoria), false);
  assert.equal(formattedMatches("123 MAIN ST, EL SEGUNDO, CA, 90245", peoria), false);
});

/* ---------------------------------------------------------------- */
/* the resolved place is what gets filmed                            */
/* ---------------------------------------------------------------- */

/*
 * The point of settling it on the form: the coordinates the person saw resolved
 * are the coordinates both Explorers are filmed at. Nothing is looked up twice,
 * so nothing can come back differently the second time.
 */
test("a settled address is filmed where the form resolved it, with no second lookup", async () => {
  global.fetch = async () => {
    throw new Error("nothing should be looked up again");
  };

  const where = await locateAddress({
    street: "6031 N Rosemead Dr",
    cityState: "Peoria, IL",
    zip: "61614",
    place: "6031 N Rosemead Dr, Peoria, IL 61614",
    lat: ROSEMEAD_POINT.lat,
    lng: ROSEMEAD_POINT.lng,
  });

  assert.equal(where.lat, ROSEMEAD_POINT.lat);
  assert.equal(where.lng, ROSEMEAD_POINT.lng);
  assert.equal(where.precision, "address");
  assert.equal(where.matched, "6031 N Rosemead Dr, Peoria, IL 61614");
});

test("a place picked before it was resolved is resolved at render time", async () => {
  stubExplorer({ "geocode/": ROSEMEAD_POINT });
  const where = await locateAddress({
    street: "6031 N Rosemead Dr",
    cityState: "Peoria, IL",
    zip: "61614",
    place: "6031 N Rosemead Dr, Peoria, IL 61614",
  });
  assert.equal(where.lat, ROSEMEAD_POINT.lat);
  assert.equal(where.precision, "address");
});

/*
 * The Explorer's geocoder is asked before Nominatim, because it is the one that
 * decides what the Explorer shows - and it places addresses OpenStreetMap has
 * never heard of. "4697 Wehunt Commons Drive SE" is the one from the reference
 * video, and Nominatim does not have it.
 */
test("the Explorer's geocoder is asked before OpenStreetMap", async () => {
  const asked = stubExplorer({
    "geocode/": {
      success: true,
      lat: 33.84210076814585,
      lng: -84.50691549697841,
      formatted_address: "4697 Wehunt Commons Drive SE, Smyrna, GA 30082",
    },
    "nominatim": { ok: false },
  });

  const where = await locateAddress({
    street: "4697 Wehunt Commons Drive SE",
    cityState: "Smyrna, GA",
    zip: "30082",
  });

  assert.equal(where.precision, "address");
  assert.equal(where.lat, 33.84210076814585);
  assert.equal(asked.length, 1, "OpenStreetMap should not have been needed");
  assert.equal(asked[0].url, config.places.resolveUrl);
});
