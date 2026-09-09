"use strict";

/**
 * Who capture tells a realtor's site it is.
 *
 * One place for the user agent, the client hints and the language, because the
 * failure this exists to stop is not any one of them being wrong - it is two of
 * them disagreeing. Bot protection reads the disagreement, and the disagreement
 * is worth more to it than either header on its own.
 *
 * Three disagreements were live before this file:
 *
 *   - the user agent said Chrome 131, and the browser was Chrome 148. A version
 *     more than a year behind the build actually making the request is a cheap
 *     thing to check and a very odd thing to see.
 *   - the user agent and the client hints said macOS, and `navigator.platform`
 *     said `Linux x86_64`. One line of JavaScript catches that.
 *   - `navigator.webdriver` was forced to `undefined`. Real Chrome has that
 *     property and answers `false`. Deleting it is a headless tell of its own -
 *     it says something went to the trouble of hiding.
 *
 * None of this is a bypass, and the limits are in the README next to it.
 */

/**
 * The desktops capture is allowed to be.
 *
 * Every field in a row has to agree with every other field in that row: the OS
 * token inside the user agent string, the `Sec-CH-UA-Platform` header, and the
 * `navigator.platform` a page reads in JavaScript are three ways of being asked
 * the same question.
 *
 * Windows is the default because it is what most people visiting a realtor's
 * site are on, so it is the least remarkable answer to give.
 */
const DESKTOPS = {
  windows: {
    // Chrome on Windows has reported this same frozen token since Windows 10.
    userAgentOs: "Windows NT 10.0; Win64; x64",
    platform: "Windows",
    // Chrome reports Windows 11 as 15.0.0; Windows 10 is 10.0.0. See
    // https://learn.microsoft.com/microsoft-edge/web-platform/how-to-detect-win11
    platformVersion: "15.0.0",
    architecture: "x86",
    bitness: "64",
    navigatorPlatform: "Win32",
  },
  macos: {
    // Frozen at 10_15_7 by Chrome on every Mac, Intel and Apple silicon alike.
    userAgentOs: "Macintosh; Intel Mac OS X 10_15_7",
    platform: "macOS",
    platformVersion: "15.1.0",
    architecture: "arm",
    bitness: "64",
    navigatorPlatform: "MacIntel",
  },
  linux: {
    userAgentOs: "X11; Linux x86_64",
    platform: "Linux",
    platformVersion: "6.6.0",
    architecture: "x86",
    bitness: "64",
    navigatorPlatform: "Linux x86_64",
  },
};

const DEFAULT_DESKTOP = "windows";

/*
 * The language, in the two shapes it is needed in.
 *
 * LANGUAGE_LIST is what Chrome is launched with. It is a plain list on purpose:
 * given `--accept-lang=en-US,en` Chrome writes the q-values itself and sends
 * `en-US,en;q=0.9`. Handing it the q-values instead gets them applied twice, and
 * the header goes out as `en-US,en;q=0.9,en;q=0.9;q=0.8`, which is worse than
 * sending nothing.
 *
 * ACCEPT_LANGUAGE is what that produces on the wire, kept here so a test can
 * check the wire against the intention.
 */
const LANGUAGE_LIST = ["en-US", "en"];
const ACCEPT_LANGUAGE = "en-US,en;q=0.9";

/*
 * Used only when Chrome cannot be asked its own version, which should not
 * happen. Being a little stale is survivable; claiming a version that does not
 * exist is not.
 */
const FALLBACK_VERSION = "148.0.7778.96";

/** "HeadlessChrome/148.0.7778.96" -> { full: "148.0.7778.96", major: "148" } */
function readVersion(reported) {
  const match = /(\d+(?:\.\d+){1,3})/.exec(String(reported || ""));
  const full = match ? match[1] : FALLBACK_VERSION;
  return { full, major: full.split(".")[0] };
}

/**
 * The brand list for `Sec-CH-UA`.
 *
 * Chrome's real list is preferred and passed in by the caller, because it comes
 * with the GREASE entry this build happens to have picked - the deliberately
 * silly `"Not/A)Brand";v="99"` - in the position it happens to have put it. That
 * entry is different in every Chrome version, so guessing it is how a hand
 * written list ends up looking like Chrome 131 pretending to be Chrome 148.
 *
 * The one thing never taken from Chrome is a brand containing "Headless".
 */
function brandsFor(major, live) {
  const usable =
    Array.isArray(live) &&
    live.length > 0 &&
    live.every((entry) => entry && typeof entry.brand === "string" && typeof entry.version === "string") &&
    !live.some((entry) => /headless/i.test(entry.brand));
  if (usable) return live.map((entry) => ({ brand: entry.brand, version: entry.version }));
  return [
    { brand: "Chromium", version: major },
    { brand: "Google Chrome", version: major },
    { brand: "Not/A)Brand", version: "99" },
  ];
}

/**
 * The same brands again for `Sec-CH-UA-Full-Version-List`, which is what a site
 * gets when it asks for the full version rather than the major.
 *
 * A real brand carries the browser's whole version; the GREASE entry carries its
 * own made up major padded out, which is what Chrome does.
 */
