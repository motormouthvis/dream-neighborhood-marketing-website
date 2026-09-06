"use strict";

/**
 * Signing in to a realtor site with the QUAL account.
 *
 * Some IDX sites count listing views and then stop showing listings until you
 * have an account. Capture used to refuse those outright and say "paste a
 * listing URL", which is no help when every listing is behind the same door.
 * The QUAL account exists so there is a key.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT FOR
 *
 * This handles an ACCOUNT WALL: the site loaded, served us a page, and that page
 * asks us to log in. There is a form to fill in and a door to walk through.
 *
 * It does nothing at all for a 403. A 403 is bot protection refusing to serve
 * the page in the first place - there is no form, no page, and nothing to sign
 * in to. Scott Rodgers Real Estate is that case, and no credential fixes it. The
 * uploaded screenshot is what gets that video made, and it stays the guaranteed
 * way through.
 *
 * SIGNING IN VERSUS REGISTERING
 *
 * Signing in to an account that already exists is quiet. Registering is not:
 * creating an account on an IDX site is precisely how that site's agent gets a
 * "you have a new lead" email, and not emailing realtors is a hard rule. So
 * registration is a separate switch, off by default, and meant to be turned on
 * for one site at a time by somebody who has decided that is acceptable there.
 *
 * The whole thing is off unless LISTING_VIDEO_QUAL_EMAIL and
 * LISTING_VIDEO_QUAL_PASSWORD are both set. They are set on staging and not on
 * production, which is what keeps this off production.
 *
 * Nothing here is logged in a way that could print the password.
 */

const config = require("./config");

/** How long any one step of a sign-in is worth waiting for. */
const STEP_TIMEOUT_MS = 8000;
const SETTLE_MS = 1200;

/** Is the QUAL account configured at all? */
function configured() {
  const account = config.qualAccount || {};
  return Boolean(account.email && account.password);
}

/**
 * May we use it on this host?
 *
 * An empty host list means any site. A non-empty one is an allowlist, which is
 * how this gets switched on for one customer without applying everywhere.
 */
function allowedOn(host) {
  if (!configured()) return false;
  const hosts = (config.qualAccount || {}).hosts || [];
  if (!hosts.length) return true;
  const bare = String(host || "").toLowerCase().replace(/^www\./, "");
  return hosts.some((entry) => bare === entry || bare.endsWith(`.${entry}`));
}

function registerAllowedOn(host) {
  return allowedOn(host) && Boolean((config.qualAccount || {}).registerAllowed);
}

/** Said in the log and kept on the job, with no secret in it. */
function describe() {
  if (!configured()) return "not configured";
  const account = config.qualAccount;
  const where = account.hosts.length ? account.hosts.join(", ") : "any site";
  return `${account.email} on ${where}${account.registerAllowed ? ", may register" : ", sign-in only"}`;
}

/* ---------------------------------------------------------------- */
/* finding the form, in the page                                    */
/* ---------------------------------------------------------------- */

/*
 * Runs in the page. Tags the fields it means to use with a data attribute and
 * reports what it found, so the typing itself can be done by the browser driver
 * - a site drawn by React does not notice a value assigned from a script, but it
 * does notice real keystrokes.
 *
 * "mode" is "signin" or "register". The difference matters: a wall usually
 * carries both forms, and filling in the wrong one either creates an account
 * nobody asked for or fails on a password we do not have.
 */
