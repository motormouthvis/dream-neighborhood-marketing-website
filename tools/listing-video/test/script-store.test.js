"use strict";

/*
 * Where Bill's scripts live, and what it takes to lose them.
 *
 * The bug: scripts were JSON files on the Heroku dyno, Heroku replaces the
 * whole slug on every deploy, and the disk goes with it. Every ship wiped every
 * custom script and every edit and put the shipped three back, and nothing in
 * the interface ever said that would happen. Bill lost months of work to it,
 * more than once.
 *
 * The fix: they live in the browser, one copy per person, which is also what
 * Bill and Myles wanted for their own reason - they want different scripts and
 * neither wants the other's in their picker.
 *
 * So the thing these tests have to prove is not "saving works". It is that
 * NOTHING the server does can take a script away: not a deploy, not a changed
 * default, not a shipped script being renamed or withdrawn, and not the tool
 * asking for its defaults back.
 *
 * public/js/script-store.js is loaded by the browser and required here, so this
 * is the code that runs rather than a description of it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const scriptStore = require("../public/js/script-store.js");
const { DEFAULT_TEMPLATES } = require("../src/default-templates");
const templates = require("../src/templates");

/** localStorage, as far as the store is concerned. */
function fakeStorage(seed) {
  const kept = Object.assign({}, seed || {});
  return {
    getItem: (key) => (key in kept ? kept[key] : null),
    setItem: (key, value) => {
      kept[key] = String(value);
    },
    removeItem: (key) => {
      delete kept[key];
    },
    /** What is actually on the disk of this browser, for the tests to inspect. */
    raw: kept,
  };
}

const shipped = () => templates.listDefaults();

/** A script as the server hands one back from validation. */
function script(name, overrides) {
  return templates.cleanTemplate(
    Object.assign(
      {
        name,
        explorers: "se",
        notes: "",
        beats: [
          { scene: "listing", seconds: 6, text: "Here is your listing as it is today." },
          { scene: "listing-button", seconds: 3, text: "And here it is with the button on it." },
          { scene: "se", seconds: 5, text: "Schools, right on your site." },
        ],
      },
      overrides || {}
    ),
    { id: (overrides && overrides.id) || undefined }
  );
}

/* ---------------------------------------------------------------- */
/* the list somebody sees                                            */
/* ---------------------------------------------------------------- */

test("with nothing saved, the list is exactly what the server ships", () => {
  const store = scriptStore.create({ storage: fakeStorage() });
  const list = store.merged(shipped());

  assert.deepEqual(
    list.map((entry) => entry.id).sort(),
    shipped().map((entry) => entry.id).sort()
  );
  assert.ok(list.every((entry) => entry.builtIn && !entry.savedHere));
});

test("a script written here sits in the same list as the shipped ones", () => {
  const store = scriptStore.create({ storage: fakeStorage() });
  store.save(script("Bill's trade show cut", { id: "bills-trade-show-cut" }));

  const list = store.merged(shipped());
  assert.equal(list.length, shipped().length + 1);

  const mine = list.find((entry) => entry.id === "bills-trade-show-cut");
  assert.equal(mine.savedHere, true, "it is his, and the list has to say so");
  assert.equal(mine.builtIn, false);
  assert.equal(mine.editedFrom, null);
});

test("editing a shipped script keeps one entry, not two", () => {
  const store = scriptStore.create({ storage: fakeStorage() });
  const original = templates.getDefault("vanessa-se-only-v11");
  store.save(Object.assign({}, original, { name: "School only, Bill's cut" }));

  const list = store.merged(shipped());
  assert.equal(list.length, shipped().length, "an edited default replaces it rather than doubling it");

  const edited = list.find((entry) => entry.id === "vanessa-se-only-v11");
  assert.equal(edited.name, "School only, Bill's cut");
  assert.equal(edited.savedHere, true);
  assert.equal(edited.editedFrom, "vanessa-se-only-v11", "and there is a shipped one to put back");
});

/* ---------------------------------------------------------------- */
/* the deploy                                                        */
/* ---------------------------------------------------------------- */

/*
 * The regression test for the whole change.
 *
 * A deploy is, from here, the server answering /api/templates with a different
 * set of defaults. Everything about it changes - a default is reworded, one is
 * withdrawn, a new one appears - and none of it may touch what is in the
 * browser.
 */
