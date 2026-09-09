"use strict";

/**
 * The seven Neighborhood Explorer chips, and what they used to be called.
 *
 * Nothing here is stand-in data for a card any more. Both Explorers in the
 * video are photographed from the live product at the listing's own address -
 * see src/explorer.js and src/school-explorer.js - so the only thing this file
 * still knows is what the chips are called and the order they are walked in.
 *
 * The eight Smyrna, Georgia schools that used to live here are gone with the
 * drawn School Explorer card that used them. They were the neighborhood from the
 * approved reference video, and because they were fixed, every video ever made
 * showed Cobb County's schools whatever address it was about.
 */

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
  "What's Nearby": { key: "points-of-interest", wasCalled: ["Points of Interest", "POI"] },
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

module.exports = { NE_TABS, NE_TAB_ALIASES, canonicalTabName };
