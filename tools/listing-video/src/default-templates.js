"use strict";

/**
 * The shipped script templates: the two approved v11 videos, and the upgrade
 * pitch for customers who already have School Explorer.
 *
 * These are seeded onto disk so Bill and Myles can edit them from the Scripts
 * page. The copy here is the approved sales copy - do not reword a spoken line,
 * do not add a product claim, price or integration that is not already in one of
 * these scripts, and never mention Neighborhood Explorer in the school-only
 * template.
 *
 * "seconds" on each beat is the suggested picture length from the v11 cut. The
 * group totals it was split from are noted above each template, so anyone
 * editing can see how much slack they are working with.
 *
 * scene:
 *   "listing"     - the customer's own listing page with the popup house button
 *   "listing-tap" - the same page with the house button highlighted
 *   "se"          - School Explorer card
 *   "ne"          - Neighborhood Explorer card (se-ne templates only)
 *
 * A "ne" beat can name the tab it shows. Left unnamed, tabs are handed out in
 * the order the beats appear.
 */

/*
 * vanessa-se-only-v11 group totals from the v11 school-only cut:
 *   15.9s listing as-is | 5.8s bounce | 18.6s same page + popup + one line +
 *   install | 21.4s SE + free for life + $95-$800 + school expert + call
 * Total 61.7s.
 */
const SCHOOL_ONLY = {
  id: "vanessa-se-only-v11",
  name: "School only (v11)",
  explorers: "se",
  notes:
    "Matches the approved v11 school-only video. No Neighborhood Explorer anywhere in this script.",
  beats: [
    {
      scene: "listing",
      seconds: 8.7,
      text:
        "Hey {firstName}, Claire from Dream Neighborhood. I was looking at {company}. Your listing format looks really good!",
      caption: { headline: "Your listing format looks really good.", subline: "Here is one of them, as it is today." },
    },
    {
      scene: "listing",
      seconds: 7.2,
      text: "Take a look at this one, as it is today. A mom opens it... and there's nothing here about schools.",
      caption: { headline: "A mom opens it.", subline: "There is nothing here about schools." },
    },
    {
      scene: "listing",
      seconds: 5.8,
      text: "So she bounces. She goes to Zillow, or Realtor.com. And you lose her.",
      caption: { headline: "So she bounces.", subline: "Zillow. Realtor.com. And you lose her." },
    },
    {
      scene: "listing",
      seconds: 12.0,
      text:
        "Here's the same page, with the Dream Neighborhood School Explorer. Zero website redesign! The popup icon hovers in the bottom right corner. It's one line of code.",
      caption: { headline: "The same page, with School Explorer.", subline: "Zero website redesign. One line of code." },
    },
    {
      scene: "listing",
      seconds: 6.6,
      text: "We auto-detect the listing address on every page. And we'll install it for you, for free.",
      caption: { headline: "We auto-detect the listing address.", subline: "And we install it for you, free." },
    },
    {
      scene: "listing-tap",
      seconds: 2.8,
      text: "She taps the little house in the corner,",
      caption: { headline: "She taps the little house.", subline: "Bottom right corner." },
    },
    {
      scene: "se",
      seconds: 3.9,
      text: "and schools come up right on your site. She never left.",
      caption: { headline: "Schools, right on your site.", subline: "She never left." },
    },
    {
      scene: "se",
      seconds: 9.2,
      text:
        "The School Explorer is free for life. No credit card required. You'll save $95 to $800 a month versus other school data providers.",
      caption: { headline: "Free for life. No credit card.", subline: "Save $95 to $800 a month versus other school data providers." },
    },
    {
      scene: "se",
      seconds: 5.5,
      text: "Become not just the home expert, but the school expert as well. Give us a call!",
      caption: { headline: "Become the school expert too.", subline: "Give us a call." },
    },
  ],
};

/*
 * vanessa-se-ne-v11 group totals from the v11 SE+NE cut:
 *   14.7s listing as-is | 5.7s bounce | 17.1s same page + popup + one line +
 *   install | 9.7s SE + free for life | seven Neighborhood Explorer tab beats
 *   at 2.6s each. Total 65.4s.
 */
