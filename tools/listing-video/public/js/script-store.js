/*
 * Where Bill's scripts live: this browser, and nowhere else.
 *
 * WHY
 *
 * They used to be JSON files on the Heroku dyno. Heroku throws the dyno's disk
 * away and replaces the whole slug on every deploy, so every ship wiped every
 * script anybody had written or edited and quietly reseeded the shipped three.
 * Bill lost his work repeatedly, and nothing in the interface warned him it was
 * going to happen.
 *
 * A database or a bucket would fix the wiping. Bill asked for neither, and the
 * reason is not storage: he and Myles want DIFFERENT scripts. A shared store
 * puts each of their working drafts in the other's picker. localStorage is one
 * copy per person by construction, needs no addon, and a deploy cannot reach
 * it - which is the whole complaint.
 *
 * Cookies were the other suggestion and are not usable: a cookie is about 4KB
 * and the shipped SE-to-NE script alone is several times that.
 *
 * WHAT IS WHERE
 *
 *   shipped defaults   the server, out of src/default-templates.js, read-only.
 *                      They update when we deploy, which is what we want.
 *   custom scripts     here. They never touch the server except to be validated
 *                      and to be filmed.
 *   edited defaults    here, under the shipped script's own id, as an override.
 *                      "Put the shipped one back" deletes the override; it does
 *                      not overwrite anything of anybody's.
 *   deleted defaults   here, as a tombstone, so a script somebody deliberately
 *                      got rid of does not come back on the next deploy.
 *
 * The merge is: every shipped default that has neither an override nor a
 * tombstone, plus every local script. A local script always wins over a shipped
 * one with the same id. Nothing on the server ever overwrites anything here.
 *
 * This file is loaded by the browser AND required by Node, so the merging and
 * the survive-a-deploy rules are tested against the code that runs rather than
 * a description of it.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.DNScriptStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /*
   * The version is in the key on purpose.
   *
   * If what is kept changes shape, the old shape is never read by newer code
   * instead of being half-understood by it. Bumping this abandons scripts, so
   * it is not a thing to do lightly - export first.
   */
  var KEY = "dnlv.scripts.v1";

  function nowIso() {
    return new Date().toISOString();
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  /**
   * A store over one storage object.
   *
   * `storage` is localStorage in the browser and a stand-in in tests. A browser
   * that refuses to store anything - Safari in private browsing throws on
   * setItem - falls back to memory for the page load rather than taking the
   * Scripts page down: it forgets when the tab closes, which is what it did
   * before any of this existed.
   */
  function create(options) {
    var settings = options || {};
    var storage = settings.storage || null;
    var key = settings.key || KEY;
    var memory = null;

    function readRaw() {
      var text = null;
      try {
        text = storage ? storage.getItem(key) : null;
      } catch (_) {
        text = null;
      }
      if (text == null) return memory ? clone(memory) : blank();
      try {
        var parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object") return blank();
        return {
          version: 1,
          savedAt: parsed.savedAt || null,
          scripts: parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {},
          hidden: Array.isArray(parsed.hidden) ? parsed.hidden.map(String) : [],
        };
      } catch (_) {
        // Something else wrote nonsense under our key. Start clean rather than
        // throwing on every page load, but do not overwrite it until a save.
        return blank();
      }
    }

    function blank() {
      return { version: 1, savedAt: null, scripts: {}, hidden: [] };
    }

    function writeRaw(value) {
      var kept = { version: 1, savedAt: nowIso(), scripts: value.scripts || {}, hidden: value.hidden || [] };
      memory = clone(kept);
      try {
        if (storage) storage.setItem(key, JSON.stringify(kept));
      } catch (_) {
        /* kept for this page load only, which beats losing the edit outright */
      }
      return kept;
    }

    /* ------------------------------------------------------------ */
    /* reading                                                       */
    /* ------------------------------------------------------------ */

    /** Every script in this browser, newest edit first is not the order - name is. */
    function local() {
      var saved = readRaw();
      return Object.keys(saved.scripts)
        .map(function (id) {
          return saved.scripts[id];
        })
        .filter(function (entry) {
          return entry && entry.id;
        })
        .sort(byName);
    }

    function byName(a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""));
    }

    /** Ids of shipped scripts somebody deleted here. */
    function hidden() {
      return readRaw().hidden.slice();
    }

    /**
     * The list the pickers show: shipped defaults plus what is in this browser.
     *
     * `defaults` is whatever GET /api/templates last returned. A local script
     * with the same id as a shipped one is an edited default and replaces it.
     */
    function merged(defaults) {
      var saved = readRaw();
      var out = [];

      (defaults || []).forEach(function (shipped) {
        if (!shipped || !shipped.id) return;
        if (saved.hidden.indexOf(shipped.id) !== -1) return;
        var mine = saved.scripts[shipped.id];
        out.push(mine ? decorate(mine, shipped) : decorate(shipped, shipped));
      });

      Object.keys(saved.scripts).forEach(function (id) {
        var mine = saved.scripts[id];
        if (!mine || !mine.id) return;
        var isEditedDefault = (defaults || []).some(function (shipped) {
          return shipped && shipped.id === id;
        });
        if (isEditedDefault) return;
        out.push(decorate(mine, null));
      });

      return out.sort(byName);
    }

    /**
     * One script, with the two facts the interface needs about where it lives.
     *
     *   savedHere    it is in this browser, so it survives a deploy and nobody
     *                else can see it
     *   editedFrom   it is a shipped script somebody changed, so there is an
     *                original to put back
     */
    function decorate(template, shipped) {
      var saved = readRaw();
      var mine = Boolean(saved.scripts[template.id]);
      return Object.assign(clone(template), {
        savedHere: mine,
        builtIn: Boolean(shipped),
        editedFrom: mine && shipped ? shipped.id : null,
      });
    }

    function get(id, defaults) {
      var saved = readRaw();
      if (saved.scripts[id]) {
        return decorate(
          saved.scripts[id],
          (defaults || []).filter(function (shipped) {
            return shipped.id === id;
          })[0] || null
        );
      }
      var shipped = (defaults || []).filter(function (entry) {
        return entry.id === id;
      })[0];
      return shipped ? decorate(shipped, shipped) : null;
    }

    function has(id) {
      return Boolean(readRaw().scripts[id]);
    }

    /* ------------------------------------------------------------ */
    /* writing                                                       */
    /* ------------------------------------------------------------ */

    /**
     * Keep a script in this browser.
     *
     * `template` is what the server handed back from validation, so what is
     * stored has already been through the same rules a shipped script obeys and
     * cannot come back as something a render would refuse.
     */
    function save(template) {
      if (!template || !template.id) throw new Error("A script needs an id before it can be saved.");
      var saved = readRaw();
      var previous = saved.scripts[template.id];
      saved.scripts[template.id] = Object.assign(clone(template), {
        createdAt: (previous && previous.createdAt) || template.createdAt || nowIso(),
        updatedAt: nowIso(),
      });
      // Saving over a shipped script somebody had deleted brings it back, which
      // is what saving it obviously means.
      saved.hidden = saved.hidden.filter(function (id) {
        return id !== template.id;
      });
      writeRaw(saved);
      return saved.scripts[template.id];
    }

    /**
     * An id nothing is using yet.
     *
     * Checked against the shipped list as well, so a new script called "SE to NE
     * upgrade" becomes se-to-ne-upgrade-2 rather than silently shadowing the
     * shipped one of that name.
     */
    function freeId(base, defaults) {
      var saved = readRaw();
      var taken = function (id) {
        return (
          Boolean(saved.scripts[id]) ||
          (defaults || []).some(function (shipped) {
            return shipped.id === id;
          })
        );
      };
      if (!taken(base)) return base;
      for (var suffix = 2; suffix < 200; suffix += 1) {
        var candidate = (base + "-" + suffix).slice(0, 60);
        if (!taken(candidate)) return candidate;
      }
      throw new Error("There are too many scripts with that name already. Pick a different one.");
    }

    /**
     * Get rid of a script.
     *
     * A local one goes. A shipped one cannot be deleted from the server, so it
     * is remembered as hidden here - otherwise the next page load would put it
     * straight back, and so would the next deploy.
     */
    function remove(id, defaults) {
      var saved = readRaw();
      var wasLocal = Boolean(saved.scripts[id]);
      delete saved.scripts[id];
      var isShipped = (defaults || []).some(function (shipped) {
        return shipped.id === id;
      });
      if (isShipped && saved.hidden.indexOf(id) === -1) saved.hidden.push(id);
      writeRaw(saved);
      return { removed: wasLocal || isShipped, wasLocal: wasLocal, wasShipped: isShipped };
    }

    /**
     * Put a shipped script back the way it ships.
     *
     * This is the only thing that discards an edit, it is asked for by name, and
     * it touches exactly one script. The old server-side "restore defaults"
     * rewrote every shipped script on the box in one go, which is how an edit
     * somebody wanted could disappear because somebody else pressed a button.
     */
    function resetToShipped(id) {
      var saved = readRaw();
      var had = Boolean(saved.scripts[id]);
      delete saved.scripts[id];
      saved.hidden = saved.hidden.filter(function (entry) {
        return entry !== id;
      });
      writeRaw(saved);
      return had;
    }

    /* ------------------------------------------------------------ */
    /* moving scripts between browsers                               */
    /* ------------------------------------------------------------ */

    /**
     * Everything in this browser as a file.
     *
     * The way to get a script onto another machine, and the way to keep a copy
     * of one that only exists in a browser history somebody might clear.
     */
    function exportAll() {
      var saved = readRaw();
      return {
        kind: "dream-neighborhood-listing-video-scripts",
        version: 1,
        exportedAt: nowIso(),
        hidden: saved.hidden,
        scripts: Object.keys(saved.scripts).map(function (id) {
          return saved.scripts[id];
        }),
      };
    }

    /**
     * Take scripts in from a file, or from the old server-side files.
     *
     * Nothing is overwritten without being asked: a script whose id is already
     * here is given a free one instead, so importing twice makes a second copy
     * rather than flattening the copy that was being worked on. Pass
     * `{ overwrite: true }` for the one case where replacing is the point.
     */
    function importMany(list, options) {
      var settings = options || {};
      var defaults = settings.defaults || [];
      var saved = readRaw();
      var added = [];
      var renamed = [];

      (Array.isArray(list) ? list : []).forEach(function (template) {
        if (!template || !template.id) return;
        var id = template.id;
        if (saved.scripts[id] && !settings.overwrite) {
          // freeId reads through readRaw, which does not know about the ids
          // added earlier in this same loop, so they are tracked here too.
          var candidate = freeId(id, defaults);
          while (added.indexOf(candidate) !== -1) candidate = freeId(candidate + "-2", defaults);
          renamed.push({ from: id, to: candidate });
          id = candidate;
        }
        saved.scripts[id] = Object.assign(clone(template), {
          id: id,
          builtIn: false,
          createdAt: template.createdAt || nowIso(),
          updatedAt: nowIso(),
        });
        added.push(id);
      });

      writeRaw(saved);
      return { added: added, renamed: renamed };
    }

    /** How much is in here, for the line that says so on the Scripts page. */
    function stats() {
      var saved = readRaw();
      var ids = Object.keys(saved.scripts);
      return {
        count: ids.length,
        hidden: saved.hidden.length,
        savedAt: saved.savedAt,
        bytes: JSON.stringify(saved).length,
      };
    }

    /** Empty this browser's scripts. Only ever from a button that says so twice. */
    function forgetEverything() {
      memory = null;
      try {
        if (storage) storage.removeItem(key);
      } catch (_) {
        /* nothing to do about a storage that will not answer */
      }
    }

    return {
      key: key,
      local: local,
      hidden: hidden,
      merged: merged,
      get: get,
      has: has,
      save: save,
      freeId: freeId,
      remove: remove,
      resetToShipped: resetToShipped,
      exportAll: exportAll,
      importMany: importMany,
      stats: stats,
      forgetEverything: forgetEverything,
    };
  }

  /** A name turned into an id, the same way the server does it. */
  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/['\u2019]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  return { create: create, slugify: slugify, KEY: KEY };
});