/* eslint-disable no-undef */
function tagAccountForm(mode) {
  const MARK = "data-dnlv-field";
  for (const tagged of Array.from(document.querySelectorAll(`[${MARK}]`))) {
    tagged.removeAttribute(MARK);
  }

  const visible = (el) => {
    if (!el) return false;
    const box = el.getBoundingClientRect();
    if (box.width < 8 || box.height < 8) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || "1") > 0.05;
  };

  const textOf = (el) => {
    if (!el) return "";
    const bits = [
      el.getAttribute("name"),
      el.getAttribute("id"),
      el.getAttribute("placeholder"),
      el.getAttribute("aria-label"),
      el.getAttribute("autocomplete"),
    ];
    // The label sitting beside it, which is often the only thing that names it.
    const id = el.getAttribute("id");
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label) bits.push(label.textContent);
    }
    const wrapping = el.closest("label");
    if (wrapping) bits.push(wrapping.textContent);
    return bits.filter(Boolean).join(" ").toLowerCase();
  };

  const SIGN_IN_RE = /(sign\s*-?\s*in|log\s*-?\s*in|login|signin)/i;
  const REGISTER_RE = /(register|sign\s*-?\s*up|signup|create\s+(an?\s+)?account|join|new account)/i;
  /* A form that wants money is never one of ours. */
  const MONEY_RE = /(card number|credit card|cvv|cvc|expiry|expiration|billing|payment|cardholder|iban|routing number)/i;

  const forms = Array.from(document.querySelectorAll("form")).filter(visible);
  const scored = [];

  for (const form of forms) {
    const inside = form.textContent || "";
    if (MONEY_RE.test(inside)) continue;

    const passwords = Array.from(form.querySelectorAll('input[type="password"]')).filter(visible);
    if (!passwords.length) continue;

    const emails = Array.from(
      form.querySelectorAll('input[type="email"], input[type="text"], input:not([type])')
    ).filter((el) => visible(el) && !/captcha/i.test(textOf(el)));
    if (!emails.length) continue;

    /*
     * Two password boxes is a registration form: the second is "confirm". A
     * sign-in form has exactly one.
     */
    const confirms = passwords.length > 1 || passwords.some((el) => /confirm|repeat|again|verify/i.test(textOf(el)));

    const buttons = Array.from(
      form.querySelectorAll('button, input[type="submit"], [role="button"]')
    ).filter(visible);
    const buttonText = buttons.map((el) => `${el.textContent || ""} ${el.value || ""}`).join(" ");
    const formText = `${inside} ${form.getAttribute("id") || ""} ${form.getAttribute("class") || ""}`;

    const saysRegister = REGISTER_RE.test(buttonText) || REGISTER_RE.test(formText);
    const saysSignIn = SIGN_IN_RE.test(buttonText) || SIGN_IN_RE.test(formText);

    /*
     * Which form this is. The button wins over the surrounding words, because a
     * wall's sign-in box usually sits inside copy about registering.
     */
    let kind;
    if (confirms) kind = "register";
    else if (REGISTER_RE.test(buttonText)) kind = "register";
    else if (SIGN_IN_RE.test(buttonText)) kind = "signin";
    else if (saysRegister && !saysSignIn) kind = "register";
    else kind = "signin";

    if (kind !== mode) continue;

    // Pick the field most likely to be the email: an email input beats a text
    // one, and one that says so beats one that does not.
    const emailField =
      emails.find((el) => el.type === "email") ||
      emails.find((el) => /e-?mail/i.test(textOf(el))) ||
      emails.find((el) => /user|login|account/i.test(textOf(el))) ||
      emails[0];

    const nameField = emails.find(
      (el) => el !== emailField && /(name|first|last|full)/i.test(textOf(el)) && !/user|login/i.test(textOf(el))
    );
    const phoneField = Array.from(form.querySelectorAll('input[type="tel"], input[type="text"], input:not([type])'))
      .filter(visible)
      .find((el) => el !== emailField && el !== nameField && /(phone|mobile|cell|tel)/i.test(textOf(el)));

    const submit =
      buttons.find((el) => (mode === "signin" ? SIGN_IN_RE : REGISTER_RE).test(`${el.textContent || ""} ${el.value || ""}`)) ||
      buttons.find((el) => el.tagName === "BUTTON" && (el.type || "submit") === "submit") ||
      buttons[0];

    scored.push({
      form,
      emailField,
      passwordField: passwords[0],
      confirmField: passwords.length > 1 ? passwords[1] : null,
      nameField,
      phoneField,
      submit,
      // A form in a box over the page is the one being asked about.
      score: (submit ? 2 : 0) + (emailField && emailField.type === "email" ? 1 : 0),
    });
  }

  if (!scored.length) {
    return { found: false, why: `no ${mode} form with an email and a password on this page` };
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  const mark = (el, role) => {
    if (el) el.setAttribute(MARK, role);
  };
  mark(best.emailField, "email");
  mark(best.passwordField, "password");
  mark(best.confirmField, "confirm");
  mark(best.nameField, "name");
  mark(best.phoneField, "phone");
  mark(best.submit, "submit");

  return {
    found: true,
    kind: mode,
    hasName: Boolean(best.nameField),
    hasPhone: Boolean(best.phoneField),
    hasConfirm: Boolean(best.confirmField),
    hasSubmit: Boolean(best.submit),
  };
}