function fullVersionsFor(brands, full, major) {
  return brands.map((entry) =>
    entry.version === major ? { brand: entry.brand, version: full } : { brand: entry.brand, version: `${entry.version}.0.0.0` }
  );
}

function desktopNamed(name) {
  const key = String(name || "").trim().toLowerCase();
  return DESKTOPS[key] || DESKTOPS[DEFAULT_DESKTOP];
}

/**
 * Build the persona.
 *
 * @param {object} options
 * @param {string} options.version  what the browser says it is, e.g. "HeadlessChrome/148.0.7778.96"
 * @param {Array}  options.brands   navigator.userAgentData.brands, read from the live browser
 * @param {string} options.desktop  which row of DESKTOPS to be
 */
function buildPersona({ version, brands, desktop } = {}) {
  const os = desktopNamed(desktop);
  const { full, major } = readVersion(version);
  const brandList = brandsFor(major, brands);

  return {
    desktop: Object.keys(DESKTOPS).find((name) => DESKTOPS[name] === os) || DEFAULT_DESKTOP,
    chromeVersion: full,
    chromeMajor: major,
    /*
     * Chrome freezes almost all of this string: only the OS token and the major
     * version have moved in years, and the minor parts are always zeroed. The
     * real full version still goes out, in Sec-CH-UA-Full-Version-List.
     */
    userAgent: `Mozilla/5.0 (${os.userAgentOs}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
    metadata: {
      architecture: os.architecture,
      bitness: os.bitness,
      model: "",
      platform: os.platform,
      platformVersion: os.platformVersion,
      mobile: false,
      brands: brandList,
      fullVersionList: fullVersionsFor(brandList, full, major),
    },
    navigatorPlatform: os.navigatorPlatform,
    acceptLanguage: ACCEPT_LANGUAGE,
    languages: [...LANGUAGE_LIST],
  };
}

/**
 * The Chrome switches that belong to the persona rather than to memory.
 *
 * Language is set here, at launch, and deliberately NOT with
 * `setExtraHTTPHeaders`. Chrome puts `Accept-Language` last on a request, after
 * `Accept-Encoding`; an extra header is appended by the automation layer instead
 * and lands in the middle, ahead of `Accept`. Header order is itself a
 * fingerprint, and a browser whose headers come out in an order no Chrome
 * produces has told the site something. Set at launch, it goes out in Chrome's
 * own position with Chrome's own q-values.
 *
 * `--lang` goes with it so `navigator.language` in the page agrees with the
 * header on the wire.
 */
function launchArgs() {
  return [`--lang=${LANGUAGE_LIST[0]}`, `--accept-lang=${LANGUAGE_LIST.join(",")}`];
}

/**
 * Ask a live browser who it is, and build the persona around the answer.
 *
 * The brands are read through a page because that is the only place Chrome
 * exposes them, and the page used is the blank one Chrome always opens with, so
 * this costs no extra renderer. Everything here is best effort: a persona built
 * from the fallback version is still far better than none.
 */
async function personaFor(browser, { desktop } = {}) {
  let version = "";
  let brands = null;
  try {
    version = await browser.version();
  } catch (_) {
    /* the fallback version covers it */
  }
  try {
    const pages = await browser.pages();
    const page = pages.find((candidate) => !candidate.isClosed());
    if (page) {
      brands = await page.evaluate(() =>
        globalThis.navigator && navigator.userAgentData
          ? navigator.userAgentData.brands.map((entry) => ({ brand: entry.brand, version: entry.version }))
          : null
      );
    }
  } catch (_) {
    /* brandsFor() synthesises a list instead */
  }
  return buildPersona({ version, brands, desktop });
}

/**
 * Make the page stop contradicting the persona.
 *
 * The user agent and the client hints are set over CDP, which also rewrites
 * `navigator.userAgent` and `navigator.userAgentData`. It does NOT touch
 * `navigator.platform`, so a page told it is on Windows could read `Linux
 * x86_64` in the next line - which is the same self-contradiction the headers
 * had, moved into JavaScript.
 *
 * `navigator.webdriver` is only touched if Chrome left it on. Launched with
 * --disable-blink-features=AutomationControlled it already answers `false`,
 * which is exactly what an ordinary Chrome answers, and the worst thing to do
 * then is to remove the property: a navigator with no `webdriver` at all is not
 * a browser anyone ships.
 */
function pageScript(persona) {
  return {
    fn: ({ platform, languages }) => {
      try {
        if (navigator.webdriver === true) {
          Object.defineProperty(navigator, "webdriver", { get: () => false, configurable: true });
        }
      } catch (_) {
        /* some builds will not let us, and that is survivable */
      }
      try {
        if (navigator.platform !== platform) {
          Object.defineProperty(navigator, "platform", { get: () => platform, configurable: true });
        }
      } catch (_) {
        /* ignore */
      }
      try {
        Object.defineProperty(navigator, "languages", { get: () => languages, configurable: true });
      } catch (_) {
        /* ignore */
      }
    },
    arg: { platform: persona.navigatorPlatform, languages: persona.languages },
  };
}

module.exports = {
  DESKTOPS,
  DEFAULT_DESKTOP,
  ACCEPT_LANGUAGE,
  LANGUAGE_LIST,
  buildPersona,
  personaFor,
  launchArgs,
  pageScript,
  readVersion,
};
