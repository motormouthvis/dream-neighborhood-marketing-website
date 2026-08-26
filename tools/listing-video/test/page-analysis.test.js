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
  assert.equal(home.kind, "marketing");
  assert.match(home.reasons[0], /homepage/i);

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

/* ---------------------------------------------------------------- */
/* the city landing page that got filmed                            */
/* ---------------------------------------------------------------- */

/*
 * Job 5deda2f2db3fc093bb built a video on this page. It is a marketing landing
 * page: a marina hero, "Search Long Beach Homes" / "Long Beach Market Report" /
 * "Custom List Of Homes" buttons, and the Fathom office address in the footer,
 * which is where the tooltip's "2135 Bellflower Blvd" came from.
 */
const FATHOM_LANDING_PAGE = {
  url: "https://fathomlongbeach.test/long-beach-real-estate",
  title: "Long Beach Real Estate & Homes For Sale",
  ogTitle: "Long Beach Real Estate & Homes For Sale",
  h1s: ["Long Beach Real Estate & Homes For Sale", "Popular Long Beach Home Types:"],
  jsonLd: [],
  microdata: {},
  addressCandidates: [
    { text: "Long Beach Real Estate & Homes For Sale", where: "heading", inFooter: false },
    { text: "2135 Bellflower Blvd, Long Beach, CA 90815", where: "address-element", inFooter: true },
  ],
  mainText:
    "Long Beach Real Estate & Homes For Sale We help Long Beach buyers find the right home without stress or " +
    "confusion. And sellers too. Search Long Beach Homes Long Beach Market Report Custom List Of Homes " +
    "Long Beach real estate offers one of the most diverse housing markets in Southern California, with beachfront " +
    "homes, walkable urban neighborhoods, quiet residential streets, and condo communities near shopping and dining. " +
    "If you're exploring Long Beach homes or Long Beach condos, this guide gives you a clear, local overview of the " +
    "neighborhoods, lifestyle options, and homes currently for sale - all updated daily from the MLS. " +
    "Popular Long Beach Home Types: Single-family homes near the beach and coastal trails. Condos and lofts in " +
    "walkable urban neighborhoods. Townhomes and gated communities with modern amenities.",
  footerText: "Fathom Realty 2135 Bellflower Blvd, Long Beach, CA 90815 +1 (562) 413-7655 3 bedroom and 2 bathroom homes",
  bodyText: "Long Beach Real Estate & Homes For Sale ... 2135 Bellflower Blvd Long Beach, CA 90815",
  specRowText: "",
  ctaLabels: ["Search Long Beach Homes", "Long Beach Market Report", "Custom List Of Homes"],
  hasHeroBanner: true,
  priceCount: 0,
  mainPriceCount: 0,
  listingLinkCount: 4,
  addressCount: 0,
  mapAreaFraction: 0,
  searchInputCount: 1,
  galleryImageCount: 5,
  hasBeds: true,
  hasBaths: true,
  hasSqft: false,
  mlsId: "",
};

test("the city landing page that got filmed is refused", () => {
  const verdict = classifyPage(FATHOM_LANDING_PAGE);
  assert.equal(verdict.kind, "marketing");
  assert.ok(verdict.reasons.length >= 1, JSON.stringify(verdict.reasons));
});

test("an office address in the footer is never the page's subject", () => {
  const address = extractAddress(FATHOM_LANDING_PAGE);
  // It can still be read for a tooltip, but it does not make this a listing.
  assert.equal(address.isSubject, false);
  assert.notEqual(address.source, "address-element");

  // And with the footer skipped, the city is the city, not the street.
  const office = extractAddress({
    jsonLd: [],
    addressCandidates: [{ text: "123 Main St", where: "heading", inFooter: false }],
    mainText: "123 Main St Long Beach, CA 90815",
  });
  assert.equal(office.street, "123 Main St");
  assert.equal(office.cityState, "Long Beach, CA");
  assert.equal(office.isSubject, true);
});

test("photos plus the words bed and bath somewhere are not a listing", () => {
  // Exactly the two signals that were enough before.
  const verdict = classifyPage({
    url: "https://fathomlongbeach.test/long-beach-real-estate",
    h1s: ["Long Beach Real Estate"],
    jsonLd: [],
    addressCandidates: [{ text: "Long Beach Real Estate", where: "heading", inFooter: false }],
    mainText: "Long Beach Real Estate. 3 bedroom and 2 bathroom homes are the most common. 2135 Bellflower Blvd",
    galleryImageCount: 6,
    hasBeds: true,
    hasBaths: true,
    specRowText: "",
    ctaLabels: [],
    mainPriceCount: 0,
  });
  assert.notEqual(verdict.kind, "detail");
});

test("an office address is not accepted from the page's own structured data", () => {
  const address = extractAddress({
    jsonLd: [
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "RealEstateAgent",
        name: "Fathom Realty Long Beach",
        address: {
          "@type": "PostalAddress",
          streetAddress: "2135 Bellflower Blvd",
          addressLocality: "Long Beach",
          addressRegion: "CA",
        },
      }),
    ],
    addressCandidates: [],
    mainText: "Long Beach Real Estate & Homes For Sale",
  });
  assert.equal(address.street, "", "an agent's office address is not the listing address");
});

test("market report, blog and contact pages are never listings", () => {
  for (const path of ["/market-report", "/blog", "/about", "/contact", "/home-value", "/"]) {
    const verdict = classifyPage({
      url: `https://patty.test${path}`,
      h1s: ["123 Main Street"],
      jsonLd: [],
      addressCandidates: [{ text: "123 Main Street", where: "heading", inFooter: false }],
      mainText: "123 Main Street $925,000 4 beds 3 baths MLS # PW123456 Year Built 1962 Lot Size 6,200",
      specRowText: "4 beds 3 baths 2,410 sq ft",
      mlsId: "PW123456",
      mainPriceCount: 1,
      hasBeds: true,
      hasBaths: true,
      galleryImageCount: 4,
    });
    assert.notEqual(verdict.kind, "detail", `${path} should never be filmed`);
  }
});