/**
 * A link on the page that leads to the sign-in form, for a wall that only offers
 * registration and puts "already have an account? sign in" underneath it.
 */
function findSignInLink() {
  const SIGN_IN_RE = /(sign\s*-?\s*in|log\s*-?\s*in|login)/i;
  const links = Array.from(document.querySelectorAll("a[href]"));
  for (const link of links) {
    const label = `${link.textContent || ""} ${link.getAttribute("aria-label") || ""}`;
    const href = link.getAttribute("href") || "";
    if (!SIGN_IN_RE.test(label) && !SIGN_IN_RE.test(href)) continue;
    if (/^(#|javascript:|mailto:)/i.test(href)) continue;
    try {
      return new URL(href, location.href).toString();
    } catch (_) {
      /* a href we cannot resolve is no use */
    }
  }
  return "";
}

/** Are we signed in now? Judged on the page saying so, not on hope. */
function readSignedInMarks() {
  const text = (document.body ? document.body.innerText || "" : "").toLowerCase();
  const links = Array.from(document.querySelectorAll("a, button"))
    .map((el) => (el.textContent || "").trim().toLowerCase())
    .filter(Boolean);
  return {
    saysSignOut: links.some((label) => /(sign\s*-?\s*out|log\s*-?\s*out|logout)/.test(label)),
    saysMyAccount: links.some((label) => /(my account|my profile|my searches|saved searches|dashboard)/.test(label)),
    stillHasPassword: Boolean(document.querySelector('input[type="password"]')),
    saysWrong: /(incorrect|invalid|does not match|wrong password|could not sign|unable to log|try again)/.test(text),
  };
}
/* eslint-enable no-undef */

/* ---------------------------------------------------------------- */
/* doing it                                                         */
/* ---------------------------------------------------------------- */

/** Type into a tagged field as keystrokes, so a scripted form notices. */
async function fill(page, role, value) {
  const selector = `[data-dnlv-field="${role}"]`;
  const field = await page.$(selector);
  if (!field) return false;
  try {
    await field.click({ clickCount: 3 });
    await field.type(value, { delay: 25 });
    return true;
  } catch (_) {
    return false;
  } finally {
    await field.dispose().catch(() => {});
  }
}

/**
 * Fill in one account form and submit it.
 *
 * Answers whether the page stopped asking, which is the only evidence worth
 * having - a form that submits and comes back with the same password box on it
 * has not signed anybody in.
 */
async function submitForm(page, mode, log) {
  const account = config.qualAccount;
  const found = await page.evaluate(tagAccountForm, mode).catch(() => ({ found: false, why: "the page would not run our script" }));
  if (!found.found) return { ok: false, why: found.why || `no ${mode} form here` };

  if (!(await fill(page, "email", account.email))) {
    return { ok: false, why: "the email box would not take the address" };
  }
  if (!(await fill(page, "password", account.password))) {
    return { ok: false, why: "the password box would not take a value" };
  }
  if (found.hasConfirm) await fill(page, "confirm", account.password);
  if (found.hasName && account.name) await fill(page, "name", account.name);
  if (found.hasPhone && account.phone) await fill(page, "phone", account.phone);

  log(mode === "signin" ? "Signing in with the QUAL account" : "Creating a QUAL account on their site");

  /*
   * The form may navigate or may answer in place, so both are waited for at once
   * and neither is required. What decides the outcome is the state of the page
   * afterwards.
   */
  const submit = await page.$('[data-dnlv-field="submit"]');
  try {
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS })
        .catch(() => null),
      submit ? submit.click().catch(() => null) : page.keyboard.press("Enter").catch(() => null),
    ]);
  } finally {
    if (submit) await submit.dispose().catch(() => {});
  }

  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

  const marks = await page.evaluate(readSignedInMarks).catch(() => null);
  if (!marks) return { ok: false, why: "the page stopped answering after the form was sent" };
  if (marks.saysWrong && marks.stillHasPassword) {
    return { ok: false, why: "the site said those details were not right" };
  }
  if (marks.saysSignOut || marks.saysMyAccount) return { ok: true, how: mode };
  if (!marks.stillHasPassword) {
    // No sign-out link to point at, but the door is no longer shut. Worth
    // carrying on with, and said as the guess it is.
    return { ok: true, how: mode, unconfirmed: true };
  }
  return { ok: false, why: "the page still wants a password, so the sign in did not take" };
}

