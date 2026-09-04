/* Sign in, then hand over to the tabs. */
(function () {
  "use strict";

  var D = window.DNLV;
  var el = D.el;
  var API = D.API;

  function loadSession() {
    return D.json(API + "/session").then(
      function (result) {
        D.state.session = result.body || {};
        var signedIn = Boolean(D.state.session.signedIn);
        D.show(el("gate"), !signedIn);
        D.show(el("tabs"), signedIn);
        D.show(el("signout"), signedIn);
        ["make", "library", "scripts"].forEach(function (view) {
          if (!signedIn) D.show(el("view-" + view), false);
        });
        if (!signedIn) return null;
        return D.loadTemplates().then(function () {
          D.goTo("make");
        });
      },
      function () {
        D.show(el("gate"), true);
        D.showMessage(el("gate-error"), "Could not reach the server. Refresh the page.");
      }
    );
  }

  el("gate-form").addEventListener("submit", function (event) {
    event.preventDefault();
    D.showMessage(el("gate-error"), "");
    D.send("POST", API + "/signin", { token: el("gate-token").value }).then(function (result) {
      if (result.ok) {
        el("gate-token").value = "";
        loadSession();
      } else {
        D.showMessage(el("gate-error"), D.errorFrom(result, "That did not work."));
      }
    });
  });

  el("signout").addEventListener("click", function () {
    D.send("POST", API + "/signout").then(function () {
      window.location.reload();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll("#tabs .tab"), function (tab) {
    tab.addEventListener("click", function () {
      D.goTo(tab.getAttribute("data-view"));
    });
  });

  loadSession();
})();
