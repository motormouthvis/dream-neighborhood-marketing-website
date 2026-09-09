/*
 * The Scripts page.
 *
 * Scripts you write or edit are saved IN THIS BROWSER, in localStorage. They
 * used to be files on the Heroku dyno, which throws its disk away on every
 * deploy - so every ship wiped Bill's work and put the shipped three back. See
 * public/js/script-store.js for why the browser and not a database.
 *
 * What that means on this page, and what it has to keep saying out loud:
 *
 *   - a script saved here is yours. Myles does not see it, and nor does the
 *     same person on another machine or in another browser profile.
 *   - clearing the browser's site data clears the scripts. Export is the
 *     answer, and it is on this page rather than buried.
 *   - the shipped scripts still come from the server, so they improve when we
 *     deploy - but only the ones nobody has edited here.
 *
 * Validation still happens on the server, once, before anything is kept: what
 * a script may contain is decided in src/templates.js and nowhere else.
 */
(function () {
  "use strict";

  var D = window.DNLV;
  var el = D.el;
  var API = D.API;
  var store = D.scripts;

  var editing = { id: null, beats: [], builtIn: false, savedHere: false };

  function scenes() {
    return (D.state.session && D.state.session.scenes) || [];
  }

  function explorerModes() {
    return (D.state.session && D.state.session.explorerModes) || [];
  }

  /* How long a beat should be, worked out from its words. See beat-timing.js. */
  function timing() {
    return window.DNBeatTiming;
  }

  /** A beat as the editor holds it, with the duration following the words. */
  function newBeat(scene) {
    return {
      scene: scene,
      seconds: timing().suggestSeconds(""),
      text: "",
      caption: { headline: "", subline: "" },
      followsText: true,
    };
  }

  /*
   * A beat off a saved script.
   *
   * Whether its duration goes on following the words is SAVED WITH THE BEAT, as
   * autoSeconds, rather than guessed at by comparing the number to the words.
   * The guess is what Bill hit: a beat a tenth of a second off the suggestion -
   * or one edited before the suggestion existed - was read as held, so the
   * number sat still while he typed and the field looked broken.
   *
   * A script saved before autoSeconds existed still gets the old guess, once.
   * Saving it writes the answer down.
   */
  function loadedBeat(beat) {
    var follows =
      beat.autoSeconds === undefined || beat.autoSeconds === null
        ? timing().isSuggested(beat.seconds, beat.text)
        : Boolean(beat.autoSeconds);
    return Object.assign({}, beat, { followsText: follows });
  }

  function listingExplorerModes() {
    return (D.state.session && D.state.session.listingExplorerModes) || [];
  }

  function neTabs() {
    return (D.state.session && D.state.session.neTabs) || [];
  }

  /* ------------------------------------------------------------ */
  /* the list                                                      */
  /* ------------------------------------------------------------ */
  function load() {
    D.showMessage(el("scriptsError"), "");
    showList();
    D.loadTemplates().then(function (list) {
      paintList(list);
      paintStorageNote();
      offerLegacyImport();
    });
  }

  /*
   * Where these scripts are, said plainly and every time.
   *
   * Bill lost months of edits to a deploy and was never told it could happen.
   * Whatever else this page does, it has to be unambiguous about which of these
   * scripts are his, where they are kept, and what would lose them.
   */
  function paintStorageNote() {
    var stats = store.stats();
    var mine = D.state.templates.filter(function (entry) {
      return entry.savedHere;
    });
    var edited = mine.filter(function (entry) {
      return entry.editedFrom;
    });

    var lines = [];
    if (!mine.length) {
      lines.push(
        "No scripts of your own yet. Anything you write or edit here is saved in this browser, so a deploy cannot touch it."
      );
    } else {
      lines.push(
        mine.length +
          (mine.length === 1 ? " script is" : " scripts are") +
          " saved in this browser" +
          (edited.length
            ? " (" + edited.length + " of them " + (edited.length === 1 ? "is a shipped script you" : "are shipped scripts you") + " edited)"
            : "") +
          ". They survive every deploy, and nobody else can see them - not Myles, and not you on another machine."
      );
      lines.push("Clearing this browser's site data would clear them. Export a copy if that worries you.");
    }
    if (stats.savedAt) lines.push("Last saved " + D.when(stats.savedAt) + ".");

    D.setText(el("scriptsStorageNote"), lines.join(" "));
    D.show(el("exportScriptsBtn"), mine.length > 0);
  }

  function showList() {
    D.show(el("scriptsList"), true);
    D.show(el("scriptsEditor"), false);
  }

  function showEditor() {
    D.show(el("scriptsList"), false);
    D.show(el("scriptsEditor"), true);
  }

  /** Which of the three a script is, in a word and in a sentence. */
  function whereItLives(template) {
    if (template.savedHere && template.editedFrom) {
      return { pill: "Edited in this browser", why: "A shipped script you changed. The original is still there to put back." };
    }
    if (template.savedHere) {
      return { pill: "Saved in this browser only", why: "Yours. It survives every deploy and nobody else can see it." };
    }
    return { pill: "Shipped default", why: "Comes with the tool. Editing it saves your copy in this browser." };
  }

  function paintList(list) {
    var wrap = el("templateList");
    wrap.innerHTML = "";
    list.forEach(function (template) {
      var lives = whereItLives(template);
      var card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        '<div class="card__head"><div><h3 class="card__title">' +
        D.escapeHtml(template.name) +
        '</h3><p class="card__meta">' +
        D.escapeHtml(template.explorersLabel) +
        " &middot; " +
        template.beatCount +
        " beats &middot; about " +
        D.runtime(template.totalSeconds) +
        (template.updatedAt ? " &middot; saved " + D.escapeHtml(D.when(template.updatedAt)) : "") +
        "<br />Films: " +
        D.escapeHtml(template.listingExplorerLabel || "") +
        "</p></div>" +
        '<span class="pill' +
        (template.savedHere ? " pill--mine" : "") +
        '">' +
        D.escapeHtml(lives.pill) +
        "</span>" +
        "</div>" +
        '<p class="card__meta">' +
        D.escapeHtml(lives.why) +
        "</p>" +
        (template.notes ? '<p class="card__notes">' + D.escapeHtml(template.notes) + "</p>" : "") +
        '<p class="card__meta"><code>' +
        D.escapeHtml(template.id) +
        "</code></p>" +
        '<div class="card__actions"></div>';

      var actions = card.querySelector(".card__actions");
      actions.appendChild(
        button("Edit", "btn--dark", function () {
          openEditor(template.id);
        })
      );
      actions.appendChild(
        button("Duplicate", "btn--ghost", function () {
          duplicate(template);
        })
      );
      // Putting a shipped script back is not the same act as deleting one, and
      // it is the safer of the two, so it gets its own button and its own word.
      if (template.savedHere && template.editedFrom) {
        actions.appendChild(
          button("Put the shipped one back", "btn--ghost", function () {
            confirmReset(template, card);
          })
        );
      }
      actions.appendChild(
        button("Delete", "btn--danger", function () {
          confirmDelete(template, card);
        })
      );

      wrap.appendChild(card);
    });
  }

  /** A copy of a script, in this browser, with a name nothing else is using. */
  function duplicate(template) {
    var name = (template.name + " copy").slice(0, 90);
    var wanted = window.DNScriptStore.slugify(name);
    var payload = Object.assign({}, template.template, {
      id: store.freeId(wanted, D.state.shipped),
      name: name,
      builtIn: false,
    });
    validate(payload).then(function (result) {
      if (!result.ok) {
        D.showMessage(el("scriptsError"), D.errorFrom(result, "That script was not duplicated."));
        return;
      }
      store.save(result.body.template);
      D.showMessage(el("scriptsOk"), 'Copied to "' + result.body.template.name + '", saved in this browser.');
      refreshEverywhere();
    });
  }

  function confirmDelete(template, card) {
    if (card.querySelector(".card__confirm")) return;
    var shipped = !template.savedHere;
    var box = document.createElement("div");
    box.className = "card__confirm";
    box.innerHTML =
      '<p><strong>Delete "' +
      D.escapeHtml(template.name) +
      '"?</strong> Videos already made with it keep working. New videos cannot use it again.' +
      (shipped
        ? " This is a shipped script, so deleting it hides it in this browser. It will not come back on the next deploy."
        : " It is only in this browser, so there is no other copy unless you exported one.") +
      "</p>";
    var row = document.createElement("div");
    row.className = "card__actions";
    row.appendChild(
      button("Yes, delete it", "btn--danger", function () {
        store.remove(template.id, D.state.shipped);
        D.showMessage(el("scriptsOk"), 'Deleted "' + template.name + '".');
        refreshEverywhere();
      })
    );
    row.appendChild(
      button("Keep it", "btn--ghost", function () {
        box.remove();
      })
    );
    box.appendChild(row);
    card.appendChild(box);
  }

  function confirmReset(template, card) {
    if (card.querySelector(".card__confirm")) return;
    var box = document.createElement("div");
    box.className = "card__confirm";
    box.innerHTML =
      '<p><strong>Put the shipped "' +
      D.escapeHtml(template.name) +
      '" back?</strong> Your edits to this one script are thrown away and it goes back to the version that ships with the tool. Nothing else you have written is touched.</p>';
    var row = document.createElement("div");
    row.className = "card__actions";
    row.appendChild(
      button("Yes, put it back", "btn--dark", function () {
        store.resetToShipped(template.id);
        D.showMessage(el("scriptsOk"), '"' + template.name + '" is back to the shipped version.');
        refreshEverywhere();
      })
    );
    row.appendChild(
      button("Keep my edits", "btn--ghost", function () {
        box.remove();
      })
    );
    box.appendChild(row);
    card.appendChild(box);
  }

  function button(label, className, onClick) {
    var node = document.createElement("button");
    node.type = "button";
    node.className = "btn btn--small " + className;
    node.textContent = label;
    node.addEventListener("click", onClick);
    return node;
  }

  function refreshEverywhere() {
    return D.loadTemplates().then(function (list) {
      paintList(list);
      D.maker.paintTemplateChoices();
      return list;
    });
  }

  /* ------------------------------------------------------------ */
  /* moving scripts in and out of this browser                     */
  /* ------------------------------------------------------------ */

  /*
   * Scripts left over from when they were files on the dyno.
   *
   * Offered once, as an import, so nothing anybody wrote before this change is
   * stranded on a disk that the next deploy will empty. The files are not
   * touched by importing them - the server has no route that deletes them.
   */
  function offerLegacyImport() {
    D.json(API + "/legacy-templates").then(function (result) {
      var found = ((result.body && result.body.templates) || []).filter(function (template) {
        return !template.matchesShipped;
      });
      var fresh = found.filter(function (template) {
        return !store.has(template.id);
      });
      D.show(el("legacyImport"), fresh.length > 0);
      if (!fresh.length) return;

      D.setText(
        el("legacyImportWhat"),
        fresh.length +
          (fresh.length === 1 ? " script is" : " scripts are") +
          " still saved on the server from before scripts moved into the browser: " +
          fresh
            .map(function (template) {
              return '"' + template.name + '"';
            })
            .join(", ") +
          ". Bring them in here and they stop being at the mercy of the next deploy. The files on the server are left where they are either way."
      );

      var button = el("legacyImportBtn");
      button.onclick = function () {
        var brought = store.importMany(fresh, { defaults: D.state.shipped });
        D.showMessage(
          el("scriptsOk"),
          "Brought " + brought.added.length + " script" + (brought.added.length === 1 ? "" : "s") + " into this browser." +
            (brought.renamed.length
              ? " " +
                brought.renamed
                  .map(function (change) {
                    return change.from + " came in as " + change.to + ", because you already had one with that id.";
                  })
                  .join(" ")
              : "")
        );
        D.show(el("legacyImport"), false);
        refreshEverywhere().then(paintStorageNote);
      };
    });
  }

  el("exportScriptsBtn").addEventListener("click", function () {
    var file = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: "application/json" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = "dream-neighborhood-scripts-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
      URL.revokeObjectURL(link.href);
    }, 2000);
    D.showMessage(el("scriptsOk"), "Downloaded. That file is the way onto another machine, and the only backup there is.");
  });

  el("importScriptsFile").addEventListener("change", function () {
    var file = (el("importScriptsFile").files || [])[0];
    if (!file) return;
    D.showMessage(el("scriptsError"), "");

    file
      .text()
      .then(function (text) {
        var parsed = JSON.parse(text);
        var list = Array.isArray(parsed) ? parsed : parsed.scripts;
        if (!Array.isArray(list) || !list.length) throw new Error("There are no scripts in that file.");
        return list;
      })
      .then(function (list) {
        // Every one goes through the server's validation before it is kept, so
        // a hand-edited file cannot put a script in here that a render would
        // then refuse to draw.
        return Promise.all(list.map(validate)).then(function (results) {
          var good = [];
          var bad = [];
          results.forEach(function (result, at) {
            if (result.ok) good.push(result.body.template);
            else bad.push((list[at] && list[at].name) || "one script");
          });
          if (!good.length) throw new Error("None of the scripts in that file could be read.");
          var brought = store.importMany(good, { defaults: D.state.shipped });
          D.showMessage(
            el("scriptsOk"),
            "Imported " +
              brought.added.length +
              " script" +
              (brought.added.length === 1 ? "" : "s") +
              " into this browser." +
              (bad.length ? " Skipped: " + bad.join(", ") + "." : "")
          );
          return refreshEverywhere().then(paintStorageNote);
        });
      })
      .catch(function (error) {
        D.showMessage(el("scriptsError"), "That file was not imported: " + error.message);
      })
      .then(function () {
        el("importScriptsFile").value = "";
      });
  });

  /* ------------------------------------------------------------ */
  /* the editor                                                    */
  /* ------------------------------------------------------------ */

  /**
   * Ask the server whether a script is allowed, and get the tidy version back.
   *
   * The browser keeps the scripts; it does not get to decide what a script may
   * contain. Scene names, tab names, durations and "School Explorer comes
   * first" are all judged in src/templates.js, so the Scripts page cannot save
   * something a render would refuse an hour later.
   */
  function validate(template) {
    return D.send("POST", API + "/templates-validate", template);
  }

  el("newTemplateBtn").addEventListener("click", function () {
    editing = { id: null, beats: [newBeat("listing")], builtIn: false, savedHere: true };
    D.setText(el("editorTitle"), "New script");
    D.setText(el("editorSub"), "Saved in this browser as soon as you press Save script. Nobody else will see it.");
    el("tplName").value = "";
    el("tplNotes").value = "";
    paintExplorerChoices("se", "absent");
    paintBeats();
    D.showMessage(el("editorError"), "");
    D.show(el("editorOk"), false);
    showEditor();
  });

  function openEditor(id) {
    var found = D.state.templates.filter(function (entry) {
      return entry.id === id;
    })[0];
    if (!found) {
      D.showMessage(el("scriptsError"), "That script could not be opened. Reload the page and try again.");
      return;
    }

    var template = found.template;
    editing = {
      id: template.id,
      beats: template.beats.map(loadedBeat),
      builtIn: Boolean(found.builtIn),
      savedHere: Boolean(found.savedHere),
    };
    D.setText(el("editorTitle"), "Edit " + template.name);
    D.setText(
      el("editorSub"),
      found.savedHere
        ? found.editedFrom
          ? "Your copy of a shipped script, saved in this browser. The shipped one is still there to put back."
          : "Yours, saved in this browser only."
        : "One of the shipped scripts. Saving takes a copy into this browser and leaves the shipped one alone, so you can always put it back."
    );
    el("tplName").value = template.name;
    el("tplNotes").value = template.notes || "";
    paintExplorerChoices(template.explorers, template.listingExplorer);
    paintBeats();
    D.showMessage(el("editorError"), "");
    D.show(el("editorOk"), false);
    showEditor();
  }

  function paintRadioGroup(wrapId, name, modes, selected) {
    var wrap = el(wrapId);
    wrap.innerHTML = "";
    modes.forEach(function (mode) {
      var label = document.createElement("label");
      label.className = "choice";
      label.innerHTML =
        '<input type="radio" name="' +
        name +
        '" value="' +
        D.escapeHtml(mode.id) +
        '"' +
        (mode.id === selected ? " checked" : "") +
        ' /><span class="choice__box"><span class="choice__mark" aria-hidden="true"></span>' +
        '<span class="choice__text"><strong class="choice__title">' +
        D.escapeHtml(mode.label) +
        "</strong></span></span>";
      wrap.appendChild(label);
    });
  }

  function paintExplorerChoices(explorers, listingExplorer) {
    paintRadioGroup("tplExplorers", "tplExplorers", explorerModes(), explorers);
    paintRadioGroup("tplListingExplorer", "tplListingExplorer", listingExplorerModes(), listingExplorer || "absent");
  }

  function paintBeats() {
    var wrap = el("beatEditor");
    wrap.innerHTML = "";
    editing.beats.forEach(function (beat, index) {
      wrap.appendChild(beatRow(beat, index));
    });
    updateTotal();
  }

  function beatRow(beat, index) {
    var row = document.createElement("div");
    row.className = "beatrow";

    var options = scenes()
      .map(function (scene) {
        return (
          '<option value="' +
          D.escapeHtml(scene.id) +
          '"' +
          (scene.id === beat.scene ? " selected" : "") +
          ">" +
          D.escapeHtml(scene.label) +
          "</option>"
        );
      })
      .join("");

    var tabOptions =
      '<option value="">In tab order (the next one along)</option>' +
      neTabs()
        .map(function (tab) {
          return (
            '<option value="' +
            D.escapeHtml(tab) +
            '"' +
            (tab === beat.tab ? " selected" : "") +
            ">" +
            D.escapeHtml(tab) +
            "</option>"
          );
        })
        .join("");

    row.innerHTML =
      '<div class="beatrow__head"><span class="beatrow__n">Beat ' +
      (index + 1) +
      '</span><div class="beatrow__move"></div></div>' +
      '<label class="beatrow__field"><span class="beatrow__lbl">Words you say</span>' +
      '<textarea class="input" rows="3" data-role="text"></textarea></label>' +
      '<div class="beatrow__grid">' +
      '<label class="beatrow__field"><span class="beatrow__lbl">What is on screen</span>' +
      '<select class="input" data-role="scene">' +
      options +
      '</select><span class="hint" data-role="sceneHint"></span></label>' +
      '<label class="beatrow__field"><span class="beatrow__lbl">Suggested seconds</span>' +
      '<input class="input" type="number" min="0.5" max="120" step="0.1" data-role="seconds" />' +
      '<span class="hint" data-role="secondsHint"></span></label>' +
      "</div>" +
      '<label class="beatrow__field" data-role="tabField"><span class="beatrow__lbl">Which Neighborhood Explorer tab is showing?</span>' +
      '<select class="input" data-role="tab">' +
      tabOptions +
      '</select><span class="hint">Name the tab so it is on screen while these words are spoken.</span></label>' +
      '<div class="beatrow__grid">' +
      '<label class="beatrow__field"><span class="beatrow__lbl">Top caption, line 1 <span class="opt">optional</span></span>' +
      '<input class="input" data-role="headline" /></label>' +
      '<label class="beatrow__field"><span class="beatrow__lbl">Top caption, line 2 <span class="opt">optional</span></span>' +
      '<input class="input" data-role="subline" /></label>' +
      "</div>";

    var text = row.querySelector('[data-role="text"]');
    var scene = row.querySelector('[data-role="scene"]');
    var seconds = row.querySelector('[data-role="seconds"]');
    var headline = row.querySelector('[data-role="headline"]');
    var subline = row.querySelector('[data-role="subline"]');
    var tab = row.querySelector('[data-role="tab"]');
    var tabField = row.querySelector('[data-role="tabField"]');
    var secondsHint = row.querySelector('[data-role="secondsHint"]');
    var sceneHint = row.querySelector('[data-role="sceneHint"]');

    text.value = beat.text || "";
    seconds.value = beat.seconds;
    headline.value = (beat.caption && beat.caption.headline) || "";
    subline.value = (beat.caption && beat.caption.subline) || "";

    /*
     * The duration follows the words until somebody types a number.
     *
     * Both halves of this run on every keystroke, on purpose:
     *
     *   retime      puts the new suggestion in the box, so the number moves as
     *               characters are added and taken away rather than waiting for
     *               the field to lose focus.
     *   showTiming  rewrites the line under the box - "~5.8s from 69
     *               characters" - even for a beat being held at a number of its
     *               own. That line is how you can see the suggestion is alive:
     *               the character count ticks with what you type either way.
     */
    var showTiming = function () {
      D.setText(
        secondsHint,
        beat.followsText
          ? timing().describeSuggestion(beat.text)
          : timing().describeHeld(beat.seconds, beat.text)
      );
      secondsHint.classList.toggle("hint--live", Boolean(beat.followsText));
    };
    var retime = function () {
      if (!beat.followsText) return;
      beat.seconds = timing().suggestSeconds(beat.text);
      // Only written when it really changed, so the caret is not moved about in
      // a box somebody might be standing in.
      if (String(seconds.value) !== String(beat.seconds)) seconds.value = beat.seconds;
      updateTotal();
    };
    showTiming();

    // The tab only means anything on a Neighborhood Explorer beat.
    var syncTabField = function () {
      D.show(tabField, scene.value === "ne");
    };
    syncTabField();

    /*
     * What the picked scene actually draws, said in a line under the box.
     *
     * There are three listing looks now and the difference between them is the
     * whole before-and-after, so the dropdown cannot be the only place it is
     * explained.
     */
    var showScene = function () {
      var picked = scenes().filter(function (entry) {
        return entry.id === scene.value;
      })[0];
      D.setText(sceneHint, (picked && picked.hint) || "");
    };
    showScene();

    text.addEventListener("input", function () {
      beat.text = text.value;
      retime();
      showTiming();
    });
    tab.addEventListener("change", function () {
      beat.tab = tab.value;
    });
    scene.addEventListener("change", function () {
      beat.scene = scene.value;
      if (scene.value !== "ne") beat.tab = "";
      syncTabField();
      showScene();
    });
    seconds.addEventListener("input", function () {
      // An emptied box is the way back: nobody is holding a number any more, so
      // the words take over again and the field fills itself in.
      if (seconds.value.trim() === "") {
        beat.followsText = true;
        retime();
        showTiming();
        return;
      }
      beat.followsText = false;
      beat.seconds = Number(seconds.value);
      updateTotal();
      showTiming();
    });
    headline.addEventListener("input", function () {
      beat.caption = beat.caption || {};
      beat.caption.headline = headline.value;
    });
    subline.addEventListener("input", function () {
      beat.caption = beat.caption || {};
      beat.caption.subline = subline.value;
    });

    var move = row.querySelector(".beatrow__move");
    move.appendChild(
      button("Up", "btn--ghost", function () {
        if (index === 0) return;
        var swap = editing.beats[index - 1];
        editing.beats[index - 1] = editing.beats[index];
        editing.beats[index] = swap;
        paintBeats();
      })
    );
    move.appendChild(
      button("Down", "btn--ghost", function () {
        if (index === editing.beats.length - 1) return;
        var swap = editing.beats[index + 1];
        editing.beats[index + 1] = editing.beats[index];
        editing.beats[index] = swap;
        paintBeats();
      })
    );
    move.appendChild(
      button("Remove", "btn--danger", function () {
        if (editing.beats.length === 1) {
          D.showMessage(el("editorError"), "A script needs at least one beat.");
          return;
        }
        editing.beats.splice(index, 1);
        paintBeats();
      })
    );

    return row;
  }

  function updateTotal() {
    var total = editing.beats.reduce(function (sum, beat) {
      return sum + (Number(beat.seconds) || 0);
    }, 0);
    D.setText(
      el("beatTotal"),
      editing.beats.length + " beats, " + total.toFixed(1) + "s of picture in total."
    );
  }

  el("addBeatBtn").addEventListener("click", function () {
    editing.beats.push(newBeat("listing"));
    paintBeats();
  });

  el("cancelTemplateBtn").addEventListener("click", load);

  el("saveTemplateBtn").addEventListener("click", function () {
    D.showMessage(el("editorError"), "");
    D.show(el("editorOk"), false);

    var name = el("tplName").value.trim();
    /*
     * A new script gets an id nothing is using - the shipped list included, so
     * a new "SE to NE upgrade" does not quietly shadow the shipped one. An
     * existing script keeps its id, because that is the reference every video
     * already made carries.
     */
    var id = editing.id || store.freeId(window.DNScriptStore.slugify(name), D.state.shipped);

    var payload = {
      id: id,
      name: name,
      explorers: D.selectedValue("tplExplorers"),
      listingExplorer: D.selectedValue("tplListingExplorer"),
      notes: el("tplNotes").value.trim(),
      beats: editing.beats.map(function (beat) {
        return {
          scene: beat.scene,
          seconds: Number(beat.seconds),
          // Saved, so re-opening the script knows this beat follows its words
          // rather than working it out from whether the number happens to match.
          autoSeconds: Boolean(beat.followsText),
          text: beat.text,
          caption: beat.caption || null,
          tab: beat.scene === "ne" ? beat.tab || "" : "",
        };
      }),
    };

    if (!name) {
      D.showMessage(el("editorError"), "Give the script a name.");
      return;
    }

    validate(payload).then(function (result) {
      if (!result.ok) {
        D.showMessage(el("editorError"), D.errorFrom(result, "That script was not saved."));
        return;
      }
      /*
       * Kept in this browser, and nowhere else.
       *
       * Editing a shipped script writes a copy here under the same id, which is
       * what makes it survive a deploy; the shipped one is untouched and can be
       * put back from the list.
       */
      var kept = store.save(result.body.template);
      editing.id = kept.id;
      editing.savedHere = true;
      D.showMessage(
        el("editorOk"),
        editing.builtIn
          ? "Saved in this browser. The shipped version is still there if you want it back."
          : "Saved in this browser. It will still be here after the next deploy."
      );
      refreshEverywhere().then(paintStorageNote);
    });
  });

  D.registerView("scripts", load);
})();
