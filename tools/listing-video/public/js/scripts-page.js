/*
 * The Scripts page. Scripts are files on this box, so create, edit, duplicate
 * and delete all happen here - nobody has to touch the repo to change a script.
 */
(function () {
  "use strict";

  var D = window.DNLV;
  var el = D.el;
  var API = D.API;

  var editing = { id: null, beats: [] };

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
    D.loadTemplates().then(paintList);
  }

  function showList() {
    D.show(el("scriptsList"), true);
    D.show(el("scriptsEditor"), false);
  }

  function showEditor() {
    D.show(el("scriptsList"), false);
    D.show(el("scriptsEditor"), true);
  }

  function paintList(list) {
    var wrap = el("templateList");
    wrap.innerHTML = "";
    list.forEach(function (template) {
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
        (template.builtIn ? '<span class="pill">Shipped default</span>' : "") +
        "</div>" +
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
          D.send("POST", API + "/templates/" + template.id + "/duplicate").then(function (result) {
            if (!result.ok) {
              D.showMessage(el("scriptsError"), D.errorFrom(result, "That script was not duplicated."));
              return;
            }
            D.showMessage(el("scriptsOk"), 'Copied to "' + result.body.template.name + '".');
            refreshEverywhere();
          });
        })
      );
      actions.appendChild(
        button("Delete", "btn--danger", function () {
          confirmDelete(template, card);
        })
      );

      wrap.appendChild(card);
    });
  }

  function confirmDelete(template, card) {
    if (card.querySelector(".card__confirm")) return;
    var box = document.createElement("div");
    box.className = "card__confirm";
    box.innerHTML =
      '<p><strong>Delete "' +
      D.escapeHtml(template.name) +
      '"?</strong> Videos already made with it keep working. New videos cannot use it again.</p>';
    var row = document.createElement("div");
    row.className = "card__actions";
    row.appendChild(
      button("Yes, delete it", "btn--danger", function () {
        D.send("DELETE", API + "/templates/" + template.id).then(function (result) {
          if (!result.ok) {
            D.showMessage(el("scriptsError"), D.errorFrom(result, "That script was not deleted."));
            return;
          }
          D.showMessage(el("scriptsOk"), 'Deleted "' + result.body.name + '".');
          refreshEverywhere();
        });
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
  /* the editor                                                    */
  /* ------------------------------------------------------------ */
  el("newTemplateBtn").addEventListener("click", function () {
    editing = { id: null, beats: [newBeat("listing")] };
    D.setText(el("editorTitle"), "New script");
    D.setText(el("editorSub"), "Saved on this box as soon as you press Save script.");
    el("tplName").value = "";
    el("tplNotes").value = "";
    paintExplorerChoices("se", "absent");
    paintBeats();
    D.showMessage(el("editorError"), "");
    D.show(el("editorOk"), false);
    showEditor();
  });

  el("restoreDefaultsBtn").addEventListener("click", function () {
    D.send("POST", API + "/templates-restore-defaults").then(function (result) {
      if (!result.ok) {
        D.showMessage(el("scriptsError"), D.errorFrom(result, "Those could not be restored."));
        return;
      }
      D.showMessage(el("scriptsOk"), "Put back: " + result.body.restored.join(", ") + ".");
      refreshEverywhere();
    });
  });

  function openEditor(id) {
    D.json(API + "/templates/" + id).then(function (result) {
      if (!result.ok) {
        D.showMessage(el("scriptsError"), D.errorFrom(result, "That script could not be opened."));
        return;
      }
      var template = result.body.template;
      editing = { id: template.id, beats: template.beats.map(loadedBeat) };
      D.setText(el("editorTitle"), "Edit " + template.name);
      D.setText(
        el("editorSub"),
        template.builtIn
          ? "This is one of the shipped scripts. Editing it is fine - you can always put the originals back from the list."
          : "Saved on this box."
      );
      el("tplName").value = template.name;
      el("tplNotes").value = template.notes || "";
      paintExplorerChoices(template.explorers, template.listingExplorer);
      paintBeats();
      D.showMessage(el("editorError"), "");
      D.show(el("editorOk"), false);
      showEditor();
    });
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

    var payload = {
      name: el("tplName").value.trim(),
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

    var request = editing.id
      ? D.send("PUT", API + "/templates/" + editing.id, payload)
      : D.send("POST", API + "/templates", payload);

    request.then(function (result) {
      if (!result.ok) {
        D.showMessage(el("editorError"), D.errorFrom(result, "That script was not saved."));
        return;
      }
      editing.id = result.body.template.id;
      D.showMessage(el("editorOk"), "Saved.");
      refreshEverywhere();
    });
  });

  D.registerView("scripts", load);
})();
