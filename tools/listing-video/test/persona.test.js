"use strict";

/*
 * The persona, checked without starting a browser.
 *
 * test/capture.test.js checks what actually leaves the machine, which is the
 * one that matters - but it needs Chrome and is skipped without it. These are
 * the rules that produced those headers, so a mistake in them is caught on a
 * machine with no Chrome on it too.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const persona = require("../src/persona");

const CHROME_148 = "HeadlessChrome/148.0.7778.96";

/** The three ways a page can be asked what it is running on. */
const OS_TOKENS = {
  windows: { userAgent: /Windows NT 10\.0; Win64; x64/, hint: "Windows", navigator: "Win32" },
  macos: { userAgent: /Macintosh; Intel Mac OS X/, hint: "macOS", navigator: "MacIntel" },
  linux: { userAgent: /X11; Linux x86_64/, hint: "Linux", navigator: "Linux x86_64" },
};

for (const [desktop, expected] of Object.entries(OS_TOKENS)) {
  test(`the ${desktop} persona names the same system in all three places`, () => {
    const who = persona.buildPersona({ version: CHROME_148, desktop });
    assert.match(who.userAgent, expected.userAgent);
    assert.equal(who.metadata.platform, expected.hint);
    assert.equal(who.navigatorPlatform, expected.navigator);
    assert.equal(who.metadata.mobile, false);
  });
}

test("the version in the user agent is the version of the browser it was built from", () => {
  const who = persona.buildPersona({ version: CHROME_148 });
  assert.match(who.userAgent, /Chrome\/148\.0\.0\.0 Safari\/537\.36$/);
  assert.equal(who.chromeVersion, "148.0.7778.96");

  // Chrome zeroes the minor parts in the string and puts the real ones in the
  // full version list, so both have to come from the same place.
  const chrome = who.metadata.fullVersionList.find((entry) => entry.brand === "Google Chrome");
  assert.equal(chrome.version, "148.0.7778.96");
  assert.equal(who.metadata.brands.find((entry) => entry.brand === "Google Chrome").version, "148");
});

test("nothing in the persona says headless, whatever the browser called itself", () => {
  const who = persona.buildPersona({
    version: CHROME_148,
    brands: [
      { brand: "HeadlessChrome", version: "148" },
      { brand: "Chromium", version: "148" },
    ],
  });
  const everything = JSON.stringify(who);
  assert.doesNotMatch(everything, /headless/i, everything);
  assert.match(who.metadata.brands.map((entry) => entry.brand).join(","), /Google Chrome/);
});

/*
 * Chrome's GREASE brand - the deliberately silly one - is different in every
 * version, so a hand written list is how a persona ends up looking like Chrome
 * 131 pretending to be Chrome 148. The live list is taken as it comes.
 */
test("Chrome's own brand list is kept, GREASE entry and order and all", () => {
  const live = [
    { brand: "Chromium", version: "148" },
    { brand: "Google Chrome", version: "148" },
    { brand: "Not/A)Brand", version: "99" },
  ];
  const who = persona.buildPersona({ version: CHROME_148, brands: live });
  assert.deepEqual(who.metadata.brands, live);

  // The full version list pads GREASE out the way Chrome does, and gives the
  // real brands the browser's whole version.
  assert.deepEqual(who.metadata.fullVersionList, [
    { brand: "Chromium", version: "148.0.7778.96" },
    { brand: "Google Chrome", version: "148.0.7778.96" },
    { brand: "Not/A)Brand", version: "99.0.0.0" },
  ]);
});

test("a browser that will not say what it is still gets a whole persona", () => {
  const who = persona.buildPersona({});
  assert.match(who.userAgent, /^Mozilla\/5\.0 \(.+\) AppleWebKit\/537\.36 .+ Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
  assert.match(who.metadata.brands.map((entry) => entry.brand).join(","), /Google Chrome/);
  assert.equal(who.metadata.brands.find((entry) => entry.brand === "Google Chrome").version, who.chromeMajor);
});

test("an unknown desktop falls back to the commonest one rather than failing", () => {
  assert.equal(persona.buildPersona({ desktop: "amiga" }).desktop, persona.DEFAULT_DESKTOP);
  assert.equal(persona.buildPersona({ desktop: "" }).desktop, persona.DEFAULT_DESKTOP);
  assert.equal(persona.buildPersona({ desktop: "  MacOS " }).desktop, "macos");
});

/*
 * Chrome writes the q-values itself. Handing it "en-US,en;q=0.9" gets them
 * applied twice and sends "en-US,en;q=0.9,en;q=0.9;q=0.8", which is a stranger
 * thing to send than nothing at all.
 */
test("the language is given to Chrome as a plain list, with no q-values", () => {
  const args = persona.launchArgs();
  const acceptLang = args.find((arg) => arg.startsWith("--accept-lang="));
  assert.equal(acceptLang, "--accept-lang=en-US,en");
  assert.ok(args.includes("--lang=en-US"), `--lang belongs with it: ${args.join(" ")}`);
  assert.equal(persona.ACCEPT_LANGUAGE, "en-US,en;q=0.9", "what Chrome then puts on the wire");
});

test("the page script leaves navigator.webdriver alone unless Chrome left it on", () => {
  const who = persona.buildPersona({ version: CHROME_148, desktop: "windows" });
  const { fn, arg } = persona.pageScript(who);

  // An ordinary Chrome launched with --disable-blink-features=AutomationControlled.
  const ordinary = { webdriver: false, platform: "Win32", languages: ["en-US", "en"] };
  runAgainst(ordinary, fn, arg);
  assert.equal(ordinary.webdriver, false, "nothing to fix, so nothing was touched");
  assert.ok("webdriver" in ordinary, "the property must survive");

  // A Chrome that did leave the automation bit on.
  const driven = { webdriver: true, platform: "Linux x86_64", languages: [] };
  runAgainst(driven, fn, arg);
  assert.equal(driven.webdriver, false);
  assert.equal(driven.platform, "Win32", "the platform must stop contradicting the user agent");
  assert.deepEqual(driven.languages, ["en-US", "en"]);
});

/** Run the page script against a stand-in navigator, the way a page would. */
function runAgainst(navigator, fn, arg) {
  const previous = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true, writable: true });
  try {
    fn(arg);
  } finally {
    Object.defineProperty(globalThis, "navigator", { value: previous, configurable: true, writable: true });
  }
}
