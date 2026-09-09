/*
 * The make-a-video flow:
 *   1. pick a script and fill in the customer
 *   2. we draw a silent video from that script's suggested durations
 *   3. the user records their voice while the silent video plays, and can play
 *      the silent video and the take together to hear the timing. The take is
 *      only a local recording at this point - nothing has been burned in, so
 *      re-recording is free
 *   4. when they keep a take, the server burns the audio onto the pictures
 *   5. they review that finished file, and only then can they send it
 */
(function () {
  "use strict";

  var D = window.DNLV;
  var el = D.el;
  var API = D.API;

  var mine = {
    jobId: null,
    poll: null,
    recorder: null,
    stream: null,
    take: null,
    takeName: "take.webm",
    takeUrl: null,
    together: false,
    ticker: null,
    tickerStart: 0,
    pollErrors: 0,
    startedAt: 0,
    trimming: false,
    trimPoll: null,
    trimStartedAt: 0,
    trimPollErrors: 0,
    beats: [],
    watched: 0,
    lastTime: 0,
    reviewMarked: false,
  };

  var STEP_PANELS = {
    form: "step-form",
    progress: "step-progress",
    record: "step-record",
    review: "step-review",
    failed: "step-failed",
  };

  function step(name, flowKey) {
    Object.keys(STEP_PANELS).forEach(function (key) {
      D.show(el(STEP_PANELS[key]), key === name);
    });
    var active = flowKey || (name === "failed" ? "form" : name);
    Array.prototype.forEach.call(document.querySelectorAll("#flow li"), function (item) {
      item.classList.toggle("is-on", item.getAttribute("data-step") === active);
    });
  }

  /* ------------------------------------------------------------ */
  /* step 1: the form                                              */
  /* ------------------------------------------------------------ */
  function paintTemplateChoices() {
    var wrap = el("templateChoices");
    wrap.innerHTML = "";
    if (!D.state.templates.length) {
      wrap.innerHTML =
        '<p class="notice">There are no scripts saved yet. Add one on the <strong>Scripts</strong> tab.</p>';
      return;
    }
    D.state.templates.forEach(function (template) {
      var label = document.createElement("label");
      label.className = "choice choice--big";
      label.innerHTML =
        '<input type="radio" name="templateId" value="' +
        D.escapeHtml(template.id) +
        '" /><span class="choice__box"><span class="choice__mark" aria-hidden="true"></span>' +
        '<span class="choice__text"><strong class="choice__title">' +
        D.escapeHtml(template.name) +
        '</strong><span class="choice__desc">' +
        D.escapeHtml(template.explorersLabel) +
        " &middot; " +
        template.beatCount +
        " beats &middot; about " +
        D.runtime(template.totalSeconds) +
        (template.listingExplorer === "prefer-present"
          ? '<br /><strong>For customers who already have School Explorer.</strong>'
          : "") +
        (template.notes ? "<br />" + D.escapeHtml(template.notes) : "") +
        "</span></span></span>";
      wrap.appendChild(label);
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('input[name="templateId"]'), function (input) {
      input.addEventListener("change", onTemplatePicked);
    });
    onTemplatePicked();
  }

  var WEBSITE_HINTS = {
    none: "Their realtor or brokerage site. Pick a script above and this will say which of their listings we go looking for.",
    absent:
      "We open it and look for one of their listing pages that does not already have School Explorer or Neighborhood Explorer on it, because this script is a before-and-after. If we cannot find one we stop and tell you - a search page or the homepage is never used as a stand-in.",
    "prefer-present":
      "We open it and look for one of their listing pages that already has School Explorer on it, because this script is the upgrade pitch. If none of them do, we use their best listing and show School Explorer added to it for the opening shot.",
  };

  /*
   * The upload is an alternative to the live site, not an extra.
   *
   * So the listing URL field goes away while it is chosen: pasting a URL AND
   * uploading a picture would mean two answers to one question, and the server
   * would use the upload, making the URL look ignored.
   */
  function onPictureSourcePicked() {
    var uploading = D.selectedValue("pictureSource") === "upload";
    D.show(el("uploadField"), uploading);
    D.show(el("listingUrlField"), !uploading);
    D.setText(
      el("makeBtn"),
      uploading ? "Make the silent video from that screenshot" : "Make the silent video"
    );
    paintCleanShotAsk();
  }

  /** Is the chosen script a "before" shot - a listing with no Explorer on it yet? */
  function beforeShotPicked() {
    var picked = D.selectedValue("templateId");
    var template = D.state.templates.filter(function (entry) {
      return entry.id === picked;
    })[0];
    return Boolean(template) && (template.listingExplorer || "absent") === "absent";
  }

  /*
   * The clean-listing question, asked only where it means something.
   *
   * It is the only check there is on this path: the live capture looks at the
   * page and refuses a listing that already has one of our Explorers, and there
   * is no page behind a screenshot. Shown for a before-shot script with an
   * upload, and nowhere else.
   */
  function paintCleanShotAsk() {
    var needed = D.selectedValue("pictureSource") === "upload" && beforeShotPicked();
    D.show(el("cleanShotField"), needed);
    if (!needed) el("listingHasNoExplorer").checked = false;
  }

  function onTemplatePicked() {
    var picked = D.selectedValue("templateId");
    el("makeBtn").disabled = !picked;
    D.show(el("templatePrompt"), !picked);
    D.show(el("makeHint"), !picked);

    // Which of their listings we go hunting for depends on the script, so the
    // hint under the website field has to follow the choice.
    var template = D.state.templates.filter(function (entry) {
      return entry.id === picked;
    })[0];
    var key = template ? template.listingExplorer || "absent" : "none";
    D.setText(el("websiteHint"), WEBSITE_HINTS[key] || WEBSITE_HINTS.none);
    paintCleanShotAsk();
  }

  function paintFromChoices() {
    var wrap = el("fromChoices");
    wrap.innerHTML = "";
    ((D.state.session && D.state.session.fromAddresses) || []).forEach(function (entry, index) {
      var label = document.createElement("label");
      label.className = "choice";
      label.innerHTML =
        '<input type="radio" name="fromId" value="' +
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
   * Male and female ElevenLabs voices, as offered by the account itself.
   *
   * The list comes from the server, which asks ElevenLabs what this plan can
   * actually speak with - so nothing is offered here that would fail at render
   * time, after the silent video has already been made. No voices, no picker.
   */
  function paintVoiceChoices() {
    var ai = (D.state.session && D.state.session.aiVoice) || {};
    var list = ai.voices || [];
    D.show(el("voiceField"), list.length > 0);
    if (!list.length) return;

    var wrap = el("voiceChoices");
    wrap.innerHTML = "";
    list.forEach(function (voice, index) {
      var label = document.createElement("label");
      label.className = "choice";
      label.innerHTML =
        '<input type="radio" name="voiceId" value="' +
        D.escapeHtml(voice.id) +
        '"' +
        (index === 0 ? " checked" : "") +
        ' /><span class="choice__box"><span class="choice__mark" aria-hidden="true"></span>' +
        '<span class="choice__text"><strong class="choice__title">' +
        D.escapeHtml(voice.name) +
        '</strong><span class="choice__note">' +
        D.escapeHtml(voice.sex === "male" ? "Male" : "Female") +
        "</span></span></span>";
      wrap.appendChild(label);
    });
  }

  /* A thousand characters reads better than 1000, and 1.2m better than 1200000. */
  function characters(count) {
    var n = Number(count) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, "") + "m";
    if (n >= 1000) return Math.round(n / 1000) + "k";
    return String(n);
  }

  /*
   * How much ElevenLabs allowance is left, so an upgrade is not a surprise.
   *
   * The numbers come from the server, which is the only place the key exists. A
   * key that can speak but cannot read usage says exactly that rather than
   * showing a number nobody has.
   */
  function paintVoiceUsage() {
    var box = el("voiceUsage");
    D.json(API + "/voice-usage").then(function (result) {
      if (!result.ok) return;
      var usage = (result.body && result.body.usage) || {};
      box.className = "usage";
      D.show(el("usageBar"), false);
      D.show(box, true);

      if (usage.state === "off") {
        box.className = "usage usage--off";
        D.setText(el("usageLine"), "The AI voice is switched off on this server.");
        D.setText(el("usageNote"), "Record your own voice over the silent video, which is the normal way anyway.");
        return;
      }

      if (usage.state === "ok") {
        var head =
          (usage.tier ? usage.tier + " plan. " : "") +
          characters(usage.remaining) +
          " characters left of " +
          characters(usage.limit) +
          " (" +
          usage.percentLeft +
          "%).";
        D.setText(el("usageLine"), usage.upgradeSoon ? "Time to upgrade. " + head : head);
        if (usage.upgradeSoon) box.className = "usage usage--low";

        D.show(el("usageBar"), true);
        el("usageFill").style.width = Math.max(0, Math.min(100, usage.percentLeft)) + "%";

        D.setText(
          el("usageNote"),
          characters(usage.used) +
            " used so far" +
            (usage.resetOn ? ", and the allowance resets on " + usage.resetOn : "") +
            "."
        );
        return;
      }

      // Either it cannot read usage, or the read failed. Say so; do not guess.
      var why =
        usage.state === "no-read"
          ? "This key can speak, but it is not allowed to read the account's usage, so there are no numbers to show here. A key with the user_read permission would fill this in."
          : (usage.why || "The usage could not be read.") + " No numbers to show.";
      D.setText(el("usageLine"), why);
      var note = el("usageNote");
      note.innerHTML =
        'Check it by hand at <a href="' +
        D.escapeHtml(usage.checkUrl || "https://elevenlabs.io/app/usage") +
        '" target="_blank" rel="noopener">elevenlabs.io/app/usage</a>.';
    });
  }

  /*
   * A multipart POST, for the routes that can carry a screenshot.
   *
   * The content type is deliberately not set: the browser has to add its own
   * multipart boundary, and setting it by hand is what makes multer answer
   * "Unexpected end of form".
   */
  function postForm(url, fields, file, fileField) {
    var form = new FormData();
    Object.keys(fields).forEach(function (key) {
      if (fields[key] !== undefined && fields[key] !== null) form.append(key, fields[key]);
    });
    if (file) form.append(fileField, file, file.name);
    return D.json(url, { method: "POST", body: form });
  }

  /*
   * The two address boxes, each driven by the Explorer's own picker: the one on
   * the form and the one on the failure panel's way out. Picking a suggestion is
   * what fills the address in - see public/js/place-picker.js.
   */
  var addressPicker = D.placePicker.attach({
    input: "addressSearch",
    list: "addressSuggestions",
    note: "addressNote",
    onPick: function () {
      memory.save();
    },
  });
  var retryAddressPicker = D.placePicker.attach({
    input: "retryAddressSearch",
    list: "retryAddressSuggestions",
    note: "retryAddressNote",
  });

  /*
   * What this form remembers between takes.
   *
   * The same site is usually done several times over - another script, another
   * voice, a screenshot instead of the live capture - and all of this used to be
   * typed in again from nothing every time. See public/js/remember.js for what
   * is deliberately not kept.
   */
  var memory = D.remember.attach({
    texts: ["firstName", "company", "websiteUrl", "listingUrl", "customerEmail"],
    choices: ["templateId", "pictureSource", "fromId", "voiceId"],
    extras: {
      // Not just letters: what this box holds is the place the Explorer named.
      address: {
        input: "addressSearch",
        get: function () {
          return addressPicker.state();
        },
        set: function (saved) {
          return addressPicker.restore(saved);
        },
      },
    },
  });

  /*
   * Put last time's answers back, once the choices they refer to are on screen.
   *
   * The scripts, the from-addresses and the voices are all painted from the
   * server after the page loads, so a saved script id has nothing to select
   * until they are there.
   */
  function paintRememberedAnswers() {
    var saved = memory.restore();
    onTemplatePicked();
    onPictureSourcePicked();
    // Only say so when something really was put back, or the note is just noise
    // on a form nobody has used yet.
    D.show(el("rememberedNote"), Boolean(saved && saved.at));
  }

  /*
   * A way out of the memory.
   *
   * Whatever is remembered is right until it is not - a company name kept from
   * the customer before, a listing URL that belongs to another site - and
   * hunting through five boxes to empty them is worse than the typing this saves.
   */
  el("forgetFormBtn").addEventListener("click", function () {
    memory.forget();
    el("form").reset();
    addressPicker.reset();
    paintTemplateChoices();
    paintFromChoices();
    paintVoiceChoices();
    onPictureSourcePicked();
    D.show(el("rememberedNote"), false);
    D.showMessage(el("form-error"), "");
    el("firstName").focus();
  });

  el("form").addEventListener("submit", function (event) {
    event.preventDefault();
    D.showMessage(el("form-error"), "");

    var templateId = D.selectedValue("templateId");
    if (!templateId) {
      D.showMessage(el("form-error"), "Pick a script first.");
      return;
    }

    var payload = {
      templateId: templateId,
      firstName: el("firstName").value.trim(),
      company: el("company").value.trim(),
      websiteUrl: el("websiteUrl").value.trim(),
      listingUrl: el("listingUrl").value.trim(),
      customerEmail: el("customerEmail").value.trim(),
      fromId: D.selectedValue("fromId"),
      voiceId: D.selectedValue("voiceId") || "",
    };

    var uploading = D.selectedValue("pictureSource") === "upload";
    var file = uploading ? (el("listingImage").files || [])[0] : null;
    if (uploading && !file) {
      D.showMessage(el("form-error"), "Pick the screenshot to use, or switch back to their live site.");
      return;
    }
    if (uploading && !addressPicker.typed()) {
      D.showMessage(
        el("form-error"),
        "Start typing the listing's address and pick it from the list. Nothing is read off the picture, so without it there is nothing to point the Explorers at."
      );
      return;
    }
    if (uploading && beforeShotPicked() && !el("listingHasNoExplorer").checked) {
      D.showMessage(
        el("form-error"),
        "This script is the \u201cbefore\u201d shot, so tick the box to confirm the listing you screenshotted has no Explorer on it yet. Nothing here can check a picture for one. If it already has School Explorer on it, pick the \u201cSE to NE upgrade\u201d script."
      );
      return;
    }

    // What was actually used, kept for the next take on this same site.
    memory.save();

    el("makeBtn").disabled = true;
    D.setText(el("makeBtn"), "Starting...");

    var started = uploading
      ? postForm(
          API + "/jobs",
          Object.assign({}, payload, addressPicker.value(), {
            listingHasNoExplorer: el("listingHasNoExplorer").checked ? "yes" : "",
          }),
          file,
          "listingImage"
        )
      : D.send("POST", API + "/jobs", payload);

    started.then(function (result) {
      el("makeBtn").disabled = false;
      onPictureSourcePicked();
      if (!result.ok) {
        D.showMessage(el("form-error"), D.errorFrom(result, "That did not start."));
        return;
      }
      mine.jobId = result.body.id;
      D.setText(
        el("progressTitle"),
        uploading
          ? "Drawing the scenes from your screenshot"
          : "Finding one of their listing pages and drawing the scenes"
      );
      step("progress", "silent");
      startPolling();
    });
  });

  /* ------------------------------------------------------------ */
  /* polling                                                       */
  /* ------------------------------------------------------------ */
  /*
   * A job can stop existing. The staging box has an ephemeral disk, so if the
   * dyno restarts mid-render the job folder goes with it and every poll from
   * then on is a 404. This used to be ignored, so the page sat on "Working on
   * it" forever. A missing job is now the end of the road, and a run of server
   * errors is too.
   */
  var GONE_MESSAGE =
    "The server restarted while making this video, so it was lost. Try again. If it keeps happening, paste a listing URL on the form so there is less work to do.";
  var UNREACHABLE_MESSAGE =
    "The server stopped answering while making this video. Try again, and paste a listing URL if it keeps happening.";
  var MAX_POLL_ERRORS = 3;

  function startPolling() {
    stopPolling();
    mine.pollErrors = 0;
    mine.startedAt = Date.now();
    var check = function () {
      D.json(API + "/jobs/" + mine.jobId).then(
        function (result) {
          if (result.status === 404) return giveUp(GONE_MESSAGE, false);
          if (result.status === 401) {
            return giveUp("You were signed out while this was running. Sign in again and check the Library.", false);
          }
          if (!result.ok) {
            mine.pollErrors += 1;
            if (mine.pollErrors >= MAX_POLL_ERRORS) return giveUp(UNREACHABLE_MESSAGE, false);
            return undefined;
          }
          mine.pollErrors = 0;
          return paintJob(result.body);
        },
        function () {
          mine.pollErrors += 1;
          if (mine.pollErrors >= MAX_POLL_ERRORS) giveUp(UNREACHABLE_MESSAGE, false);
        }
      );
      tickElapsed();
    };
    check();
    mine.poll = setInterval(check, 2500);
  }

  function stopPolling() {
    if (mine.poll) clearInterval(mine.poll);
    mine.poll = null;
  }

  /*
   * The failure panel.
   *
   * Every capture refusal offers the upload, because it is the one way through
   * that does not depend on their site cooperating. A refusal by HTTP status gets
   * it opened and explained rather than folded away: at that point "paste one
   * listing URL and try again" is the one thing already known not to work, which
   * is exactly the dead end Bill hit.
   */
  function paintFailure(message, options) {
    var settings = options || {};
    var retryable = Boolean(settings.retryable);
    var refused = Boolean(settings.refused);

    D.setText(el("failedWhy"), message);
    D.show(el("retryListing"), retryable);
    D.showMessage(el("uploadError"), "");
    // The job carries the script it was started with, so the clean-listing
    // question follows the job rather than whatever the form says now.
    D.show(el("retryCleanShotField"), Boolean(settings.beforeShot));

    // Nothing to upload against on a job that is no longer on the server.
    D.show(el("uploadEscape"), retryable);
    el("uploadEscape").open = refused;
    D.setText(
      el("uploadEscapeSummary"),
      refused
        ? "Upload a screenshot of the listing instead \u2014 start here"
        : "Upload a screenshot of the listing instead"
    );
    D.setText(
      el("uploadEscapeWhy"),
      refused
        ? "Their site is refusing an automated browser, so another URL from the same site will be refused in the same way. Open the listing in your own browser, where it loads perfectly, screenshot the page, and upload it here with the address. Their site is never opened again, so there is nothing left for it to refuse."
        : "If their site will not give up a listing, screenshot one from your own browser and use that instead. Their site is not opened at all on this route."
    );
    step("failed");
  }

  /** A refusal that came from their site saying no, rather than from anything else. */
  function wasRefused(job) {
    var status = (job && job.failure && job.failure.httpStatus) || 0;
    return (
      (job && job.errorCode === "SITE_BLOCKED") ||
      status === 401 ||
      status === 403 ||
      status === 429 ||
      status === 451
    );
  }

  /** Stop waiting and say why. Never leaves the page spinning. */
  function giveUp(message, retryable) {
    stopPolling();
    paintFailure(message, { retryable: Boolean(retryable) });
  }

  function tickElapsed() {
    if (!mine.startedAt) return;
    D.setText(el("progressElapsed"), "Running for " + D.clock((Date.now() - mine.startedAt) / 1000) + ".");
  }

  function paintSteps(messages) {
    var list = el("steps");
    list.innerHTML = "";
    messages.forEach(function (message) {
      var item = document.createElement("li");
      item.textContent = message;
      list.appendChild(item);
    });
  }

  function paintJob(job) {
    paintSteps(job.progress || []);

    if (job.status === "queued" || job.status === "capturing") {
      D.setText(el("progressTitle"), "Finding one of their listing pages and drawing the scenes");
      step("progress", "silent");
      return;
    }
    if (job.status === "voicing") {
      D.setText(el("progressTitle"), "Adding the audio to the video");
      step("progress", "audio");
      return;
    }
    if (job.status === "failed") {
      stopPolling();
      paintFailure(job.error || "Something went wrong.", {
        retryable: Boolean(job.retryable),
        refused: wasRefused(job),
        beforeShot: ((job.template && job.template.listingExplorer) || "absent") === "absent",
      });
      return;
    }
    if (job.status === "silent-ready") {
      stopPolling();
      paintSilent(job);
      return;
    }
    if (job.status === "ready") {
      stopPolling();
      paintReview(job);
    }
  }

  /* ------------------------------------------------------------ */
  /* step 2 and 3: silent video, record over it                    */
  /* ------------------------------------------------------------ */
  function paintSilent(job) {
    mine.beats = job.beats || [];

    var bits = [job.template.name, mine.beats.length + " scenes"];
    if (job.silent) bits.push(D.runtime(job.silent.durationSeconds) + " of silent picture");
    if (job.silent && job.silent.capturedAddress) {
      // Say which it was. A screenshot somebody took is not a capture of their
      // site, and the person reviewing this should not have to guess.
      bits.push(
        (job.silent.uploadedPicture ? "on the screenshot you uploaded for " : "filmed on their listing for ") +
          job.silent.capturedAddress
      );
    }
    if (job.silent && job.silent.capturedPageUrl) bits.push(job.silent.capturedPageUrl);
    D.setText(el("silentSummary"), bits.join(" \u00b7 ") + ".");

    var notes = (job.silent && job.silent.notes) || [];
    if (job.error) notes = notes.concat([job.error]);
    D.showMessage(el("silentNotes"), notes.join(" "));

    el("silentPlayer").src = API + "/jobs/" + job.id + "/silent.mp4?t=" + Date.now();
    paintBeatList();

    var ai = D.state.session && D.state.session.aiVoice;
    el("aiBtn").disabled = !(ai && ai.available);
    // Name the voice this job was actually booked with, so it is not a surprise.
    var picked = (job.input && job.input.voiceId) || "";
    var named = ((ai && ai.voices) || []).filter(function (voice) {
      return voice.id === picked;
    })[0];
    D.setText(
      el("aiNote"),
      ai && ai.available
        ? "The AI voice is the secondary option, and would use " +
          (named ? named.name + " (" + (named.sex === "male" ? "male" : "female") + ")" : ai.label) +
          ", as picked on the form. It still has to be reviewed before it can be sent."
        : "The AI voice is not connected on this server, so record your own or upload a file."
    );

    resetTake();
    step("record");
  }

  function paintBeatList() {
    var list = el("beatList");
    list.innerHTML = "";
    var at = 0;
    mine.beats.forEach(function (beat, index) {
      var item = document.createElement("li");
      item.className = "beat";
      item.setAttribute("data-from", String(at));
      at += beat.seconds;
      item.setAttribute("data-to", String(at));
      item.innerHTML =
        '<span class="beat__meta">' +
        D.escapeHtml(beat.scene) +
        " &middot; " +
        beat.seconds.toFixed(1) +
        's</span><span class="beat__text">' +
        D.escapeHtml(beat.text) +
        "</span>";
      list.appendChild(item);
      void index;
    });
  }

  el("silentPlayer").addEventListener("timeupdate", function () {
    var now = el("silentPlayer").currentTime;
    Array.prototype.forEach.call(el("beatList").children, function (item) {
      var from = Number(item.getAttribute("data-from"));
      var to = Number(item.getAttribute("data-to"));
      var on = now >= from && now < to;
      if (on !== item.classList.contains("is-on")) {
        item.classList.toggle("is-on", on);
        if (on) item.scrollIntoView({ block: "nearest" });
      }
    });
  });

  /* ---- the take: a local recording, nothing burned in yet ---- */

  function dropTake() {
    stopTogether();
    if (mine.takeUrl) URL.revokeObjectURL(mine.takeUrl);
    mine.takeUrl = null;
    mine.take = null;
    el("takePlayback").removeAttribute("src");
    D.show(el("takeWrap"), false);
  }

  function resetTake() {
    stopTicker();
    dropTake();
    D.setText(el("recBtn"), "Record while it plays");
    el("recBtn").disabled = false;
    D.setText(el("recTimer"), "0:00");
    D.setText(el("recState"), "Press record. The video restarts from the beginning and you talk along with it.");
    D.showMessage(el("recError"), "");
    D.setText(el("fileState"), "");
    D.setText(el("syncState"), "");
    el("keepTakeBtn").disabled = false;
    D.setText(el("keepTakeBtn"), "Keep this take and add the audio to the video");
  }

  function holdTake(blob, name, how) {
    dropTake();
    mine.take = blob;
    mine.takeName = name;
    mine.takeUrl = URL.createObjectURL(blob);
    el("takePlayback").src = mine.takeUrl;
    D.show(el("takeWrap"), true);
    D.setText(el("syncState"), "");
    D.setText(el("recState"), how);
    el("takeWrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function stopTicker() {
    if (mine.ticker) clearInterval(mine.ticker);
    mine.ticker = null;
  }

  /* ---- recording ---- */

  function startRecording() {
    D.showMessage(el("recError"), "");
    stopTogether();
    dropTake();

    if (!navigator.mediaDevices || !window.MediaRecorder) {
      D.showMessage(el("recError"), "This browser cannot record. Upload an audio file instead.");
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(function (stream) {
        mine.stream = stream;
        var chunks = [];
        var recorder = new MediaRecorder(stream);
        mine.recorder = recorder;

        recorder.ondataavailable = function (event) {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.onstop = function () {
          stopTicker();
          stream.getTracks().forEach(function (track) {
            track.stop();
          });
          el("silentPlayer").pause();
          D.setText(el("recBtn"), "Record while it plays");
          holdTake(
            new Blob(chunks, { type: recorder.mimeType || "audio/webm" }),
            "take.webm",
            "Take recorded. Play it against the pictures, then keep it or record again."
          );
        };

        var player = el("silentPlayer");
        player.muted = true;
        player.currentTime = 0;
        // The microphone only opens once the picture is actually moving, so the
        // words land on the right scenes.
        Promise.resolve(player.play())
          .catch(function () {
            /* a muted, user-initiated video is allowed to autoplay; ignore */
          })
          .then(function () {
            recorder.start();
            mine.tickerStart = Date.now();
            D.setText(el("recTimer"), "0:00");
            mine.ticker = setInterval(function () {
              D.setText(el("recTimer"), D.clock((Date.now() - mine.tickerStart) / 1000));
            }, 250);
            D.setText(el("recBtn"), "Stop recording");
            D.setText(el("recState"), "Recording. Talk along with the video.");
          });

        player.onended = function () {
          if (mine.recorder && mine.recorder.state === "recording") mine.recorder.stop();
        };
      })
      .catch(function () {
        D.showMessage(el("recError"), "No microphone permission. Upload an audio file instead.");
      });
  }

  el("recBtn").addEventListener("click", function () {
    if (mine.recorder && mine.recorder.state === "recording") {
      mine.recorder.stop();
      return;
    }
    startRecording();
  });

  /* ---- hearing the take against the pictures, before anything is muxed ---- */

  // One button, two states. A separate Stop button next to it just read as a
  // second "Stop" and left people guessing which one to press.
  function stopTogether() {
    mine.together = false;
    var video = el("silentPlayer");
    var audio = el("takePlayback");
    video.pause();
    audio.pause();
    D.setText(el("playBothBtn"), "Play the video and this take together");
    D.setText(el("syncState"), "");
  }

  el("playBothBtn").addEventListener("click", function () {
    if (mine.together) {
      stopTogether();
      return;
    }
    if (!mine.take) return;
    if (mine.recorder && mine.recorder.state === "recording") mine.recorder.stop();

    var video = el("silentPlayer");
    var audio = el("takePlayback");
    video.muted = true;
    video.currentTime = 0;
    audio.currentTime = 0;
    mine.together = true;
    D.setText(el("playBothBtn"), "Stop them both");
    D.setText(el("syncState"), "Playing the pictures and your take together.");

    Promise.all([Promise.resolve(video.play()), Promise.resolve(audio.play())]).catch(function () {
      mine.together = false;
      D.setText(el("playBothBtn"), "Play the video and this take together");
      D.showMessage(el("recError"), "The browser would not start both at once. Press play on each one instead.");
    });
  });

  // Keep the take lined up with the picture while they play together. Browsers
  // drift a little, and the whole point of this screen is judging the timing.
  el("silentPlayer").addEventListener("timeupdate", function () {
    if (!mine.together) return;
    var video = el("silentPlayer");
    var audio = el("takePlayback");
    if (audio.duration && Math.abs(audio.currentTime - video.currentTime) > 0.3) {
      audio.currentTime = Math.min(video.currentTime, audio.duration - 0.05);
    }
  });

  el("silentPlayer").addEventListener("ended", function () {
    if (mine.together) stopTogether();
  });

  el("againTakeBtn").addEventListener("click", function () {
    startRecording();
  });

  el("dropTakeBtn").addEventListener("click", function () {
    resetTake();
  });

  el("audioFile").addEventListener("change", function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    D.setText(el("fileState"), "Using " + file.name);
    holdTake(file, file.name, "Using your uploaded file as the take. Play it against the pictures before you keep it.");
  });

  /* ---- keeping a take: this is the only thing that muxes ---- */

  el("keepTakeBtn").addEventListener("click", function () {
    if (!mine.take) return;
    stopTogether();
    D.showMessage(el("recError"), "");
    el("keepTakeBtn").disabled = true;
    D.setText(el("keepTakeBtn"), "Uploading the take...");

    var data = new FormData();
    data.append("audio", mine.take, mine.takeName);
    fetch(API + "/jobs/" + mine.jobId + "/audio", { method: "POST", body: data, credentials: "same-origin" })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        el("keepTakeBtn").disabled = false;
        D.setText(el("keepTakeBtn"), "Keep this take and add the audio to the video");
        if (!result.ok) {
          D.showMessage(el("recError"), D.errorFrom(result, "That audio did not go through."));
          return;
        }
        D.setText(el("progressTitle"), "Adding your audio to the video");
        step("progress", "audio");
        startPolling();
      })
      .catch(function () {
        el("keepTakeBtn").disabled = false;
        D.setText(el("keepTakeBtn"), "Keep this take and add the audio to the video");
        D.showMessage(el("recError"), "That audio did not go through. Try again.");
      });
  });

  el("aiBtn").addEventListener("click", function () {
    D.showMessage(el("recError"), "");
    stopTogether();
    D.send("POST", API + "/jobs/" + mine.jobId + "/ai-voice").then(function (result) {
      if (!result.ok) {
        D.showMessage(el("recError"), D.errorFrom(result, "The AI voice could not be used."));
        return;
      }
      D.setText(el("progressTitle"), "Building the AI voice and adding it to the video");
      step("progress", "audio");
      startPolling();
    });
  });

  /* ------------------------------------------------------------ */
  /* step 4: review, then send                                     */
  /* ------------------------------------------------------------ */
  function paintReview(job) {
    mine.watched = 0;
    mine.lastTime = 0;
    mine.reviewMarked = Boolean(job.review && job.review.reviewed);

    var bits = [job.template.name, job.result.voice.label, D.runtime(job.result.durationSeconds)];
    var text = bits.join(" \u00b7 ") + ".";
    // What the AI voice cost, when it was used and lines were reused.
    var voice = job.result.voice || {};
    if (voice.reusedLines) {
      text +=
        " Reused " +
        voice.reusedLines +
        " shared line" +
        (voice.reusedLines === 1 ? "" : "s") +
        ", so only " +
        Number(voice.billedCharacters || 0).toLocaleString() +
        " of " +
        Number(voice.scriptCharacters || 0).toLocaleString() +
        " characters were billed.";
    }
    if (job.result.capturedAddress) text += " Filmed on their listing for " + job.result.capturedAddress + ".";
    if (job.result.capturedPageUrl) text += " " + job.result.capturedPageUrl;
    if (job.result.notes && job.result.notes.length) text += " " + job.result.notes.join(" ");
    D.setText(el("reviewSummary"), text);

    el("reviewPlayer").src = API + "/jobs/" + job.id + "/video.mp4?t=" + Date.now();
    el("shareLink").value = job.watchUrl;
    el("emailTo").value = job.input.customerEmail;
    el("reviewedBox").checked = mine.reviewMarked;

    var fromSelect = el("emailFrom");
    fromSelect.innerHTML = "";
    ((D.state.session && D.state.session.fromAddresses) || []).forEach(function (entry) {
      var option = document.createElement("option");
      option.value = entry.id;
      option.textContent = "From: " + entry.label;
      if (entry.id === job.input.fromId) option.selected = true;
      fromSelect.appendChild(option);
    });

    D.showMessage(el("sendError"), "");
    D.show(el("sendOk"), false);
    D.showMessage(el("trimError"), "");
    D.show(el("trimOk"), false);
    D.show(el("trimOverlay"), Boolean(mine.trimming));
    applyTrimState();
    applyReviewState();
    loadDraft(job.id);
    step("review");
  }

  function mailConnected() {
    return Boolean(D.state.session && D.state.session.mail && D.state.session.mail.connected);
  }

  function applyReviewState() {
    var reviewed = mine.reviewMarked;
    var connected = mailConnected();
    D.show(el("reviewGate"), !reviewed);
    // Nothing goes out while the file is being cut: what is on disk right now is
    // neither the video they reviewed nor the one they asked for.
    el("sendBtn").disabled = !reviewed || !connected || mine.trimming;
    el("reviewedBox").disabled = mine.trimming;
    // Say which of the two reasons is holding the button, so a switched-off
    // button is never a mystery.
    D.setText(
      el("sendBtn"),
      mine.trimming ? "Trimming..." : connected ? (reviewed ? "Send email" : "Review it first") : "Mailbox not connected"
    );

    if (!connected) {
      var reason = (D.state.session.mail && D.state.session.mail.reason) || "Mailbox not connected.";
      D.showMessage(el("mailNotice"), reason + " Copy the watch link and the email text below and send it yourself.");
      D.show(el("draftWrap"), true);
    } else {
      D.show(el("mailNotice"), false);
    }
  }

  function markReviewed(how) {
    if (mine.reviewMarked) return;
    mine.reviewMarked = true;
    applyReviewState();
    D.send("POST", API + "/jobs/" + mine.jobId + "/reviewed", { how: how }).then(function (result) {
      if (!result.ok) {
        mine.reviewMarked = false;
        el("reviewedBox").checked = false;
        applyReviewState();
        D.showMessage(el("sendError"), D.errorFrom(result, "That review did not save."));
      }
    });
  }

  el("reviewPlayer").addEventListener("timeupdate", function () {
    var player = el("reviewPlayer");
    var jump = player.currentTime - mine.lastTime;
    if (jump > 0 && jump < 1.5) mine.watched += jump;
    mine.lastTime = player.currentTime;
    if (player.duration && mine.watched >= player.duration * 0.8) markReviewed("played");
    if (player.paused) applyTrimState();
  });

  el("reviewPlayer").addEventListener("ended", function () {
    markReviewed("played");
  });

  el("reviewedBox").addEventListener("change", function () {
    if (el("reviewedBox").checked) markReviewed("confirmed");
  });

  /*
   * Trimming the end off, which is the only thing that shortens a video.
   *
   * The picture is as long as the silent cut that was approved, so it holds after
   * the voice stops. The button only wakes up while the player is paused, because
   * the playhead is the cut - there is nothing to guess at.
   */
  function applyTrimState() {
    var player = el("reviewPlayer");
    var at = player.currentTime || 0;
    var paused = player.paused && at > 0 && !mine.trimming;
    // Under a second left is nothing worth re-encoding for, and it is what the
    // server refuses - so the button is never live for a cut it would reject.
    var leftToCut = player.duration ? player.duration - at : 0;
    var tooLate = player.duration ? leftToCut < 0.75 : false;

    el("trimBtn").disabled = !paused || tooLate || mine.trimming;
    if (mine.trimming) {
      D.setText(el("trimHint"), "Trimming...");
    } else if (!paused) {
      D.setText(el("trimHint"), "Pause the player to choose the ending.");
    } else if (tooLate) {
      D.setText(el("trimHint"), "That is already the end. Pause it earlier to cut something off.");
    } else {
      D.setText(el("trimHint"), "Would end at " + D.runtime(at) + ", cutting " + D.runtime(leftToCut) + ".");
    }
  }

  el("reviewPlayer").addEventListener("pause", applyTrimState);
  el("reviewPlayer").addEventListener("play", applyTrimState);
  el("reviewPlayer").addEventListener("seeked", applyTrimState);
  el("reviewPlayer").addEventListener("loadedmetadata", applyTrimState);

  /*
   * After a trim, show them the new ending rather than starting over at zero.
   *
   * paintReview points the player at the shorter file, so this waits for that
   * file's own length to arrive before seeking - a hair before the end, because
   * seeking exactly to it just leaves the player sitting at "ended".
   */
  function sitAtTheNewEnd() {
    var player = el("reviewPlayer");
    var settle = function () {
      player.removeEventListener("loadedmetadata", settle);
      if (!player.duration || !isFinite(player.duration)) return;
      try {
        player.currentTime = Math.max(0, player.duration - 0.4);
      } catch (_) {
        /* a player that will not seek yet is left where it is */
      }
      player.pause();
      applyTrimState();
    };
    player.addEventListener("loadedmetadata", settle);
    if (player.readyState >= 1) settle();
  }

  el("trimBtn").addEventListener("click", function () {
    var player = el("reviewPlayer");
    var at = player.currentTime || 0;
    if (player.paused === false || at <= 0) return;

    var cutting = player.duration ? D.runtime(player.duration - at) : "the rest";
    if (!window.confirm("Cut " + cutting + " off the end, so the video finishes at " + D.runtime(at) + "? This cannot be undone.")) {
      return;
    }

    D.showMessage(el("trimError"), "");
    D.show(el("trimOk"), false);
    D.setText(el("trimWorkingWhat"), "Ending it at " + D.runtime(at) + " and cutting " + cutting + ".");
    beginTrimWait();

    D.send("POST", API + "/jobs/" + mine.jobId + "/trim", { atSeconds: at }).then(function (result) {
      // The server queues the trim and answers at once, so a refusal here is a
      // bad request rather than a failed encode.
      if (!result.ok) {
        endTrimWait();
        D.showMessage(el("trimError"), D.errorFrom(result, "That video was not trimmed."));
      }
    });
  });

  /*
   * Waiting for a trim, with the step covered.
   *
   * The cut re-encodes the whole file, which is far too slow to hold an HTTP
   * request open for - Heroku hangs up at 30 seconds, which is what showed Bill
   * "That video was not trimmed" for a trim that was still running. So the
   * server queues it and this waits on the job, the way the capture does.
   */
  function beginTrimWait() {
    mine.trimming = true;
    mine.trimStartedAt = Date.now();
    mine.trimPollErrors = 0;
    D.show(el("trimOverlay"), true);
    applyTrimState();
    applyReviewState();

    var tick = function () {
      D.setText(
        el("trimWorkingElapsed"),
        "Working for " + D.clock((Date.now() - mine.trimStartedAt) / 1000) + "."
      );
    };
    var check = function () {
      D.json(API + "/jobs/" + mine.jobId).then(
        function (result) {
          if (result.status === 404) return settleTrim(null, GONE_MESSAGE);
          if (!result.ok) {
            mine.trimPollErrors += 1;
            if (mine.trimPollErrors >= MAX_POLL_ERRORS) return settleTrim(null, UNREACHABLE_MESSAGE);
            return undefined;
          }
          mine.trimPollErrors = 0;
          if (result.body.status === "trimming") return undefined;
          return settleTrim(result.body, result.body.error || "");
        },
        function () {
          mine.trimPollErrors += 1;
          if (mine.trimPollErrors >= MAX_POLL_ERRORS) settleTrim(null, UNREACHABLE_MESSAGE);
        }
      );
      tick();
    };
    tick();
    mine.trimPoll = setInterval(check, 2000);
  }

  function endTrimWait() {
    if (mine.trimPoll) clearInterval(mine.trimPoll);
    mine.trimPoll = null;
    mine.trimming = false;
    D.show(el("trimOverlay"), false);
    applyTrimState();
    applyReviewState();
  }

  /** The trim came back, one way or the other. */
  function settleTrim(job, message) {
    endTrimWait();
    if (!job) {
      D.showMessage(el("trimError"), message || "That video was not trimmed.");
      return;
    }
    // Repaints from the job, so the player picks up the shorter file and the
    // review starts again - it is not the video that was approved any more.
    paintReview(job);
    if (message) {
      D.showMessage(el("trimError"), message);
      return;
    }
    sitAtTheNewEnd();
    D.setText(el("trimOk"), "Trimmed. Watch it again, then send.");
    D.show(el("trimOk"), true);
  }

  el("trimStopWaitingBtn").addEventListener("click", function () {
    endTrimWait();
    D.showMessage(
      el("trimError"),
      "Stopped waiting. The trim is still running on the server - open this video from the Library in a minute to see it."
    );
  });

  el("redoAudioBtn").addEventListener("click", function () {
    if (mine.trimming) return;
    D.json(API + "/jobs/" + mine.jobId).then(function (result) {
      if (!result.ok) return;
      el("reviewPlayer").pause();
      paintSilent(result.body);
    });
  });

  function loadDraft(id) {
    D.json(API + "/jobs/" + id + "/email-draft").then(function (result) {
      if (!result.ok) return;
      D.setText(el("draftText"), "To: " + result.body.to + "\nSubject: " + result.body.subject + "\n\n" + result.body.text);
      if (!mailConnected()) D.show(el("draftWrap"), true);
    });
  }

  el("copyBtn").addEventListener("click", function () {
    D.copy(el("shareLink").value, el("copyBtn"), "Copy link");
  });

  el("copyDraft").addEventListener("click", function () {
    D.copy(el("draftText").textContent, el("copyDraft"), "Copy email text");
  });

  el("sendBtn").addEventListener("click", function () {
    D.showMessage(el("sendError"), "");
    D.show(el("sendOk"), false);
    el("sendBtn").disabled = true;
    D.setText(el("sendBtn"), "Sending...");

    D.send("POST", API + "/jobs/" + mine.jobId + "/email", {
      to: el("emailTo").value.trim(),
      fromId: el("emailFrom").value,
    }).then(function (result) {
      applyReviewState();
      if (result.ok && result.body.sent) {
        D.showMessage(el("sendOk"), "Sent to " + result.body.to + " from " + result.body.from + ".");
        return;
      }
      D.showMessage(el("sendError"), D.errorFrom(result, "The email did not send."));
      D.show(el("draftWrap"), true);
    });
  });

  /* ------------------------------------------------------------ */
  /* failure and reset                                             */
  /* ------------------------------------------------------------ */
  el("retryCaptureBtn").addEventListener("click", function () {
    var listingUrl = el("retryListingUrl").value.trim();
    D.send("POST", API + "/jobs/" + mine.jobId + "/recapture", { listingUrl: listingUrl }).then(function (result) {
      if (!result.ok) {
        D.setText(el("failedWhy"), D.errorFrom(result, "That did not start."));
        return;
      }
      D.setText(el("progressTitle"), "Trying that listing");
      step("progress", "silent");
      startPolling();
    });
  });

  /*
   * The upload, from the failure panel. Same job, same script, same customer -
   * only the listing picture comes from somewhere else.
   */
  el("uploadListingBtn").addEventListener("click", function () {
    D.showMessage(el("uploadError"), "");

    var file = (el("retryListingImage").files || [])[0];
    if (!file) {
      D.showMessage(el("uploadError"), "Pick a PNG or JPG screenshot of the listing page.");
      return;
    }
    if (!retryAddressPicker.typed()) {
      D.showMessage(
        el("uploadError"),
        "Start typing the listing's address and pick it from the list. Nothing is read off the picture, so without it there is nothing to point the Explorers at."
      );
      return;
    }
    if (!el("retryCleanShotField").hidden && !el("retryListingHasNoExplorer").checked) {
      D.showMessage(
        el("uploadError"),
        "This script is the \u201cbefore\u201d shot, so tick the box to confirm the listing you screenshotted has no Explorer on it yet. Nothing here can check a picture for one."
      );
      return;
    }

    var button = el("uploadListingBtn");
    var done = function (message) {
      button.disabled = false;
      D.setText(button, "Use this screenshot");
      if (message) D.showMessage(el("uploadError"), message);
    };

    button.disabled = true;
    D.setText(button, "Uploading...");

    postForm(
      API + "/jobs/" + mine.jobId + "/listing-image",
      Object.assign({}, retryAddressPicker.value(), {
        listingHasNoExplorer: el("retryListingHasNoExplorer").checked ? "yes" : "",
      }),
      file,
      "listingImage"
    ).then(function (result) {
      done(result.ok ? "" : D.errorFrom(result, "That screenshot was not accepted."));
      if (!result.ok) return;
      D.setText(el("progressTitle"), "Drawing the scenes from your screenshot");
      step("progress", "silent");
      startPolling();
    }, function () {
      done("The server did not answer. Try again.");
    });
  });

  function backToForm() {
    stopPolling();
    resetTake();
    mine.jobId = null;
    step("form");
  }

  el("retryBtn").addEventListener("click", backToForm);

  /*
   * Another video, which is nearly always another take on the same site.
   *
   * The form is reset and then filled back in from what was last used, because
   * this button is pressed to change one answer - the script, the voice, the
   * listing URL - and not to start again from an empty page. The remembered
   * fields select all of their text on the first click, so changing one is a
   * matter of typing over it.
   */
  el("againBtn").addEventListener("click", function () {
    el("form").reset();
    // form.reset() does not know about the picked place behind the address box.
    addressPicker.reset();
    resetTake();
    paintTemplateChoices();
    paintFromChoices();
    paintVoiceChoices();
    paintVoiceUsage();
    onPictureSourcePicked();
    paintRememberedAnswers();
    backToForm();
  });

  Array.prototype.forEach.call(document.querySelectorAll('input[name="pictureSource"]'), function (input) {
    input.addEventListener("change", onPictureSourcePicked);
  });

  /* Opening a video from the library drops straight into its own step. */
  function openJob(id) {
    mine.jobId = id;
    D.goTo("make");
    D.json(API + "/jobs/" + id).then(
      function (result) {
        if (result.status === 404) return giveUp(GONE_MESSAGE, false);
        if (!result.ok) return giveUp(D.errorFrom(result, UNREACHABLE_MESSAGE), false);
        paintJob(result.body);
        if (result.body.status === "queued" || result.body.status === "capturing" || result.body.status === "voicing") {
          startPolling();
        }
        return undefined;
      },
      function () {
        giveUp(UNREACHABLE_MESSAGE, false);
      }
    );
  }

  D.registerView("make", function () {
    if (!mine.jobId) {
      paintTemplateChoices();
      paintFromChoices();
      paintVoiceChoices();
      paintVoiceUsage();
      onPictureSourcePicked();
      paintRememberedAnswers();
      step("form");
    }
  });

  D.maker = {
    openJob: openJob,
    paintTemplateChoices: paintTemplateChoices,
    paintFromChoices: paintFromChoices,
    memory: memory,
  };
})();
