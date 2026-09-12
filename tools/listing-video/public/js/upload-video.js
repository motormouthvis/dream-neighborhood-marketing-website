/*
 * Upload a finished video, and get the link.
 *
 * The Make tab is the whole of this tool: find a listing, film the Explorers,
 * draw the scenes, record a voice, review it, send it. This tab is the last two
 * things on their own, for a video that already exists somewhere else - a screen
 * recording, something off a phone, something cut in another editor.
 *
 * There is no polling here and no steps. The server checks the file, remuxes it
 * so a browser can start playing before the whole thing has arrived, cuts a
 * poster and answers with a job that is already ready - so this is one request
 * and then a link. See src/uploaded-video.js.
 */
(function () {
  "use strict";

  var D = window.DNLV;
  var el = D.el;
  var API = D.API;

  var mine = { id: null, watchUrl: "" };

  function paintFromChoices() {
    var wrap = el("uploadFromChoices");
    wrap.innerHTML = "";
    ((D.state.session && D.state.session.fromAddresses) || []).forEach(function (entry, index) {
      var label = document.createElement("label");
      label.className = "choice";
      label.innerHTML =
        '<input type="radio" name="uploadFromId" value="' +
        D.escapeHtml(entry.id) +
        '"' +
        (index === 0 ? " checked" : "") +
        ' /><span class="choice__box"><span class="choice__mark" aria-hidden="true"></span>' +
        '<span class="choice__text"><strong class="choice__title">' +
        D.escapeHtml(entry.label) +
        "</strong></span></span>";
      wrap.appendChild(label);
    });
  }

  /*
   * The limits, from the server rather than written twice.
   *
   * The number in the refusal and the number on the form have to be the same
   * number, and the only place that knows it is src/uploaded-video.js.
   */
  function paintLimits() {
    var limits = (D.state.session && D.state.session.videoUpload) || {};
    if (!limits.maxMegabytes) return;
    D.setText(
      el("uploadVideoLimits"),
      "An mp4 with H.264 video and AAC audio, which is what every editor and phone exports by default. Up to " +
        limits.maxMegabytes +
        "MB and " +
        limits.maxMinutes +
        " minutes - a minute of 1080p is usually 10 to 20MB, so a couple of minutes fits easily. Bigger than that and the upload will time out before it finishes: export at 1080p rather than 4K, or cut it shorter."
    );
  }

  function showForm() {
    D.show(el("uploadVideoForm"), true);
    D.show(el("uploadVideoDone"), false);
    D.showMessage(el("uploadVideoError"), "");
    D.setText(el("uploadVideoState"), "");
  }

  function enter() {
    paintFromChoices();
    paintLimits();
    if (!mine.id) showForm();
  }

  el("uploadVideoFields").addEventListener("submit", function (event) {
    event.preventDefault();
    D.showMessage(el("uploadVideoError"), "");

    var file = (el("finishedVideo").files || [])[0];
    if (!file) {
      D.showMessage(el("uploadVideoError"), "Pick the mp4 you want to host.");
      return;
    }

    var button = el("uploadVideoBtn");
    var done = function (message) {
      button.disabled = false;
      D.setText(button, "Upload it and give me a link");
      D.setText(el("uploadVideoState"), "");
      if (message) D.showMessage(el("uploadVideoError"), message);
    };

    button.disabled = true;
    D.setText(button, "Uploading...");
    // A big file over an ordinary line is a minute of nothing happening, and a
    // button that only says "Uploading..." reads as stuck.
    D.setText(
      el("uploadVideoState"),
      "Sending " + Math.max(1, Math.round(file.size / (1024 * 1024))) + "MB. Leave this page open until it finishes."
    );

    var form = new FormData();
    form.append("firstName", el("uploadFirstName").value.trim());
    form.append("company", el("uploadCompany").value.trim());
    form.append("customerEmail", el("uploadCustomerEmail").value.trim());
    form.append("fromId", D.selectedValue("uploadFromId") || "marketing");
    // The content type is deliberately not set: the browser has to add its own
    // multipart boundary, and setting it by hand is what makes multer answer
    // "Unexpected end of form".
    form.append("video", file, file.name);

    D.json(API + "/uploaded-videos", { method: "POST", body: form }).then(
      function (result) {
        if (!result.ok) {
          done(D.errorFrom(result, "That video was not accepted."));
          return;
        }
        done("");
        paintDone(result.body);
      },
      function () {
        done("The server did not answer. If the file is large, try a smaller export.");
      }
    );
  });

  function paintDone(body) {
    mine.id = body.id;
    mine.watchUrl = body.watchUrl;

    var job = body.job || {};
    var bits = [];
    if (job.input) bits.push(job.input.firstName + " \u00b7 " + job.input.company);
    if (body.durationSeconds) bits.push(D.runtime(body.durationSeconds));
    var uploaded = (job.result && job.result.uploaded) || {};
    if (uploaded.width && uploaded.height) bits.push(uploaded.width + "x" + uploaded.height);
    if (uploaded.originalName) bits.push(uploaded.originalName);
    D.setText(el("uploadVideoSummary"), bits.join(" \u00b7 ") + ".");

    el("uploadVideoPlayer").src = API + "/jobs/" + body.id + "/video.mp4?t=" + Date.now();
    el("uploadShareLink").value = body.watchUrl || "";

    D.show(el("uploadVideoForm"), false);
    D.show(el("uploadVideoDone"), true);
  }

  el("uploadCopyBtn").addEventListener("click", function () {
    D.copy(el("uploadShareLink").value, el("uploadCopyBtn"), "Copy link");
  });

  el("uploadOpenLibraryBtn").addEventListener("click", function () {
    el("uploadVideoPlayer").pause();
    D.goTo("library");
  });

  el("uploadAnotherBtn").addEventListener("click", function () {
    el("uploadVideoPlayer").pause();
    el("uploadVideoPlayer").removeAttribute("src");
    mine.id = null;
    mine.watchUrl = "";
    // The customer's details are left in the boxes: uploading two videos for the
    // same person is the common case, and the file input is the thing that has to
    // change.
    el("finishedVideo").value = "";
    showForm();
  });

  D.registerView("upload", enter);
})();