const SCHOOL_AND_NEIGHBORHOOD = {
  id: "vanessa-se-ne-v11",
  name: "School + Neighborhood (v11)",
  explorers: "se-ne",
  notes:
    "Matches the approved v11 SE+NE video. School Explorer comes first; the Neighborhood Explorer tabs only run after it.",
  beats: [
    {
      scene: "listing",
      seconds: 8.0,
      text:
        "Hey {firstName}, Claire from Dream Neighborhood. I was looking at {company}. Your listing format looks really good!",
      caption: { headline: "Your listing format looks really good.", subline: "Here is one of them, as it is today." },
    },
    {
      scene: "listing",
      seconds: 6.7,
      text: "Take a look at this one, as it is today. A mom opens it... and there's nothing here about schools.",
      caption: { headline: "A mom opens it.", subline: "There is nothing here about schools." },
    },
    {
      scene: "listing",
      seconds: 5.7,
      text: "So she bounces. She goes to Zillow, or Realtor.com. And you lose her.",
      caption: { headline: "So she bounces.", subline: "Zillow. Realtor.com. And you lose her." },
    },
    {
      scene: "listing",
      seconds: 11.0,
      text:
        "Here's the same page, with the Dream Neighborhood School Explorer. Zero website redesign! The popup icon hovers in the bottom right corner. It's one line of code.",
      caption: { headline: "The same page, with School Explorer.", subline: "Zero website redesign. One line of code." },
    },
    {
      scene: "listing",
      seconds: 6.1,
      text: "We auto-detect the listing address on every page. And we'll install it for you, for free.",
      caption: { headline: "We auto-detect the listing address.", subline: "And we install it for you, free." },
    },
    {
      scene: "listing-tap",
      seconds: 2.5,
      text: "She taps the little house in the corner,",
      caption: { headline: "She taps the little house.", subline: "Bottom right corner." },
    },
    {
      scene: "se",
      seconds: 3.4,
      text: "and schools come up right on your site. She never left.",
      caption: { headline: "Schools, right on your site.", subline: "She never left." },
    },
    {
      scene: "se",
      seconds: 3.8,
      text: "The School Explorer is free for life. No credit card required.",
      caption: { headline: "Free for life. No credit card.", subline: "" },
    },
    {
      scene: "ne",
      seconds: 2.6,
      text: "And if you ever want the full Neighborhood Explorer",
      caption: { headline: "Neighborhood Explorer.", subline: "Map and Summary." },
    },
    {
      scene: "ne",
      seconds: 2.6,
      text: "with over 38 hyperlocal insights",
      caption: { headline: "Over 38 hyperlocal insights.", subline: "Demographics." },
    },
    {
      scene: "ne",
      seconds: 2.6,
      text: "(far more than Zillow)...",
      caption: { headline: "Far more than Zillow.", subline: "Schools." },
    },
    {
      scene: "ne",
      seconds: 2.6,
      text: "you can upgrade to Neighborhood Explorer anytime.",
      caption: { headline: "Upgrade any time.", subline: "Housing & Market Trends." },
    },
    {
      scene: "ne",
      seconds: 2.6,
      text: "Same button on the website, it just works.",
      caption: { headline: "Same button on the website.", subline: "Commutes." },
    },
    {
      scene: "ne",
      seconds: 2.6,
      text: "Become not just the home expert, but the school and neighborhood expert as well.",
      caption: { headline: "The school and neighborhood expert.", subline: "Mobility." },
    },
    {
      scene: "ne",
      seconds: 2.6,
      text: "Give us a call!",
      caption: { headline: "Give us a call.", subline: "Points of Interest." },
    },
  ],
};

/*
 * se-to-ne-upgrade: for a customer who ALREADY has the free School Explorer.
 *
 * The picture opens on their listing with School Explorer on it - that is what
 * they have today, not a "before" shot - and then the same popup becomes
 * Neighborhood Explorer and walks every tab in the official order. Each tab beat
 * names its own tab, so the tab on screen is always the one being spoken.
 *
 * Group totals Bill asked for: 8s already have SE | 8s tap the house and today's
 * School Explorer | 7s the same button upgrades | seven tab beats at 3s | 10s
 * SEO, dwell time, showings and cost | 6s close. Total 60s.
 */
