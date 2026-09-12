"use strict";

/*
 * The form remembers what was last typed into it.
 *
 * One site is several takes. Bill does the same realtor three or four times over
 * - a different script, a different voice, a screenshot instead of the live
 * capture, another go after a listing came out wrong - and every one of those
 * started by typing the name, the company, the website, the email and the
 * listing URL in again from nothing. "Make another video" reset the form and
 * threw the lot away too.
 *
 * These drive the real front end in real Chrome against the real server, the
 * same way test/client.test.js does, because what is under test is a browser
 * remembering things across a page load.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-memory-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "memory-test-token";

const config = require("../src/config");
const { launch, closeBrowser } = require("../src/browser");
const app = require("../server");

const TOOL = "/tools/listing-video";
const noChrome = !config.chromePath;
const options = noChrome ? { skip: "no Chrome or Chromium on this machine" } : {};

/** Start the tool, sign in, and open the page in Chrome. */
async function openTool() {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const signin = await fetch(`${origin}${TOOL}/api/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "memory-test-token" }),
  });
  const cookie = signin.headers.getSetCookie()[0].split(";")[0];

  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setCookie({
    name: cookie.split("=")[0],
    value: cookie.split("=").slice(1).join("="),
    domain: "127.0.0.1",
    path: "/",
  });

  const tool = {
    page,
    origin,
    /** Load the tool and wait for the form to be painted. */
    async open() {
      await page.goto(`${origin}${TOOL}`, { waitUntil: "networkidle2" });
      await page.waitForFunction(() => window.DNLV && window.DNLV.maker, { timeout: 15000 });
      await page.waitForFunction(
        () => document.querySelectorAll('input[name="templateId"]').length > 0,
        { timeout: 15000 }
      );
      return page;
    },
    async close() {
      await closeBrowser(browser);
      await new Promise((resolve) => server.close(resolve));
    },
  };
  return tool;
}

/** Type into a box the way a person does, so the form's own listeners run. */
async function typeInto(page, id, value) {
  await page.evaluate((field) => {
    const input = document.getElementById(field);
    input.value = "";
    input.focus();
  }, id);
  await page.type(`#${id}`, value);
}

/** What the form is holding right now. */
const formNow = () => ({
  firstName: document.getElementById("firstName").value,
  company: document.getElementById("company").value,
  websiteUrl: document.getElementById("websiteUrl").value,
  listingUrl: document.getElementById("listingUrl").value,
  customerEmail: document.getElementById("customerEmail").value,
  address: document.getElementById("addressSearch").value,
  templateId: (document.querySelector('input[name="templateId"]:checked') || {}).value || "",
  pictureSource: (document.querySelector('input[name="pictureSource"]:checked') || {}).value || "",
  voiceId: (document.querySelector('input[name="voiceId"]:checked') || {}).value || "",
  fromId: (document.querySelector('input[name="fromId"]:checked') || {}).value || "",
  noteShown: !document.getElementById("rememberedNote").hidden,
});

/* The customer, as it would be typed in the first time. */
const VANESSA = {
  firstName: "Vanessa",
  company: "DOMO Realty",
  websiteUrl: "domorealty.com",
  listingUrl: "https://domorealty.com/listings/6031-n-rosemead-dr",
  customerEmail: "vanessa@domorealty.test",
};

async function fillTheForm(page, answers = VANESSA) {
  for (const [id, value] of Object.entries(answers)) await typeInto(page, id, value);
  await page.evaluate(() => {
    const choose = (name, at) => {
      const options = document.querySelectorAll(`input[name="${name}"]`);
      if (options[at]) {
        options[at].checked = true;
        options[at].dispatchEvent(new Event("change", { bubbles: true }));
      }
    };
    choose("templateId", 0);
    choose("fromId", 0);
  });
}

/* ---------------------------------------------------------------- */
/* across a page load                                               */
/* ---------------------------------------------------------------- */

test("the form comes back filled in with the last video's answers", options, async () => {
  const tool = await openTool();
  try {
    const page = await tool.open();
    await fillTheForm(page);
    const typed = await page.evaluate(formNow);
    assert.equal(typed.firstName, "Vanessa");
    assert.ok(typed.templateId, "a script was picked");
    assert.equal(typed.noteShown, false, "nothing was remembered the first time round");

    // A whole new page load, the way the next take starts.
    await tool.open();
    const remembered = await page.evaluate(formNow);

    assert.equal(remembered.firstName, "Vanessa");
    assert.equal(remembered.company, "DOMO Realty");
    assert.equal(remembered.websiteUrl, "domorealty.com");
    assert.equal(remembered.listingUrl, VANESSA.listingUrl);
    assert.equal(remembered.customerEmail, "vanessa@domorealty.test");
    assert.equal(remembered.templateId, typed.templateId, "the same script is picked again");
    assert.equal(remembered.fromId, typed.fromId);
    assert.equal(remembered.noteShown, true, "and it says the form was filled in for you");
  } finally {
    await tool.close();
  }
});

test("the script, the picture source and the address come back too", options, async () => {
  const tool = await openTool();
  try {
    const page = await tool.open();
    await fillTheForm(page);

    // The upgrade script, a screenshot rather than their site, and an address
    // picked from the Explorer's own suggestions.
    await page.evaluate(() => {
      const pick = (name, value) => {
        Array.prototype.forEach.call(document.querySelectorAll(`input[name="${name}"]`), (entry) => {
          if (entry.value === value) {
            entry.checked = true;
            entry.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
      };
      pick("templateId", "se-to-ne-upgrade");
      pick("pictureSource", "upload");
      window.DNLV.maker.memory.save();
    });
    await typeInto(page, "addressSearch", "6031 N Rosemead Dr, Peoria, IL 61614");

    await tool.open();
    const remembered = await page.evaluate(formNow);

    assert.equal(remembered.templateId, "se-to-ne-upgrade");
    assert.equal(remembered.pictureSource, "upload");
    assert.equal(remembered.address, "6031 N Rosemead Dr, Peoria, IL 61614");

    // Picking the upload is what shows the upload box, and restoring the choice
    // has to fire the same change the click would have.
    const shown = await page.evaluate(() => ({
      upload: !document.getElementById("uploadField").hidden,
      listingUrl: !document.getElementById("listingUrlField").hidden,
    }));
    assert.equal(shown.upload, true, "the upload box follows the remembered choice");
    assert.equal(shown.listingUrl, false);
  } finally {
    await tool.close();
  }
});

/*
 * There is nothing on a before-shot upload to confirm any more.
 *
 * The form used to ask - a tickbox saying "this listing has no Explorer on it
 * yet" - and Bill asked for it to go: he picked the page and took the picture, so
 * he can already see there is no Explorer on it. Nothing replaced it on the form.
 */
test("a before-shot upload has no confirmation box, and no password is remembered", options, async () => {
  const tool = await openTool();
  try {
    const page = await tool.open();
    await fillTheForm(page);
    await page.evaluate(() => {
      const pick = (name, value) => {
        Array.prototype.forEach.call(document.querySelectorAll(`input[name="${name}"]`), (entry) => {
          if (entry.value === value) {
            entry.checked = true;
            entry.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
      };
      pick("templateId", "vanessa-se-only-v11");
      pick("pictureSource", "upload");
      window.DNLV.maker.memory.save();
    });

    await tool.open();
    const after = await page.evaluate(() => ({
      // The before-shot script and the upload are both still picked, which is
      // exactly the case the tickbox used to appear for.
      templateId: (document.querySelector('input[name="templateId"]:checked') || {}).value || "",
      upload: !document.getElementById("uploadField").hidden,
      box: Boolean(document.getElementById("listingHasNoExplorer")),
      field: Boolean(document.getElementById("cleanShotField")),
      retryBox: Boolean(document.getElementById("retryListingHasNoExplorer")),
      stored: window.localStorage.getItem(window.DNLV.remember.key) || "",
    }));

    assert.equal(after.templateId, "vanessa-se-only-v11");
    assert.equal(after.upload, true);
    assert.equal(after.box, false, "the clean-shot tickbox is gone from the form");
    assert.equal(after.field, false);
    assert.equal(after.retryBox, false, "and from the failure panel's upload too");
    assert.doesNotMatch(after.stored, /listingHasNoExplorer/, after.stored);
    assert.doesNotMatch(after.stored, /memory-test-token/, "no password goes anywhere near this");
  } finally {
    await tool.close();
  }
});

/* ---------------------------------------------------------------- */
/* select all, so one answer can be typed over                      */
/* ---------------------------------------------------------------- */

/*
 * The point of remembering is changing one answer, and usually it is the
 * listing URL. So a remembered box selects itself when it is clicked into.
 */
test("a remembered field selects all its text, so typing replaces it", options, async () => {
  const tool = await openTool();
  try {
    const page = await tool.open();
    await fillTheForm(page);
    await tool.open();

    /*
     * Judged by what happens when somebody types, not by the selection API:
     * selectionStart is null on an email box, and "one letter replaces the lot"
     * is the thing this is for anyway.
     */
    for (const id of ["firstName", "company", "websiteUrl", "listingUrl", "customerEmail"]) {
      const before = await page.evaluate((field) => document.getElementById(field).value, id);
      assert.ok(before, `${id} was remembered`);

      await page.focus(`#${id}`);
      await page.keyboard.type("z");
      const after = await page.evaluate((field) => document.getElementById(field).value, id);
      assert.equal(after, "z", `${id} held "${before}" and typing over it left "${after}"`);
      await page.evaluate((field) => document.getElementById(field).blur(), id);
    }
  } finally {
    await tool.close();
  }
});

/* And a click into a remembered box selects it too, not just tabbing into it. */
test("clicking into a remembered field selects it, rather than placing a caret", options, async () => {
  const tool = await openTool();
  try {
    const page = await tool.open();
    await fillTheForm(page);
    await tool.open();

    const before = await page.evaluate(() => document.getElementById("company").value);
    assert.equal(before, "DOMO Realty");

    /*
     * Clicked between two letters of the remembered name, which is the case the
     * selection has to survive: the browser wants to put a caret exactly there
     * when the button comes back up.
     */
    await page.click("#company", { offset: { x: 40, y: 12 } });
    await page.keyboard.type("Patty Realty");
    assert.equal(
      await page.evaluate(() => document.getElementById("company").value),
      "Patty Realty",
      "a click has to select the box, or the new name lands in the middle of the old one"
    );
  } finally {
    await tool.close();
  }
});

/*
 * Once something has been typed into a box, that box is this person's own work.
 * Selecting all of it every time they came back to fix a letter would be a
 * nuisance rather than a help.
 */
test("a field that has been typed into is left alone on the next focus", options, async () => {
  const tool = await openTool();
  try {
    const page = await tool.open();
    await fillTheForm(page);
    await tool.open();

    // Type over the remembered listing URL, which is the usual reason to be here.
    await typeInto(page, "listingUrl", "https://domorealty.com/listings/815-larkspur-lane");
    const after = await page.evaluate(() => {
      const input = document.getElementById("listingUrl");
      input.blur();
      input.focus();
      return {
        value: input.value,
        selection: input.value.slice(input.selectionStart, input.selectionEnd),
      };
    });

    assert.equal(after.value, "https://domorealty.com/listings/815-larkspur-lane");
    assert.notEqual(after.selection, after.value, "a box that was typed into is not re-selected");
  } finally {
    await tool.close();
  }
});

/* ---------------------------------------------------------------- */
/* another take, and a way out                                      */
/* ---------------------------------------------------------------- */

test("clearing the form empties it and stops it coming back", options, async () => {
  const tool = await openTool();
  try {
    const page = await tool.open();
    await fillTheForm(page);
    await tool.open();
    assert.equal((await page.evaluate(formNow)).firstName, "Vanessa");

    await page.click("#forgetFormBtn");
    const cleared = await page.evaluate(formNow);
    assert.equal(cleared.firstName, "");
    assert.equal(cleared.company, "");
    assert.equal(cleared.listingUrl, "");
    assert.equal(cleared.noteShown, false);

    await tool.open();
    const stillEmpty = await page.evaluate(formNow);
    assert.equal(stillEmpty.firstName, "", "cleared stays cleared across a page load");
    assert.equal(stillEmpty.noteShown, false);
  } finally {
    await tool.close();
  }
});

/*
 * A browser that will not store anything must not take the form down with it -
 * Safari in private browsing throws on setItem. The form still works; it just
 * forgets between page loads, the way it always used to.
 */
test("a browser with no localStorage still has a working form", options, async () => {
  const tool = await openTool();
  try {
    await tool.page.evaluateOnNewDocument(() => {
      const dead = {
        getItem() {
          throw new Error("no storage");
        },
        setItem() {
          throw new Error("no storage");
        },
        removeItem() {
          throw new Error("no storage");
        },
      };
      Object.defineProperty(window, "localStorage", { get: () => dead });
    });

    const page = await tool.open();
    await fillTheForm(page);
    const typed = await page.evaluate(formNow);
    assert.equal(typed.firstName, "Vanessa", "the form takes answers as it always did");
    assert.ok(typed.templateId);

    // And the button is live, so the video can still be made.
    assert.equal(await page.evaluate(() => document.getElementById("makeBtn").disabled), false);
  } finally {
    await tool.close();
  }
});