test("a deploy cannot touch a script saved in this browser", () => {
  const storage = fakeStorage();
  const store = scriptStore.create({ storage });

  const mine = store.save(script("Bill's own", { id: "bills-own", notes: "Months of work." }));
  const myEditOfADefault = store.save(
    Object.assign({}, templates.getDefault("se-to-ne-upgrade"), { name: "Upgrade, Bill's wording" })
  );

  const before = JSON.stringify(storage.raw);

  // Ship. The defaults are rewritten, one is dropped and one is new.
  const afterDeploy = [
    Object.assign({}, templates.getDefault("vanessa-se-only-v11"), { name: "School only (v12)" }),
    Object.assign({}, templates.getDefault("se-to-ne-upgrade"), { notes: "Reworded upstream." }),
    Object.assign({}, script("Brand new shipped script", { id: "brand-new-shipped" }), { builtIn: true }),
  ];
  const list = store.merged(afterDeploy);

  assert.equal(JSON.stringify(storage.raw), before, "a deploy writes nothing into this browser");

  const stillMine = list.find((entry) => entry.id === "bills-own");
  assert.deepEqual(
    { name: stillMine.name, notes: stillMine.notes, beats: stillMine.beats },
    { name: mine.name, notes: mine.notes, beats: mine.beats },
    "his own script is untouched, word for word"
  );

  const stillEdited = list.find((entry) => entry.id === "se-to-ne-upgrade");
  assert.equal(stillEdited.name, myEditOfADefault.name, "and so is his edit of a shipped one");
  assert.notEqual(stillEdited.notes, "Reworded upstream.", "the deploy does not reword what he changed");

  // A shipped script he has NOT edited does pick the deploy up, which is the
  // point of leaving them on the server.
  assert.equal(list.find((entry) => entry.id === "vanessa-se-only-v11").name, "School only (v12)");
  assert.ok(list.some((entry) => entry.id === "brand-new-shipped"), "and a new one turns up");
});

test("a script whose shipped original is withdrawn is still here", () => {
  const store = scriptStore.create({ storage: fakeStorage() });
  store.save(Object.assign({}, templates.getDefault("vanessa-se-ne-v11"), { name: "The one Bill uses" }));

  // The next deploy drops that default entirely.
  const list = store.merged(shipped().filter((entry) => entry.id !== "vanessa-se-ne-v11"));

  const kept = list.find((entry) => entry.id === "vanessa-se-ne-v11");
  assert.ok(kept, "his copy does not go with the shipped one");
  assert.equal(kept.name, "The one Bill uses");
  assert.equal(kept.savedHere, true);
  assert.equal(kept.builtIn, false, "with nothing shipped behind it, it is simply his");
});

test("nothing on the server can put back a shipped script somebody deleted", () => {
  const store = scriptStore.create({ storage: fakeStorage() });
  store.remove("vanessa-se-only-v11", shipped());

  assert.ok(!store.merged(shipped()).some((entry) => entry.id === "vanessa-se-only-v11"));
  // Every subsequent page load, and every deploy, offers it again. It stays gone.
  assert.ok(!store.merged(shipped()).some((entry) => entry.id === "vanessa-se-only-v11"));
  assert.deepEqual(store.hidden(), ["vanessa-se-only-v11"]);
});

/* ---------------------------------------------------------------- */
/* putting one shipped script back, and only that one                */
/* ---------------------------------------------------------------- */

/*
 * The old "put the shipped scripts back" button rewrote every shipped script on
 * the box in one go, for everybody. That is a second way to lose an edit: one
 * person presses it and somebody else's work is gone.
 */
test("putting a shipped script back touches that script and nothing else", () => {
  const store = scriptStore.create({ storage: fakeStorage() });
  store.save(Object.assign({}, templates.getDefault("vanessa-se-only-v11"), { name: "School only, edited" }));
  store.save(Object.assign({}, templates.getDefault("se-to-ne-upgrade"), { name: "Upgrade, edited" }));
  store.save(script("Bill's own", { id: "bills-own" }));

  assert.equal(store.resetToShipped("vanessa-se-only-v11"), true);

  const list = store.merged(shipped());
  assert.equal(list.find((entry) => entry.id === "vanessa-se-only-v11").name, "School only (v11)");
  assert.equal(list.find((entry) => entry.id === "vanessa-se-only-v11").savedHere, false);

  assert.equal(list.find((entry) => entry.id === "se-to-ne-upgrade").name, "Upgrade, edited", "the other edit stands");
  assert.ok(list.some((entry) => entry.id === "bills-own"), "and his own script is still there");
});

