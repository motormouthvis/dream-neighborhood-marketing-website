/* Gated booking for the marketing site.
   Links with [data-calendly-gate] stay disabled until sessionStorage
   dn_calendly_unlock_v1 is set (after the realtor or partner form submits).
   Optional prefill (name, email, etc.) is stored in dn_calendly_prefill_v1 and
   appended to unlocked Google Calendar Appointment URLs. */
(function () {
  var STORAGE_KEY = "dn_calendly_unlock_v1";
  var PREFILL_KEY = "dn_calendly_prefill_v1";

  var CALENDLY_PARAM_KEYS = [
    "name",
    "first_name",
    "last_name",
    "email",
    "guests",
    "a1",
    "a2",
    "a3",
    "a4",
    "a5",
    "a6",
    "a7",
    "a8",
    "a9",
    "a10",
  ];

  function isUnlocked() {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  /** Map site form fields to booking query params (name, email, first/last, optional a1). */
  function normalizePrefill(raw) {
    if (!raw || typeof raw !== "object") return {};
    var out = {};
    var email = String(raw.email != null ? raw.email : "").trim();
    if (email) out.email = email;

    var name = String(raw.name != null ? raw.name : "").trim();
    if (name) {
      out.name = name;
      var sp = name.indexOf(" ");
      if (sp > 0) {
        out.first_name = name.slice(0, sp).trim();
        out.last_name = name.slice(sp + 1).trim();
      } else {
        out.first_name = name;
        out.last_name = "";
      }
    }

    var parts = [];
    function add(label, val) {
      if (val == null) return;
      var s = String(val).trim();
      if (s) parts.push(label + s);
    }
    add("Brokerage/team: ", raw.brokerage);
    add("Company: ", raw.company);
    add("Phone: ", raw.phone);
    if (raw.platform_type) add("Platform: ", raw.platform_type);
    if (raw.num_sites) add("Approx. sites: ", raw.num_sites);
    if (raw.message) {
      var msg = String(raw.message).trim();
      if (msg) parts.push(msg);
    }
    if (parts.length) {
      out.a1 = parts.join(" | ").slice(0, 900);
    }

    return out;
  }

  function getStoredPrefill() {
    try {
      var raw = window.sessionStorage.getItem(PREFILL_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      return o && typeof o === "object" ? o : {};
    } catch (e) {
      return {};
    }
  }

  function setPrefill(raw) {
    var norm = normalizePrefill(raw);
    try {
      window.sessionStorage.setItem(PREFILL_KEY, JSON.stringify(norm));
    } catch (e) {}
    return norm;
  }

  function buildCalendlyUrl(baseHref) {
    var base = baseHref || "";
    if (!base) return base;
    var stored = getStoredPrefill();
    try {
      var u = new URL(base);
      CALENDLY_PARAM_KEYS.forEach(function (k) {
        if (stored[k] != null && String(stored[k]).trim() !== "") {
          u.searchParams.set(k, String(stored[k]).trim());
        }
      });
      return u.toString();
    } catch (e) {
      return base;
    }
  }

  function refresh() {
    var unlocked = isUnlocked();
    document.querySelectorAll("a[data-calendly-gate]").forEach(function (a) {
      var base = a.getAttribute("data-calendly-href");
      if (!base) return;
      if (unlocked) {
        a.setAttribute("href", buildCalendlyUrl(base));
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener");
        a.classList.remove("calendly-gate--locked");
        a.removeAttribute("aria-disabled");
        a.removeAttribute("tabindex");
        a.removeAttribute("title");
      } else {
        a.setAttribute("href", "#");
        a.removeAttribute("target");
        a.removeAttribute("rel");
        a.classList.add("calendly-gate--locked");
        a.setAttribute("aria-disabled", "true");
        a.setAttribute("tabindex", "-1");
        a.setAttribute(
          "title",
          "Submit the short form on the Dream Neighborhood page first, then scheduling unlocks."
        );
      }
    });
  }

  function unlock(prefillRaw) {
    if (prefillRaw != null && typeof prefillRaw === "object") {
      setPrefill(prefillRaw);
    }
    try {
      window.sessionStorage.setItem(STORAGE_KEY, "1");
    } catch (e) {}
    refresh();
  }

  document.addEventListener(
    "click",
    function (e) {
      var a = e.target.closest("a[data-calendly-gate].calendly-gate--locked");
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );

  window.DNCalendlyGate = {
    unlock: unlock,
    refresh: refresh,
    isUnlocked: isUnlocked,
    setPrefill: setPrefill,
    buildCalendlyUrl: buildCalendlyUrl,
    normalizePrefill: normalizePrefill,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
})();
