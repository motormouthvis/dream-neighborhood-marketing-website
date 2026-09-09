/* Shared helpers and state for the Listing Video Maker front end. */
window.DNLV = (function () {
  "use strict";

  var API = "/tools/listing-video/api";

  var state = {
    session: null,
    /* The merged list: shipped scripts plus whatever this browser has saved. */
    templates: [],
    /* The shipped ones on their own, so an edit can be put back. */
    shipped: [],
    view: "make",
  };

  function el(id) {
    return document.getElementById(id);
  }

  function show(node, visible) {
    if (node) node.hidden = !visible;
  }

  function setText(node, value) {
    if (node) node.textContent = value == null ? "" : String(value);
  }

  function showMessage(node, message) {
    setText(node, message || "");
    show(node, Boolean(message));
  }

  function selectedValue(name) {
    var picked = document.querySelector('input[name="' + name + '"]:checked');
    return picked ? picked.value : "";
  }

  function json(url, options) {
    return fetch(url, Object.assign({ credentials: "same-origin" }, options || {})).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (body) {
          return { ok: response.ok, status: response.status, body: body };
        });
    });
  }

  function send(method, url, payload) {
    return json(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  }

  function errorFrom(result, fallback) {
    return (result && result.body && result.body.error) || fallback;
  }

  /* Copy that works even where the async clipboard API is blocked. */
  function copy(value, button, resetLabel) {
    var area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "readonly");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    var ok = false;
    try {
      area.select();
      area.setSelectionRange(0, value.length);
      ok = document.execCommand("copy");
    } catch (_) {
      ok = false;
    }
    document.body.removeChild(area);

    if (ok) return flash("Copied");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(
        function () {
          flash("Copied");
        },
        function () {
          flash("Copy failed");
        }
      );
    }
    return flash("Copy failed");

    function flash(label) {
      if (!button) return;
      setText(button, label);
      setTimeout(function () {
        setText(button, resetLabel);
      }, 2000);
    }
  }

  function clock(seconds) {
    var whole = Math.max(0, Math.floor(seconds || 0));
    return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
  }

  function runtime(seconds) {
    if (!seconds) return "";
    if (seconds < 60) return Math.round(seconds) + "s";
    return Math.floor(seconds / 60) + "m " + Math.round(seconds % 60) + "s";
  }

  function when(iso) {
    if (!iso) return "";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  /* ------------------------------------------------------------ */
  /* the three tabs                                                */
  /* ------------------------------------------------------------ */
  var onEnter = {};

  function registerView(name, handler) {
    onEnter[name] = handler;
  }

  function goTo(name) {
    state.view = name;
    ["make", "library", "scripts"].forEach(function (view) {
      show(el("view-" + view), view === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#tabs .tab"), function (tab) {
      tab.classList.toggle("is-on", tab.getAttribute("data-view") === name);
    });
    if (onEnter[name]) onEnter[name]();
  }

  /* ------------------------------------------------------------ */
  /* the scripts                                                   */
  /* ------------------------------------------------------------ */

  /*
   * Custom scripts live in this browser. See public/js/script-store.js for why.
   *
   * The store is created once here so the Scripts page and the make-a-video
   * picker are looking at the same thing - an edit saved on one tab shows up in
   * the other's list as soon as it is reloaded.
   */
  var scripts = window.DNScriptStore.create({
    storage: (function () {
      try {
        return window.localStorage;
      } catch (_) {
        // A locked-down profile can make localStorage itself unreadable. The
        // store falls back to memory, so the page works and forgets.
        return null;
      }
    })(),
  });

  /**
   * Everything a picker needs about a script, without the whole script.
   *
   * The same shape the server's own summary() builds, off the same labels,
   * because a shipped script and one out of this browser sit side by side in
   * the same list and must not read differently.
   */
  function summarise(template) {
    var session = state.session || {};
    var label = function (modes, id) {
      var found = (modes || []).filter(function (mode) {
        return mode.id === id;
      })[0];
      return found ? found.label : "";
    };
    var beats = template.beats || [];
    return {
      id: template.id,
      name: template.name,
      explorers: template.explorers,
      explorersLabel: label(session.explorerModes, template.explorers),
      listingExplorer: template.listingExplorer || "absent",
      listingExplorerLabel: label(session.listingExplorerModes, template.listingExplorer || "absent"),
      notes: template.notes || "",
      builtIn: Boolean(template.builtIn),
      savedHere: Boolean(template.savedHere),
      editedFrom: template.editedFrom || null,
      beatCount: beats.length,
      totalSeconds:
        Math.round(
          beats.reduce(function (sum, beat) {
            return sum + (Number(beat.seconds) || 0);
          }, 0) * 10
        ) / 10,
      updatedAt: template.updatedAt || null,
      template: template,
    };
  }

  /*
   * Every screen needs the script list, so it is loaded once and shared.
   *
   * The shipped scripts come off the server; the customs come out of this
   * browser; the two are merged here. A server that will not answer is not the
   * end of it - what is in this browser is still shown, because that is the
   * half a deploy cannot break and the half that is somebody's own work.
   */
  function loadTemplates() {
    return json(API + "/templates").then(
      function (result) {
        state.shipped = (result.body && result.body.templates) || [];
        state.templates = scripts.merged(state.shipped).map(summarise);
        return state.templates;
      },
      function () {
        state.shipped = [];
        state.templates = scripts.merged([]).map(summarise);
        return state.templates;
      }
    );
  }

  return {
    API: API,
    state: state,
    scripts: scripts,
    summarise: summarise,
    el: el,
    show: show,
    setText: setText,
    showMessage: showMessage,
    selectedValue: selectedValue,
    json: json,
    send: send,
    errorFrom: errorFrom,
    copy: copy,
    clock: clock,
    runtime: runtime,
    when: when,
    escapeHtml: escapeHtml,
    registerView: registerView,
    goTo: goTo,
    loadTemplates: loadTemplates,
  };
})();
