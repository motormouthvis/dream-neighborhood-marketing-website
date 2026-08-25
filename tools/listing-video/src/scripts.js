"use strict";

/**
 * The two approved narration scripts.
 *
 * Every claim here is one Bill/Myles already approved. Do not add product
 * claims, features, prices or integrations that are not in this file, and do
 * not mention Neighborhood Explorer in the school-only script.
 *
 * scene:
 *   "listing"  - the customer's own page with the popup button in the corner
 *   "se"       - free School Explorer card ("Find Your Dream School")
 *   "ne"       - Neighborhood Explorer card (School + Neighborhood video only)
 */

const VIDEO_TYPES = {
  SCHOOL_ONLY: "school",
  SCHOOL_AND_NEIGHBORHOOD: "school-neighborhood",
};

const VIDEO_TYPE_LABELS = {
  [VIDEO_TYPES.SCHOOL_ONLY]: "School only",
  [VIDEO_TYPES.SCHOOL_AND_NEIGHBORHOOD]: "School + Neighborhood",
};

// Shared opening through "free for life, no credit card". Both scripts use it.
function sharedOpening({ firstName, company }) {
  const name = firstName ? `${firstName}` : "there";
  const site = company ? `${company}` : "your";
  return [
    {
      id: "compliment",
      scene: "listing",
      caption: { headline: "Great listings.", subline: "One thing is missing." },
      text: `Hi ${name}, this is Dream Neighborhood. I was just going through the listings on the ${site} website, and honestly, they look great.`,
    },
    {
      id: "as-is",
      scene: "listing",
      caption: { headline: "Your listing, as-is.", subline: "Nothing moved. Nothing rebuilt." },
      text: "This is one of your listings exactly the way it is today. Nothing moved, nothing rebuilt.",
    },
    {
      id: "no-schools",
      scene: "listing",
      caption: { headline: "A mom lands here.", subline: "She cannot find the schools." },
      text: "But when a mom lands on this page, the one thing she cannot find is the schools.",
    },
    {
      id: "bounce",
      scene: "listing",
      caption: { headline: "So she bounces.", subline: "Zillow. Realtor.com." },
      text: "So she bounces. She goes and looks the schools up on Zillow or Realtor dot com, and now she is shopping on their site instead of yours.",
    },
    {
      id: "same-page",
      scene: "listing",
      caption: { headline: "The same page.", subline: "Now with School Explorer." },
      text: "Here is that exact same page with School Explorer on it.",
    },
    {
      id: "no-redesign",
      scene: "listing",
      caption: { headline: "Zero redesign.", subline: "Your layout. Your branding." },
      text: "Zero redesign. Your layout, your branding, your photos, all untouched.",
    },
    {
      id: "popup",
      scene: "listing",
      caption: { headline: "School Explorer.", subline: "The popup hovers in the bottom right." },
      text: "The popup just hovers down in the bottom right corner of the page.",
    },
    {
      id: "one-line",
      scene: "listing",
      caption: { headline: "One line of code.", subline: "That is the whole install." },
      text: "It is one line of code. That is the whole install.",
    },
    {
      id: "auto-detect",
      scene: "listing",
      caption: { headline: "Auto-detects the address.", subline: "Nothing to tag. Nothing to maintain." },
      text: "It auto-detects the address on the listing, so there is nothing for you to tag and nothing to maintain.",
    },
    {
      id: "we-install",
      scene: "listing",
      caption: { headline: "We install it for you.", subline: "Free." },
      text: "And we install it for you, free.",
    },
    {
      id: "she-taps",
      scene: "listing-tap",
      caption: { headline: "She taps the house.", subline: "Bottom right corner." },
      text: "She taps the little green house in the corner,",
    },
    {
      id: "schools-on-site",
      scene: "se",
      caption: { headline: "School Explorer.", subline: "The schools are on your site now." },
      text: "and the schools come up right there on your site. She never has to leave.",
    },
    {
      id: "free-for-life",
      scene: "se",
      caption: { headline: "School Explorer.", subline: "Free for life. No credit card." },
      text: "School Explorer is free for life. No credit card.",
    },
  ];
}

function schoolOnlyScript(vars) {
  return [
    ...sharedOpening(vars),
    {
      id: "savings",
      scene: "se",
      caption: { headline: "Save $95 to $800 a month.", subline: "Versus other school data providers." },
      text: "And compared to the other school data providers, that is ninety five to eight hundred dollars a month you are not spending.",
    },
    {
      id: "school-expert",
      scene: "se",
      caption: { headline: "Become the school expert.", subline: "In your market." },
      text: "You become the school expert in your market.",
    },
    {
      id: "call",
      scene: "se",
      caption: { headline: "Give us a call.", subline: "We will get it on your site." },
      text: "Give us a call and we will get it on your site.",
    },
  ];
}

function schoolAndNeighborhoodScript(vars) {
  return [
    ...sharedOpening(vars),
    {
      id: "ne-upgrade",
      scene: "ne",
      caption: { headline: "Neighborhood Explorer.", subline: "Map and Summary." },
      text: "And any time you want more, you can upgrade to Neighborhood Explorer. Thirty eight plus neighborhood insights, more than Zillow shows.",
    },
    {
      id: "ne-same-button",
      scene: "ne",
      caption: { headline: "Same button.", subline: "Same corner. Nothing else changes." },
      text: "It is the same button in the same corner. Nothing else on your site changes.",
    },
    {
      id: "ne-expert",
      scene: "ne",
      caption: { headline: "Become the school and neighborhood expert.", subline: "In your market." },
      text: "You become the school and neighborhood expert in your market.",
    },
    {
      id: "call",
      scene: "ne",
      caption: { headline: "Give us a call.", subline: "We will get it on your site." },
      text: "Give us a call and we will get it on your site.",
    },
  ];
}

function buildScript(videoType, vars) {
  return videoType === VIDEO_TYPES.SCHOOL_AND_NEIGHBORHOOD
    ? schoolAndNeighborhoodScript(vars)
    : schoolOnlyScript(vars);
}

/**
 * Plain text of the whole script, for the overdub read-along teleprompter.
 */
function scriptToText(segments) {
  return segments.map((segment) => segment.text).join("\n\n");
}

module.exports = {
  VIDEO_TYPES,
  VIDEO_TYPE_LABELS,
  buildScript,
  scriptToText,
};