test("saving a shipped script somebody had deleted brings it back", () => {
  const store = scriptStore.create({ storage: fakeStorage() });
  store.remove("se-to-ne-upgrade", shipped());
  store.save(Object.assign({}, templates.getDefault("se-to-ne-upgrade"), { name: "Actually I want this" }));

  const found = store.merged(shipped()).find((entry) => entry.id === "se-to-ne-upgrade");
  assert.ok(found, "saving it obviously means un-hiding it");
  assert.equal(found.name, "Actually I want this");
});

/* ---------------------------------------------------------------- */
/* ids                                                               */
/* ---------------------------------------------------------------- */

test("a new script never quietly shadows a shipped one", () => {
  const store = scriptStore.create({ storage: fakeStorage() });
  const id = store.freeId(scriptStore.slugify("SE to NE upgrade"), shipped());
  assert.equal(id, "se-to-ne-upgrade-2");

  store.save(script("SE to NE upgrade", { id }));
  const list = store.merged(shipped());
  assert.equal(list.filter((entry) => entry.name === "SE to NE upgrade").length, 2, "two entries, two ids");
  assert.equal(list.find((entry) => entry.id === "se-to-ne-upgrade").savedHere, false, "the shipped one is intact");
});

test("the id a script is saved under is the one every video already refers to", () => {
  const store = scriptStore.create({ storage: fakeStorage() });
  const first = store.save(script("Trade show", { id: "trade-show" }));
  const renamed = store.save(Object.assign({}, first, { name: "Trade show, longer" }));

  assert.equal(renamed.id, "trade-show", "renaming a script does not renumber it");
  assert.equal(store.merged(shipped()).filter((entry) => entry.id === "trade-show").length, 1);
  assert.equal(renamed.createdAt, first.createdAt, "and it keeps the day it was written");
  assert.notEqual(renamed.updatedAt, null);
});

/* ---------------------------------------------------------------- */
/* getting scripts out, and back in                                  */
/* ---------------------------------------------------------------- */

/*
 * localStorage is per browser, so it is also per browser to lose: clearing site
 * data takes the scripts with it, and there is no server copy to fall back on.
 * Export is the answer to that and the way onto a second machine, so it has to
 * round-trip exactly.
 */
test("scripts export and come back word for word", () => {
  const store = scriptStore.create({ storage: fakeStorage() });
  store.save(script("Bill's own", { id: "bills-own", notes: "Do not lose this." }));
  store.save(Object.assign({}, templates.getDefault("se-to-ne-upgrade"), { name: "Upgrade, Bill's cut" }));

  const file = JSON.parse(JSON.stringify(store.exportAll()));
  assert.equal(file.scripts.length, 2);

  const fresh = scriptStore.create({ storage: fakeStorage() });
  const brought = fresh.importMany(file.scripts, { defaults: shipped() });
  assert.equal(brought.added.length, 2);
  assert.deepEqual(brought.renamed, []);

  const there = fresh.merged(shipped()).find((entry) => entry.id === "bills-own");
  assert.equal(there.notes, "Do not lose this.");
  assert.deepEqual(there.beats, store.get("bills-own", shipped()).beats);
});

test("importing twice makes a second copy rather than flattening the first", () => {
  const store = scriptStore.create({ storage: fakeStorage() });
  store.save(script("Bill's own", { id: "bills-own", notes: "The one being worked on." }));

  const brought = store.importMany([script("Bill's own", { id: "bills-own", notes: "An older copy." })], {
    defaults: shipped(),
  });

  assert.deepEqual(brought.renamed, [{ from: "bills-own", to: "bills-own-2" }]);
  assert.equal(store.get("bills-own", shipped()).notes, "The one being worked on.", "the copy in hand is not touched");
  assert.equal(store.get("bills-own-2", shipped()).notes, "An older copy.");
});

