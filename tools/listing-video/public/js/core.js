/* Shared helpers and state for the Listing Video Maker front end. */
window.DNLV = (function () {
  "use strict";

  var API = "/tools/listing-video/api";

  var state = {
    session: null,
    templates: [],
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

  /* Every screen needs the template list, so it is loaded once and shared. */
  function loadTemplates() {
    return json(API + "/templates").then(function (result) {
      state.templates = (result.body && result.body.templates) || [];
      return state.templates;
    });
  }

  return {
    API: API,
    state: state,
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
