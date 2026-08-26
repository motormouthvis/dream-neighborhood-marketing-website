"use strict";

/*
 * The two things that ruined a finished video:
 *   - the tooltip read "032 SQFT 4497 Chase Drive", which is the tail of
 *     "1,032 SQFT" glued onto the next listing's address
 *   - the backdrop was an IDX search page with a map, not a house
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyPage,
  extractAddress,
  looksLikeStreetAddress,
  firstStreetIn,
} = require("../src/page-analysis");

/* ---------------------------------------------------------------- */
/* addresses                                                        */
/* ---------------------------------------------------------------- */

test("square footage is never read as a house number", () => {
  const row = "$1,250,000 4 beds 3 baths 1,032 SQFT 4497 Chase Drive Smyrna, GA 30082";
  assert.equal(firstStreetIn(row), "4497 Chase Drive");

  assert.equal(looksLikeStreetAddress("032 SQFT 4497 Chase Drive"), false);
  assert.equal(looksLikeStreetAddress("1,032 SQFT 4497 Chase Drive"), false);
  assert.equal(looksLikeStreetAddress("2140 SQFT Lane"), false);
});

test("a house number with a leading zero is not a house number", () => {
  assert.equal(looksLikeStreetAddress("032 Chase Drive"), false);
  assert.equal(looksLikeStreetAddress("32 Chase Drive"), true);
});

test("beds, baths and prices cannot end up inside an address", () => {
  assert.equal(firstStreetIn("3 beds 2 baths"), "");
  assert.equal(firstStreetIn("4 bd 3 ba 2,410 sq ft"), "");
  assert.equal(looksLikeStreetAddress("4 Beds Lane"), false);
  assert.equal(looksLikeStreetAddress("$525,000 Main Street"), false);
});

test("real addresses still come through, including directions and long names", () => {
  assert.equal(firstStreetIn("4697 Wehunt Commons Drive SE"), "4697 Wehunt Commons Drive SE");
  assert.equal(firstStreetIn("Listed at 222 Second Ave SE today"), "222 Second Ave SE");
  assert.equal(firstStreetIn("1 Rockefeller Plaza"), "1 Rockefeller Plaza");
  assert.equal(firstStreetIn("815 N Larkspur Lane"), "815 N Larkspur Lane");
  assert.equal(firstStreetIn("22 Monterey Court, Smyrna"), "22 Monterey Court");
});

test("the page's own structured data is trusted before its body text", () => {
  const facts = {
    url: "https://patty.test/listings/4497-chase-drive",
    h1s: ["4497 Chase Drive"],
    jsonLd: [
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SingleFamilyResidence",
        address: {
          "@type": "PostalAddress",
          streetAddress: "4497 Chase Drive",
          addressLocality: "Smyrna",
          addressRegion: "GA",
          postalCode: "30082",
        },
      }),
    ],
    bodyText: "1,032 SQFT 4497 Chase Drive Smyrna, GA 30082",
  };
  const address = extractAddress(facts);
  assert.equal(address.source, "json-ld");
  assert.equal(address.street, "4497 Chase Drive");
  assert.equal(address.cityState, "Smyrna, GA");
  assert.equal(address.zip, "30082");
});

test("structured data that is really square footage is ignored", () => {
  const facts = {
    jsonLd: [JSON.stringify({ "@type": "Product", address: { streetAddress: "1,032 SQFT" } })],
    h1s: ["4497 Chase Drive"],
    bodyText: "4497 Chase Drive",
  };
  const address = extractAddress(facts);
  assert.equal(address.street, "4497 Chase Drive");
  assert.equal(address.source, "heading");
});

test("no address at all is reported as none, not as a guess", () => {
  const address = extractAddress({ url: "https://patty.test/", h1s: ["Welcome to Patty Realty"], bodyText: "We sell homes." });
  assert.equal(address.street, "");
  assert.equal(address.source, "none");
});

/* ---------------------------------------------------------------- */
/* search pages versus one listing                                  */
/* ---------------------------------------------------------------- */

