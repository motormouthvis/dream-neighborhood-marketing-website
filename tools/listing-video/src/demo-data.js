"use strict";

/**
 * The demo neighborhood shown inside the School Explorer / Neighborhood
 * Explorer cards. This is the same demo area used in the approved reference
 * video, so both cards always agree with each other.
 *
 * The listing behind the card is the customer's own page, and the popup tooltip
 * uses the address auto-detected on that page. Only the card contents come from
 * here.
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

const NE_TABS = [
  "Map and Summary",
  "Demographics",
  "Schools",
  "Housing & Market Trends",
  "Commutes",
  "Mobility",
  "Points of Interest",
];

const NE_SUMMARY = {
  stats: [
    { icon: "income", value: "$149,438", label: "Household Income" },
    { icon: "home", value: "$529,843", label: "Median Home Price" },
    { icon: "rent", value: "$1,640", label: "Median Rent" },
    { icon: "owners", value: "64%", label: "Occupied by owners" },
  ],
  bars: [
    { label: "Has College Degree", percent: 53, tone: "dark" },
    { label: "Finished High School", percent: 95, tone: "light" },
    { label: "Employed", percent: 63, tone: "dark" },
  ],
};

module.exports = { DEMO_NEIGHBORHOOD, DEMO_SCHOOLS, NE_TABS, NE_SUMMARY };
