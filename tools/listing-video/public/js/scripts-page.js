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
    editing = {
      id: null,
      beats: [{ scene: "listing", seconds: 6, text: "", caption: { headline: "", subline: "" } }],
    };
    D.setText(el("editorTitle"), "New script");
    D.setText(el("editorSub"), "Saved on this box as soon as you press Save script.");
    el("tplName").value = "";
    el("tplNotes").value = "";
    paintExplorerChoices("se");
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
      editing = { id: template.id, beats: template.beats.slice() };
      D.setText(el("editorTitle"), "Edit " + template.name);
      D.setText(
        el("editorSub"),
        template.builtIn
          ? "This is one of the two shipped v11 scripts. Editing it is fine - you can always put the originals back from the list."
          : "Saved on this box."
      );
      el("tplName").value = template.name;
      el("tplNotes").value = template.notes || "";
      paintExplorerChoices(template.explorers);
      paintBeats();
      D.showMessage(el("editorError"), "");
      D.show(el("editorOk"), false);
      showEditor();
    });
  }

  function paintExplorerChoices(selected) {
    var wrap = el("tplExplorers");
    wrap.innerHTML = "";
    explorerModes().forEach(function (mode) {
      var label = document.createElement("label");
      label.className = "choice";
      label.innerHTML =
        '<input type="radio" name="tplExplorers" value="' +
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

    row.innerHTML =
      '<div class="beatrow__head"><span class="beatrow__n">Beat ' +
      (index + 1) +
      '</span><div class="beatrow__move"></div></div>' +
      '<label class="beatrow__field"><span class="beatrow__lbl">Words you say</span>' +
      '<textarea class="input" rows="3" data-role="text"></textarea></label>' +
      '<div class="beatrow__grid">' +
      '<label class="beatrow__field"><span class="beatrow__lbl">Scene</span>' +
      '<select class="input" data-role="scene">' +
      options +
      "</select></label>" +
      '<label class="beatrow__field"><span class="beatrow__lbl">Suggested seconds</span>' +
      '<input class="input" type="number" min="0.5" max="120" step="0.1" data-role="seconds" /></label>' +
      "</div>" +
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

    text.value = beat.text || "";
    seconds.value = beat.seconds;
    headline.value = (beat.caption && beat.caption.headline) || "";
    subline.value = (beat.caption && beat.caption.subline) || "";

    text.addEventListener("input", function () {
      beat.text = text.value;
    });
    scene.addEventListener("change", function () {
      beat.scene = scene.value;
    });
    seconds.addEventListener("input", function () {
      beat.seconds = Number(seconds.value);
      updateTotal();
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
    editing.beats.push({ scene: "listing", seconds: 4, text: "", caption: { headline: "", subline: "" } });
    paintBeats();
  });

  el("cancelTemplateBtn").addEventListener("click", load);

  el("saveTemplateBtn").addEventListener("click", function () {
    D.showMessage(el("editorError"), "");
    D.show(el("editorOk"), false);

    var payload = {
      name: el("tplName").value.trim(),
      explorers: D.selectedValue("tplExplorers"),
      notes: el("tplNotes").value.trim(),
      beats: editing.beats.map(function (beat) {
        return {
          scene: beat.scene,
          seconds: Number(beat.seconds),
          text: beat.text,
          caption: beat.caption || null,
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