test("the scripts left on the server disk can be brought in", () => {
  const store = scriptStore.create({ storage: fakeStorage() });

  // What GET /api/legacy-templates hands over: scripts written before they moved
  // into the browser, still sitting on a dyno that has not been recycled yet.
  const onDisk = [
    Object.assign({}, script("Bill's rescued script", { id: "bills-rescued-script" }), {
      createdAt: "2026-08-01T00:00:00.000Z",
    }),
  ];
  const brought = store.importMany(onDisk, { defaults: shipped() });

  assert.deepEqual(brought.added, ["bills-rescued-script"]);
  const rescued = store.get("bills-rescued-script", shipped());
  assert.equal(rescued.name, "Bill's rescued script");
  assert.equal(rescued.createdAt, "2026-08-01T00:00:00.000Z", "it keeps the day it was written");
  assert.equal(rescued.savedHere, true, "and from now on a deploy cannot reach it");
});

/* ---------------------------------------------------------------- */
/* the awkward cases                                                 */
/* ---------------------------------------------------------------- */

test("a browser that refuses to store anything still works for this page load", () => {
  // Safari in private browsing throws on setItem. Losing the edit when the tab
  // closes is bad; losing the Scripts page outright is worse.
  const angry = {
    getItem: () => {
      throw new Error("no");
    },
    setItem: () => {
      throw new Error("no");
    },
    removeItem: () => {},
  };
  const store = scriptStore.create({ storage: angry });

  store.save(script("Written in a locked-down browser", { id: "locked-down" }));
  assert.ok(store.merged(shipped()).some((entry) => entry.id === "locked-down"));
});

test("nonsense under the key does not take the page down", () => {
  const store = scriptStore.create({ storage: fakeStorage({ [scriptStore.KEY]: "{not json" }) });
  assert.deepEqual(store.local(), []);
  assert.deepEqual(
    store.merged(shipped()).map((entry) => entry.id).sort(),
    shipped().map((entry) => entry.id).sort()
  );
});

test("two stores over the same storage see each other's saves", () => {
  // The Scripts page and the make-a-video picker are the same store object, but
  // two tabs are not, and the second one must not be looking at a stale copy.
  const storage = fakeStorage();
  const scriptsTab = scriptStore.create({ storage });
  const makerTab = scriptStore.create({ storage });

  scriptsTab.save(script("Just written", { id: "just-written" }));
  assert.ok(makerTab.merged(shipped()).some((entry) => entry.id === "just-written"));
});

test("what is in here can be counted, for the line that says so", () => {
  const store = scriptStore.create({ storage: fakeStorage() });
  assert.equal(store.stats().count, 0);

  store.save(script("One", { id: "one" }));
  store.save(script("Two", { id: "two" }));
  store.remove("vanessa-se-only-v11", shipped());

  const stats = store.stats();
  assert.equal(stats.count, 2);
  assert.equal(stats.hidden, 1);
  assert.ok(stats.bytes > 0);
  assert.ok(stats.savedAt);
});

/* ---------------------------------------------------------------- */
/* and the scripts are real scripts                                  */
/* ---------------------------------------------------------------- */

/*
 * What comes out of the browser is filmed, so it has to be something the render
 * accepts. The store keeps what the server validated, and the server validates
 * it again on the way back in - this checks the round trip end to end.
 */
test("a script out of this browser is one the server will film", () => {
  const store = scriptStore.create({ storage: fakeStorage() });
  store.save(script("Bill's own", { id: "bills-own" }));

  const held = store.get("bills-own", shipped());
  const asSent = templates.fromBrowser(JSON.parse(JSON.stringify(held)));

  assert.equal(asSent.id, "bills-own");
  assert.deepEqual(asSent.beats.map((beat) => beat.scene), ["listing", "listing-button", "se"]);
  assert.deepEqual(
    templates.renderBeats(asSent, { firstName: "Bill", company: "Scott Rodgers" }).map((beat) => beat.scene),
    ["listing", "listing-button", "se"]
  );
});

test("the shipped scripts are all valid scripts to start from", () => {
  for (const template of DEFAULT_TEMPLATES) {
    const store = scriptStore.create({ storage: fakeStorage() });
    const clean = templates.getDefault(template.id);
    store.save(Object.assign({}, clean, { name: `${clean.name}, edited` }));
    assert.doesNotThrow(() => templates.fromBrowser(store.get(template.id, shipped())), template.id);
  }
});