const SE_TO_NE_UPGRADE = {
  id: "se-to-ne-upgrade",
  name: "SE to NE upgrade",
  explorers: "se-ne",
  listingExplorer: "prefer-present",
  notes:
    "For customers who already have the free School Explorer. Films a listing that already has it where possible, then walks every Neighborhood Explorer tab in order.",
  beats: [
    {
      scene: "listing",
      seconds: 8,
      text:
        "Hey {firstName}, Claire from Dream Neighborhood. I was looking at {company}. You already have School Explorer on your listings. It looks really good.",
      caption: { headline: "You already have School Explorer.", subline: "It looks really good." },
    },
    {
      scene: "listing-tap",
      seconds: 2.5,
      text: "A mom taps the house,",
      caption: { headline: "She taps the little house.", subline: "The same button you have today." },
    },
    {
      scene: "se",
      seconds: 5.5,
      text: "and the schools come up right on your site. She never left. That is the free School Explorer you have today.",
      caption: { headline: "School Explorer, on your site.", subline: "This is what you have today." },
    },
    {
      scene: "se",
      seconds: 7,
      text:
        "When you are ready, the same button upgrades to Neighborhood Explorer. No new install. Same house icon. It just does more.",
      caption: { headline: "The same button upgrades.", subline: "No new install. Same house icon." },
    },
    {
      scene: "ne",
      tab: "Map and Summary",
      seconds: 3,
      text: "Map and Summary: she sees the neighborhood at a glance.",
      caption: { headline: "Map and Summary.", subline: "The neighborhood at a glance." },
    },
    {
      scene: "ne",
      tab: "Demographics",
      seconds: 3,
      text: "Demographics: who lives here, income, age, households.",
      caption: { headline: "Demographics.", subline: "Who lives here, income, age, households." },
    },
    {
      scene: "ne",
      tab: "Schools",
      seconds: 3,
      text: "Schools: the same school data she already trusts, still right there.",
      caption: { headline: "Schools.", subline: "The same school data she already trusts." },
    },
    {
      scene: "ne",
      tab: "Housing & Market Trends",
      seconds: 3,
      text: "Housing and Market Trends: prices, inventory, how the market is moving.",
      caption: { headline: "Housing & Market Trends.", subline: "Prices, inventory, how the market is moving." },
    },
    {
      scene: "ne",
      tab: "Commutes",
      seconds: 3,
      text: "Commutes: where people work and how long it takes.",
      caption: { headline: "Commutes.", subline: "Where people work and how long it takes." },
    },
    {
      scene: "ne",
      tab: "Mobility",
      seconds: 3,
      text: "Mobility: walk, bike, transit, how easy it is to get around.",
      caption: { headline: "Mobility.", subline: "Walk, bike, transit." },
    },
    {
      scene: "ne",
      tab: "Points of Interest",
      seconds: 3,
      text:
        "Points of Interest: grocery, parks, restaurants, the everyday stuff that makes her want the house.",
      caption: { headline: "Points of Interest.", subline: "Grocery, parks, restaurants." },
    },
    {
      scene: "ne",
      tab: "Points of Interest",
      seconds: 10,
      text:
        "That extra time on your page helps SEO and dwell time. Buyers show up already sold on the neighborhood, so you can cut showings per closing. And it is cost effective: one upgrade, same button, on every listing.",
      caption: { headline: "More time on your page.", subline: "Fewer showings per closing. One upgrade, every listing." },
    },
    {
      scene: "ne",
      tab: "Points of Interest",
      seconds: 6,
      text: "Become not just the school expert, but the neighborhood expert as well. Give us a call!",
      caption: { headline: "Become the neighborhood expert too.", subline: "Give us a call." },
    },
  ],
};

const DEFAULT_TEMPLATES = [SCHOOL_ONLY, SCHOOL_AND_NEIGHBORHOOD, SE_TO_NE_UPGRADE];
const DEFAULT_TEMPLATE_IDS = DEFAULT_TEMPLATES.map((template) => template.id);

module.exports = { DEFAULT_TEMPLATES, DEFAULT_TEMPLATE_IDS };