/**
 * Try to get past an account wall with the QUAL account.
 *
 * Called with the browser sitting on the wall. Answers what happened; never
 * throws, because a failed sign-in has to leave the original refusal intact
 * rather than replacing it with a worse error.
 *
 *   { attempted: false, why }            - not configured, or not for this host
 *   { attempted: true, signedIn: true }  - through; the caller reloads the listing
 *   { attempted: true, signedIn: false } - still shut, and why
 */
async function passTheWall(page, { host, log = () => {}, allowNavigation = true } = {}) {
  if (!configured()) {
    return { attempted: false, why: "no QUAL account is configured on this server" };
  }
  if (!allowedOn(host)) {
    return { attempted: false, why: `the QUAL account is not switched on for ${host}` };
  }

  const signIn = await submitForm(page, "signin", log).catch((error) => ({ ok: false, why: error.message }));
  if (signIn.ok) {
    log(`Signed in as the QUAL account${signIn.unconfirmed ? " (the page does not say so outright)" : ""}`);
    return { attempted: true, signedIn: true, how: "signin", unconfirmed: Boolean(signIn.unconfirmed) };
  }
  log(`The QUAL sign in did not work: ${signIn.why}`);

  /*
   * A wall that only shows a registration form usually has "already have an
   * account? sign in" under it. Worth one hop, and only one.
   */
  if (allowNavigation) {
    const link = await page.evaluate(findSignInLink).catch(() => "");
    if (link) {
      log(`Trying their sign-in page (${new URL(link).pathname})`);
      const ok = await page
        .goto(link, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS })
        .then((response) => Boolean(response) && response.status() < 400)
        .catch(() => false);
      if (ok) {
        const second = await submitForm(page, "signin", log).catch((error) => ({ ok: false, why: error.message }));
        if (second.ok) {
          log("Signed in as the QUAL account on their sign-in page");
          return { attempted: true, signedIn: true, how: "signin", unconfirmed: Boolean(second.unconfirmed) };
        }
        log(`That did not work either: ${second.why}`);
      }
    }
  }

  if (!registerAllowedOn(host)) {
    return {
      attempted: true,
      signedIn: false,
      why: `${signIn.why}, and creating an account is switched off for ${host}`,
    };
  }

  /*
   * Registering, only because somebody turned it on for this host knowing that
   * an IDX registration is what emails the agent a new lead.
   */
  const registered = await submitForm(page, "register", log).catch((error) => ({ ok: false, why: error.message }));
  if (registered.ok) {
    log("Created a QUAL account on their site");
    return { attempted: true, signedIn: true, how: "register", unconfirmed: Boolean(registered.unconfirmed) };
  }
  return { attempted: true, signedIn: false, why: `${signIn.why}; registering did not work either: ${registered.why}` };
}

module.exports = {
  passTheWall,
  configured,
  allowedOn,
  registerAllowedOn,
  describe,
  tagAccountForm,
  findSignInLink,
  readSignedInMarks,
};
