/*
 * The form remembers what was last typed into it.
 *
 * Making these videos is not one pass. Bill does the same site three or four
 * times over - a different script, a different voice, a screenshot instead of
 * the live capture, another take after a listing came out wrong - and every one
 * of those started with typing the name, the company, the website, the email and
 * the listing URL in again from nothing. The tool threw all of it away the
 * moment the job started, and threw it away again when "Make another video" reset
 * the form.
 *
 * So the answers are kept in localStorage and put back the next time the form is
 * opened, in this browser, on this box. Nothing goes to the server: this is the
 * same one person's browser filling their own form in again, and the server
 * already has every answer that mattered on the job it made.
 *
 * What is NOT remembered, deliberately:
 *
 *   The password. It is a session cookie's job and it is not going in a place
 *   that survives the tab being closed.
 *
 *   The screenshot. A file input cannot be filled in by script, and a stale
 *   picture of last week's listing quietly standing in for this one is exactly
 *   the sort of thing this tool exists to stop.
 *
 *   The before-shot confirmation. It is a statement about one particular
 *   screenshot, so it has to be made again for the next one.
 *
 * A remembered field selects all of its text the first time it is focused, so
 * the one thing that changed between takes - usually the listing URL - is
 * replaced by typing rather than by clearing the box out first.
 */
(function () {
  "use strict";

  var D = window.DNLV;

  /*
   * The version is in the key on purpose.
   *
   * If what is remembered changes shape, the old shape is simply never read
   * again, rather than being half-understood by newer code.
   */
  var KEY = "dnlv.maker.form.v1";

  /*
   * A browser that will not store anything must not take the form down with it.
   *
   * Safari in private browsing throws on setItem, and a locked-down profile can
   * make localStorage itself unreadable. Either way the form still works; it
   * just forgets between page loads, the way it always used to.
   */
  var fallback = {};

  function read() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return fallback;
    }
  }

  function write(value) {
    fallback = value;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(value));
    } catch (_) {
      /* remembered for this page load only, which is better than falling over */
    }
  }

  /**
   * Keep one form's answers.
   *
   * `texts` are input ids. `choices` are radio group names - those are painted
   * from the server after the page loads, so restoring one has to cope with the
   * saved option not being there any more: a script that was deleted, or a voice
   * the ElevenLabs account has stopped offering.
   *
   * `extras` are the fields that are not a plain input: an object of
   * name -> { get, set }. The address box is one, because what it holds is the
   * place the Explorer named rather than the letters in the box.
   */
  function attach(options) {
    var texts = options.texts || [];
    var choices = options.choices || [];
    var extras = options.extras || {};
    /* Which fields hold something that was put back rather than typed. */
    var restored = {};

    function save() {
      var saved = read();
      var kept = { at: new Date().toISOString(), texts: {}, choices: {}, extras: saved.extras || {} };

      texts.forEach(function (id) {
        var input = D.el(id);
        if (input) kept.texts[id] = input.value;
      });
      choices.forEach(function (name) {
        var picked = D.selectedValue(name);
        // An empty answer means the choices are not painted yet, which must not
        // wipe out the one that was saved.
        if (picked) kept.choices[name] = picked;
        else if (saved.choices && saved.choices[name]) kept.choices[name] = saved.choices[name];
      });
      Object.keys(extras).forEach(function (name) {
        var value = extras[name].get();
        if (value !== undefined) kept.extras[name] = value;
      });

      write(kept);
      return kept;
    }

    function restore() {
      var saved = read();

      texts.forEach(function (id) {
        var input = D.el(id);
        var value = saved.texts ? saved.texts[id] : "";
        if (!input || value == null || value === "") return;
        input.value = value;
        restored[id] = true;
      });

      choices.forEach(function (name) {
        var value = saved.choices ? saved.choices[name] : "";
        if (!value) return;
        // Matched on the option's own value rather than through a selector, so
        // nothing has to be escaped into one.
        var option = null;
        Array.prototype.forEach.call(document.querySelectorAll('input[name="' + name + '"]'), function (entry) {
          if (entry.value === value) option = entry;
        });
        // The saved script may have been deleted, or the voice withdrawn. Leave
        // whatever the painter chose rather than picking nothing at all.
        if (!option || option.checked) return;
        option.checked = true;
        // Radios painted by script do not fire change when they are set, and the
        // form leans on that event to follow the choice - which script is picked
        // decides the website hint and whether the clean-shot question is asked.
        option.dispatchEvent(new Event("change", { bubbles: true }));
      });

      Object.keys(extras).forEach(function (name) {
        if (!saved.extras || saved.extras[name] === undefined) return;
        if (extras[name].set(saved.extras[name])) restored[extras[name].input || name] = true;
      });

      return saved;
    }

    function forget() {
      restored = {};
      try {
        window.localStorage.removeItem(KEY);
      } catch (_) {
        /* nothing to do about a storage that will not answer */
      }
      fallback = {};
    }

    /*
     * Select all of a remembered field's text the first time it is focused.
     *
     * A click focuses the box and then puts the caret where the pointer is on
     * mouseup, which would undo the selection - so the mouseup that comes with
     * the focusing click is the one that gets stopped, and only that one.
     *
     * The flag is dropped as soon as anything is typed: after that the box holds
     * what this person just wrote, and selecting all of it every time they came
     * back to fix a letter would be a nuisance rather than a help.
     */
    function selectAllWhenRemembered(id) {
      var input = D.el(id);
      if (!input) return;
      var focusing = false;

      input.addEventListener("focus", function () {
        if (!restored[id] || !input.value) return;
        focusing = true;
        input.select();
      });
      input.addEventListener("mouseup", function (event) {
        if (!focusing) return;
        focusing = false;
        event.preventDefault();
      });
      input.addEventListener("blur", function () {
        focusing = false;
      });
      input.addEventListener("input", function () {
        restored[id] = false;
        focusing = false;
        save();
      });
    }

    texts.forEach(selectAllWhenRemembered);
    Object.keys(extras).forEach(function (name) {
      if (extras[name].input) selectAllWhenRemembered(extras[name].input);
    });
    choices.forEach(function (name) {
      document.addEventListener("change", function (event) {
        if (event.target && event.target.name === name) save();
      });
    });

    return {
      save: save,
      restore: restore,
      forget: forget,
      /** Was this field's value put back from last time, rather than typed now? */
      wasRestored: function (id) {
        return Boolean(restored[id]);
      },
    };
  }

  D.remember = { attach: attach, key: KEY };
})();
