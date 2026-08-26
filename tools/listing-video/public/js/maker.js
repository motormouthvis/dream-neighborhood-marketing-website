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
        (template.notes ? "<br />" + D.escapeHtml(template.notes) : "") +
        "</span></span></span>";
      wrap.appendChild(label);
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('input[name="templateId"]'), function (input) {
      input.addEventListener("change", onTemplatePicked);
    });
    onTemplatePicked();
  }

  function onTemplatePicked() {
    var picked = D.selectedValue("templateId");
    el("makeBtn").disabled = !picked;
    D.show(el("templatePrompt"), !picked);
    D.show(el("makeHint"), !picked);
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
    };

    el("makeBtn").disabled = true;
    D.setText(el("makeBtn"), "Starting...");

    D.send("POST", API + "/jobs", payload).then(function (result) {
      el("makeBtn").disabled = false;
      D.setText(el("makeBtn"), "Make the silent video");
      if (!result.ok) {
        D.showMessage(el("form-error"), D.errorFrom(result, "That did not start."));
        return;
      }
      mine.jobId = result.body.id;
      D.setText(el("progressTitle"), "Finding one of their listing pages and drawing the scenes");
      step("progress", "silent");
      startPolling();
    });
  });

  /* ------------------------------------------------------------ */
  /* polling                                                       */
  /* ------------------------------------------------------------ */
  function startPolling() {
    stopPolling();
    var check = function () {
      D.json(API + "/jobs/" + mine.jobId).then(function (result) {
        if (!result.ok) return;
        paintJob(result.body);
      });
    };
    check();
    mine.poll = setInterval(check, 2500);
  }

  function stopPolling() {
    if (mine.poll) clearInterval(mine.poll);
    mine.poll = null;
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
      D.setText(el("failedWhy"), job.error || "Something went wrong.");
      D.show(el("retryListing"), Boolean(job.retryable));
      step("failed");
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
    if (job.silent && job.silent.capturedAddress) bits.push("filmed on their listing for " + job.silent.capturedAddress);
    if (job.silent && job.silent.capturedPageUrl) bits.push(job.silent.capturedPageUrl);
    D.setText(el("silentSummary"), bits.join(" \u00b7 ") + ".");

    var notes = (job.silent && job.silent.notes) || [];
    if (job.error) notes = notes.concat([job.error]);
    D.showMessage(el("silentNotes"), notes.join(" "));

    el("silentPlayer").src = API + "/jobs/" + job.id + "/silent.mp4?t=" + Date.now();
    paintBeatList();

    var ai = D.state.session && D.state.session.aiVoice;
    el("aiBtn").disabled = !(ai && ai.available);
    D.setText(
      el("aiNote"),
      ai && ai.available
        ? "The AI voice (" + ai.label + ") is the secondary option. It still has to be reviewed before it can be sent."
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

  function stopTogether() {
    mine.together = false;
    var video = el("silentPlayer");
    var audio = el("takePlayback");
    video.pause();
    audio.pause();
    D.setText(el("playBothBtn"), "Play the video and this take together");
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
    D.setText(el("playBothBtn"), "Stop");
    D.setText(el("syncState"), "Playing the pictures and your take together.");

    Promise.all([Promise.resolve(video.play()), Promise.resolve(audio.play())]).catch(function () {
      mine.together = false;
      D.setText(el("playBothBtn"), "Play the video and this take together");
      D.showMessage(el("recError"), "The browser would not start both at once. Press play on each one instead.");
    });
  });

  el("stopBothBtn").addEventListener("click", stopTogether);

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
    el("sendBtn").disabled = !reviewed || !connected;
    // Say which of the two reasons is holding the button, so a switched-off
    // button is never a mystery.
    D.setText(el("sendBtn"), connected ? (reviewed ? "Send email" : "Review it first") : "Mailbox not connected");

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
  });

  el("reviewPlayer").addEventListener("ended", function () {
    markReviewed("played");
  });

  el("reviewedBox").addEventListener("change", function () {
    if (el("reviewedBox").checked) markReviewed("confirmed");
  });

  el("redoAudioBtn").addEventListener("click", function () {
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

  function backToForm() {
    stopPolling();
    resetTake();
    mine.jobId = null;
    step("form");
  }

  el("retryBtn").addEventListener("click", backToForm);

  el("againBtn").addEventListener("click", function () {
    el("form").reset();
    resetTake();
    paintTemplateChoices();
    paintFromChoices();
    backToForm();
  });

  /* Opening a video from the library drops straight into its own step. */
  function openJob(id) {
    mine.jobId = id;
    D.goTo("make");
    D.json(API + "/jobs/" + id).then(function (result) {
      if (!result.ok) return;
      paintJob(result.body);
      if (result.body.status === "queued" || result.body.status === "capturing" || result.body.status === "voicing") {
        startPolling();
      }
    });
  }

  D.registerView("make", function () {
    if (!mine.jobId) {
      paintTemplateChoices();
      paintFromChoices();
      step("form");
    }
  });

  D.maker = { openJob: openJob, paintTemplateChoices: paintTemplateChoices, paintFromChoices: paintFromChoices };
})();
