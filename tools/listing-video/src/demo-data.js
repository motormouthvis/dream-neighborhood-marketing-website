"use strict";

/**
 * The demo neighborhood shown inside the School Explorer card, which is the
 * same demo area used in the approved reference video.
 *
 * The Neighborhood Explorer card no longer uses any of this: its tabs are
 * photographed from the live product at the listing's own address.
 */

const DEMO_NEIGHBORHOOD = {
  address: "4697 Wehunt Commons Drive SE",
  cityState: "Smyrna, GA",
  district: "Cobb County School District",
  schoolsNearby: 30,
  students: "20,613",
  addressLineOne: "4697 Wehunt Commons Dr SE",
  addressLineTwo: "Smyrna, GA 30082",
  searchLabel: "4697 Wehunt Commons Drive SE, Smyrna, GA 30082",
};

const DEMO_SCHOOLS = [
  {
    rank: 1,
    score: "4",
    tone: "amber",
    name: "Nickajack Elementary School",
    meta: "Elementary · Grades PK-5",
    rating: "Average",
    ratingTone: "amber",
    distance: "0.5 mi",
  },
  {
    rank: 2,
    score: "2",
    tone: "red",
    name: "Griffin Middle School",
    meta: "Middle · Grades 6-8",
    rating: "Below average",
    ratingTone: "red",
    distance: "1.3 mi",
  },
  {
    rank: 3,
    score: "6",
    tone: "green",
    name: "King Springs Elementary School",
    meta: "Elementary · Grades PK-5",
    rating: "Average",
    ratingTone: "amber",
    distance: "1.3 mi",
  },
  {
    rank: 4,
    score: "NOT RATED",
    tone: "grey",
    private: true,
    name: "Smyrna Montessori School",
    meta: "Private (Nonsectarian) · Grades K",
    rating: "Limited data",
    ratingTone: "grey",
    distance: "1.5 mi",
  },
  {
    rank: 5,
    score: "2",
    tone: "red",
    name: "Betty Gray Middle School",
    meta: "Middle · Grades 6-8",
    rating: "Below average",
    ratingTone: "red",
    distance: "1.6 mi",
  },
  {
    rank: 6,
    score: "5",
    tone: "amber",
    name: "Teasley Elementary School",
    meta: "Elementary · Grades PK-5",
    rating: "Average",
    ratingTone: "amber",
    distance: "2 mi",
  },
  {
    rank: 7,
    score: "3",
    tone: "red",
    name: "Campbell Middle School",
    meta: "Middle · Grades 6-8",
    rating: "Below average",
    ratingTone: "red",
    distance: "2.2 mi",
  },
  {
    rank: 8,
    score: "NOT RATED",
    tone: "grey",
    private: true,
    name: "Covenant Christian School",
    meta: "Private (Religious) · Grades PK-8",
    rating: "Limited data",
    ratingTone: "grey",
    distance: "2.4 mi",
  },
];

/*
 * The seven chips, left to right, spelled as the product spells them.
 *
 * "Map and Summary" is the word "and". "Housing & Market Trends" and
 * "Walk & Bike" are ampersands. Getting that wrong means the chip is never
 * found, so the spelling here is not cosmetic.
 *
 * "Ask AI" is not one of these and is never walked.
 */
const NE_TABS = [
  "Map and Summary",
  "Demographics",
  "Schools",
  "Housing & Market Trends",
  "Commutes",
  "Walk & Bike",
  "What's Nearby",
];

/*
 * What each chip used to be called, and the internal key that did not change.
 *
 * Mobility became "Walk & Bike" and Points of Interest became "What's Nearby",
 * but data-view and the switch ids stayed as they were, so the key is the
 * reliable way in when a label is being flaky. Scripts written against the old
 * names keep working.
 */
const NE_TAB_ALIASES = {
  "Walk & Bike": { key: "mobility", wasCalled: ["Mobility", "Walk and Bike"] },
  "What's Nearby": { key: "points-of-interest", wasCalled: ["Points of Interest"] },
  "Map and Summary": { key: "map-and-summary", wasCalled: ["Map & Summary", "Summary"] },
  Demographics: { key: "demographics", wasCalled: [] },
  Schools: { key: "schools", wasCalled: [] },
  "Housing & Market Trends": { key: "housing-and-market-trends", wasCalled: ["Housing and Market Trends", "Market Trends"] },
  Commutes: { key: "commutes", wasCalled: ["Commute"] },
};

/** The current chip name for whatever a script called it. */
function canonicalTabName(name) {
  const wanted = String(name == null ? "" : name).trim();
  if (!wanted) return "";
  const tidy = (value) => value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  const target = tidy(wanted);
  for (const tab of NE_TABS) {
    if (tidy(tab) === target) return tab;
    const alias = NE_TAB_ALIASES[tab];
    if (alias && alias.wasCalled.some((old) => tidy(old) === target)) return tab;
    if (alias && tidy(alias.key) === target) return tab;
  }
  return wanted;
}

/*
 * There is no stand-in for the Neighborhood Explorer's tab contents any more.
 * Each tab beat is a screenshot of the live product at the listing's own
 * address - see src/explorer.js. NE_TABS is only the official order of the tabs
 * to walk.
 */

module.exports = { DEMO_NEIGHBORHOOD, DEMO_SCHOOLS, NE_TABS, NE_TAB_ALIASES, canonicalTabName };