const SEARCH_PAGE = {
  url: "https://patty.test/search?city=smyrna&beds=3",
  title: "Property Search - Patty Realty",
  h1s: ["What Are You Looking for in a Home or Condo Today?"],
  jsonLd: [],
  microdata: {},
  bodyText:
    "What Are You Looking for in a Home or Condo Today? Add Another Location Price Beds Baths " +
    "Advanced Search 5 Filters Applied Save Search Reset Draw Search in Map Newest Listings Hide Map " +
    "$1,250,000 4 beds 3 baths 1,032 SQFT 4497 Chase Drive $625,000 3 beds 2 baths 2,140 SQFT " +
    "815 Larkspur Lane $899,000 5 beds 4 baths 22 Monterey Court",
  priceCount: 4,
  listingLinkCount: 12,
  addressCount: 4,
  mapAreaFraction: 0.42,
  searchInputCount: 6,
  galleryImageCount: 0,
  hasBeds: true,
  hasBaths: true,
  hasSqft: true,
  mlsId: "",
};

const DETAIL_PAGE = {
  url: "https://patty.test/listings/4497-chase-drive",
  title: "4497 Chase Drive - Patty Realty",
  h1s: ["4497 Chase Drive"],
  jsonLd: [
    JSON.stringify({
      "@type": "SingleFamilyResidence",
      address: { "@type": "PostalAddress", streetAddress: "4497 Chase Drive", addressLocality: "Smyrna", addressRegion: "GA" },
    }),
  ],
  microdata: {},
  bodyText: "4497 Chase Drive Smyrna, GA 30082 $1,250,000 4 beds 3 baths 1,032 SQFT MLS # 7412998 A lovely home",
  priceCount: 1,
  listingLinkCount: 0,
  addressCount: 1,
  mapAreaFraction: 0,
  searchInputCount: 0,
  galleryImageCount: 4,
  hasBeds: true,
  hasBaths: true,
  hasSqft: true,
  mlsId: "7412998",
};

test("the search page that broke the video is rejected", () => {
  const verdict = classifyPage(SEARCH_PAGE);
  assert.equal(verdict.kind, "search");
  assert.ok(verdict.reasons.length >= 2, `expected reasons, got ${JSON.stringify(verdict.reasons)}`);
});

test("a search page is still rejected when its results contain a street-like string", () => {
  // "1,032 SQFT 4497 Chase Drive" is exactly the string that fooled the old code.
  const verdict = classifyPage({ ...SEARCH_PAGE, mapAreaFraction: 0, searchInputCount: 0 });
  assert.equal(verdict.kind, "search");
});

test("one listing detail page is accepted", () => {
  const verdict = classifyPage(DETAIL_PAGE);
  assert.equal(verdict.kind, "detail");
  assert.equal(verdict.address.street, "4497 Chase Drive");
});

test("a listing page keeps its verdict even with a location map and similar homes on it", () => {
  const verdict = classifyPage({
    ...DETAIL_PAGE,
    mapAreaFraction: 0.25,
    priceCount: 4,
    listingLinkCount: 9,
    bodyText: `${DETAIL_PAGE.bodyText} Similar homes for sale in Smyrna`,
  });
  assert.equal(verdict.kind, "detail");
});

test("a homepage and a bare listings index are neither", () => {
  const home = classifyPage({
    url: "https://patty.test/",
    h1s: ["Welcome to Patty Realty"],
    jsonLd: [],
    bodyText: "Welcome to Patty Realty. Search homes and condos across the South Bay.",
    priceCount: 0,
  });
  assert.equal(home.kind, "other");

  const index = classifyPage({
    url: "https://patty.test/listings",
    h1s: ["Our listings"],
    jsonLd: [],
    bodyText: "Our listings 123 Main Street $500,000 456 Oak Avenue $600,000 789 Pine Road $700,000",
    priceCount: 3,
    listingLinkCount: 3,
    addressCount: 3,
  });
  assert.ok(index.kind === "index" || index.kind === "search", `got ${index.kind}`);
});
