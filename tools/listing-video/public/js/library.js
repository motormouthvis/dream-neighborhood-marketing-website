/* The library: every video on this box, with play, copy, send and delete. */
(function () {
  "use strict";

  var D = window.DNLV;
  var el = D.el;
  var API = D.API;

  var STATUS_LABELS = {
    queued: "Queued",
    capturing: "Finding a listing",
    "silent-ready": "Silent - needs a voice",
    voicing: "Adding the voice",
    trimming: "Trimming the video",
    ready: "Ready",
    failed: "Did not finish",
  };

  function load() {
    D.showMessage(el("libError"), "");
    D.json(API + "/videos").then(function (result) {
      if (!result.ok) {
        D.showMessage(el("libError"), D.errorFrom(result, "The library could not be loaded."));
        return;
      }
      paint((result.body && result.body.videos) || []);
    });
  }

  function paint(videos) {
    var wrap = el("libList");
    wrap.innerHTML = "";
    D.show(el("libEmpty"), videos.length === 0);

    videos.forEach(function (video) {
      var card = document.createElement("div");
      card.className = "card";

      var meta = [
        D.escapeHtml(video.templateName || "no script"),
        D.escapeHtml(D.when(video.createdAt)),
      ];
      if (video.durationSeconds) meta.push(D.runtime(video.durationSeconds));

      var flags = [];
      if (video.emailSent) flags.push('<span class="pill pill--ok">Sent to ' + D.escapeHtml(video.emailTo) + "</span>");
      else if (video.reviewed) flags.push('<span class="pill">Reviewed, not sent</span>');

      card.innerHTML =
        '<div class="card__head">' +
        '<div><h3 class="card__title">' +
        D.escapeHtml(video.firstName || "(no name)") +
        " &middot; " +
        D.escapeHtml(video.company || "(no company)") +
        '</h3><p class="card__meta">' +
        meta.join(" &middot; ") +
        "</p></div>" +
        '<span class="pill pill--' +
        (video.status === "ready" ? "ok" : video.status === "failed" ? "bad" : "wait") +
        '">' +
        D.escapeHtml(STATUS_LABELS[video.status] || video.status) +
        "</span>" +
        "</div>" +
        (flags.length ? '<div class="card__flags">' + flags.join(" ") + "</div>" : "") +
        failureBlock(video) +
        (video.hasVideo
          ? '<div class="card__link"><input class="input" readonly value="' +
            D.escapeHtml(video.watchUrl) +
            '" /></div>'
          : "") +
        '<div class="card__actions"></div>';

      var actions = card.querySelector(".card__actions");

      if (video.hasVideo) {
        actions.appendChild(
          button("Play", "btn--dark", function () {
            window.open(video.watchUrl, "_blank", "noopener");
          })
        );
        var copyBtn = button("Copy link", "btn--ghost", function () {
          D.copy(video.watchUrl, copyBtn, "Copy link");
        });
        actions.appendChild(copyBtn);
      }

      actions.appendChild(
        button(video.hasVideo ? "Open and send" : "Open", "btn--ghost", function () {
          D.maker.openJob(video.id);
        })
      );

      actions.appendChild(
        button("Delete", "btn--danger", function () {
          confirmDelete(video, card);
        })
      );

      wrap.appendChild(card);
    });
  }

  /*
   * Why a job did not finish, kept on the card rather than only in a log.
   *
   * A failed job stays in the library on purpose. The picture of the page it
   * stopped on is the useful part: "no single listing page could be found" reads
   * very differently next to a screenshot of a search form or an account wall.
   */
  function failureBlock(video) {
    if (video.status !== "failed") return "";
    var failure = video.failure || {};
    var facts = [];
    if (failure.errorCode) facts.push(D.escapeHtml(failure.errorCode));
    if (failure.httpStatus) facts.push("HTTP " + D.escapeHtml(String(failure.httpStatus)));
    if (failure.pageKind) facts.push("read as " + D.escapeHtml(failure.pageKind));
    if (failure.stage && failure.stage !== "capture") facts.push(D.escapeHtml(failure.stage));

    var parts =
      '<div class="card__failure"><p><strong>Did not finish.</strong> ' +
      D.escapeHtml(video.error || failure.reason || "No reason was recorded.") +
      "</p>";
    if (facts.length) parts += '<p class="card__meta">' + facts.join(" &middot; ") + "</p>";
    if (failure.pageUrl) {
      parts +=
        '<p class="card__meta">It stopped on <a href="' +
        D.escapeHtml(failure.pageUrl) +
        '" target="_blank" rel="noopener">' +
        D.escapeHtml(failure.pageUrl) +
        "</a></p>";
    }
    if (failure.hasScreenshot) {
      parts +=
        '<p class="card__meta"><a href="' +
        API +
        "/jobs/" +
        D.escapeHtml(video.id) +
        '/failure.png" target="_blank" rel="noopener">Open the picture of that page</a></p>';
    }
    return parts + "</div>";
  }

  function button(label, className, onClick) {
    var node = document.createElement("button");
    node.type = "button";
    node.className = "btn btn--small " + className;
    node.textContent = label;
    node.addEventListener("click", onClick);
    return node;
  }

  /* Deleting takes the mp4 and the public link with it, so it is confirmed. */
  function confirmDelete(video, card) {
    var existing = card.querySelector(".card__confirm");
    if (existing) return;

    var box = document.createElement("div");
    box.className = "card__confirm";
    box.innerHTML =
      "<p><strong>Delete this video?</strong> The mp4 is removed from this box and " +
      D.escapeHtml(video.watchUrl || "the watch link") +
      " stops working for anyone who already has it. This cannot be undone.</p>";

    var row = document.createElement("div");
    row.className = "card__actions";
    row.appendChild(
      button("Yes, delete it", "btn--danger", function () {
        D.send("DELETE", API + "/videos/" + video.id).then(function (result) {
          if (!result.ok) {
            D.showMessage(el("libError"), D.errorFrom(result, "That video was not deleted."));
            box.remove();
            return;
          }
          load();
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

  D.registerView("library", load);
  D.library = { load: load };
})();
