/*
 * The address box on the upload path: the Neighborhood Explorer's own picker.
 *
 * Bill uploaded a screenshot of a Peoria listing, typed the address into four
 * free-text boxes, and the video came back showing schools in Smyrna, Georgia.
 * Four boxes could not tell him whether what he typed was a place at all - a
 * geocoder was only asked about it a minute later, once the job was already
 * running, and a geocoder will answer a loose query with a street of the same
 * name in another state.
 *
 * So this is one box with the Explorer's own suggestions under it, the same way
 * the Explorer's search box works. The suggestions come from the Explorer's
 * autocomplete through /api/places, and picking one is what fills the address in:
 * from then on the address is a place the Explorer named, and the server resolves
 * that same place before the job starts.
 *
 * Typing the whole address by hand still works, because a picker that will not
 * suggest must not be a dead end - the server checks it against the town before
 * anything is filmed. But picking is the path, and the hint says so.
 */
(function () {
  "use strict";

  var D = window.DNLV;
  var API = D.API;

  var WAIT_MS = 280;
  var MIN_LETTERS = 3;

  /**
   * Wire a text input up to the picker.
   *
   * `fields` names the hidden inputs the chosen place is written into, which is
   * what the form posts: the description the Explorer gave it, and the street,
   * town, state and ZIP split out of it so the rest of the tool sees the same
   * shape a listing page's heading would have given it.
   */
  function attach(options) {
    var input = D.el(options.input);
    var list = D.el(options.list);
    var note = D.el(options.note);
    if (!input || !list) return null;

    var picked = null;
    var timer = null;
    var latest = 0;

    function clearList() {
      list.innerHTML = "";
      D.show(list, false);
    }

    function say(message) {
      if (note) D.showMessage(note, message);
    }

    /* What the form sends. Empty when nothing has been picked. */
    function value() {
      if (picked) {
        return {
          addressPlace: picked.description,
          addressStreet: picked.street || picked.description,
          addressCity: picked.city || "",
          addressState: picked.state || "",
          addressZip: picked.zip || "",
        };
      }
      /*
       * Typed and not picked. The whole line goes as the street, because that is
       * what was typed and the server resolves the line rather than the parts -
       * splitting it here would be this code guessing at an address again.
       */
      var typed = input.value.trim();
      return {
        addressPlace: "",
        addressStreet: typed,
        addressCity: "",
        addressState: "",
        addressZip: "",
      };
    }

    function choose(suggestion) {
      picked = suggestion;
      input.value = suggestion.description;
      clearList();
      say("");
      if (options.onPick) options.onPick(suggestion);
    }

    function paint(suggestions) {
      list.innerHTML = "";
      if (!suggestions.length) {
        D.show(list, false);
        return;
      }
      suggestions.forEach(function (suggestion) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = "suggest__item";
        row.innerHTML =
          '<strong>' +
          D.escapeHtml(suggestion.street || suggestion.description) +
          "</strong>" +
          (suggestion.city || suggestion.state
            ? '<span>' +
              D.escapeHtml([suggestion.city, [suggestion.state, suggestion.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")) +
              "</span>"
            : "");
        row.addEventListener("click", function () {
          choose(suggestion);
        });
        list.appendChild(row);
      });
      D.show(list, true);
    }

    function ask() {
      var query = input.value.trim();
      if (query.length < MIN_LETTERS) {
        clearList();
        return;
      }
      var mine = ++latest;
      D.json(API + "/places?q=" + encodeURIComponent(query)).then(function (result) {
        // A slower answer to an older query must not replace a newer one.
        if (mine !== latest) return;
        var body = result.body || {};
        if (!result.ok || body.reachable === false) {
          clearList();
          say("The Explorer's address lookup could not be reached, so there are no suggestions. Type the whole address - street, town, state and ZIP - and it will be checked before anything is filmed.");
          return;
        }
        say("");
        paint(body.suggestions || []);
      });
    }

    input.addEventListener("input", function () {
      // Editing what was picked means it is not that place any more.
      picked = null;
      if (timer) clearTimeout(timer);
      timer = setTimeout(ask, WAIT_MS);
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") clearList();
      if (event.key !== "Enter") return;
      // Enter on a list of suggestions takes the first one rather than
      // submitting the form with a half-typed address.
      var first = list.querySelector(".suggest__item");
      if (first && !list.hidden) {
        event.preventDefault();
        first.click();
      }
    });

    input.addEventListener("blur", function () {
      // After the click on a suggestion has had its chance to land.
      setTimeout(clearList, 180);
    });

    return {
      value: value,
      /** Has a suggestion been chosen, rather than typed over? */
      isPicked: function () {
        return Boolean(picked);
      },
      typed: function () {
        return input.value.trim();
      },
      reset: function () {
        picked = null;
        input.value = "";
        clearList();
        say("");
      },
      /*
       * What this box is holding, and how to hand it back later.
       *
       * The form remembers its answers between takes (see public/js/remember.js)
       * and this box is the one that is not just letters: what it holds is the
       * place the Explorer named. Saving the description alone would put the
       * words back as something typed, and the tool would go and resolve them
       * again - so the chosen suggestion is kept whole and restored whole,
       * exactly as picked.
       */
      state: function () {
        return { typed: input.value, picked: picked };
      },
      restore: function (saved) {
        if (!saved || typeof saved !== "object") return false;
        if (saved.picked && saved.picked.description) {
          picked = saved.picked;
          input.value = saved.picked.description;
        } else {
          picked = null;
          input.value = String(saved.typed || "");
        }
        clearList();
        say("");
        return Boolean(input.value);
      },
    };
  }

  D.placePicker = { attach: attach };
})();
