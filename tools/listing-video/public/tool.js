/* Listing Video Maker - internal tool front end. One screen, plain English. */
(function () {
  "use strict";

  var API = "/tools/listing-video/api";
  var el = function (id) {
    return document.getElementById(id);
  };

  var state = {
    session: null,
    jobId: null,
    poll: null,
    recorder: null,
    recordedBlob: null,
    recordedStream: null,
    recTimer: null,
    recStart: 0,
    uploadedFile: null,
  };

  /* ------------------------------------------------------------ */
  /* helpers                                                       */
  /* ------------------------------------------------------------ */
  function show(node, visible) {
    if (node) node.hidden = !visible;
  }

  function setText(node, value) {
    if (node) node.textContent = value;
  }

  function showError(node, message) {
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

  /* ------------------------------------------------------------ */
  /* sign in                                                       */
  /* ------------------------------------------------------------ */
  function loadSession() {
    return json(API + "/session").then(function (result) {
      state.session = result.body;
      show(el("gate"), !state.session.signedIn);
      show(el("app"), state.session.signedIn);
      show(el("signout"), state.session.signedIn);
      if (state.session.signedIn) paintSession();
      return state.session;
    }, function () {
      // If the server cannot be reached, fall back to the sign-in panel rather
      // than leaving a blank page.
      show(el("gate"), true);
      showError(el("gate-error"), "Could not reach the server. Refresh the page.");
    });
  }

  function paintSession() {
    var session = state.session;

    var fromWrap = el("fromChoices");
    fromWrap.innerHTML = "";
    (session.fromAddresses || []).forEach(function (entry, index) {
      var label = document.createElement("label");
      label.className = "choice";
      label.innerHTML =
        '<input type="radio" name="fromId" value="' +
        entry.id +
        '"' +
        (index === 0 ? " checked" : "") +
        ' /><span class="choice__box"><span class="choice__mark" aria-hidden="true"></span>' +
        '<span class="choice__text"><strong class="choice__title">' +
        entry.label +
        "</strong></span></span>";
      fromWrap.appendChild(label);
    });

    var aiNote = el("aiVoiceNote");
    var aiRadio = document.querySelector('input[name="voiceMode"][value="ai"]');
    if (session.aiVoice && session.aiVoice.available) {
      setText(aiNote, "Professional female voice. Only your customer's name and company are personalized.");
      aiRadio.disabled = false;
    } else {
      setText(aiNote, "Not connected on this server yet. Use Overdub and record your own voice.");
      aiRadio.disabled = true;
      aiRadio.checked = false;
      document.querySelector('input[name="voiceMode"][value="overdub"]').checked = true;
    }
    onVoiceChange();

    var mailNotice = el("mailNotice");
    if (session.mail && !session.mail.connected) {
      setText(mailNotice, session.mail.reason + " Copy the link (or the email text) and send it yourself.");
      show(mailNotice, true);
      el("sendBtn").disabled = true;
    }
  }

  el("gate-form").addEventListener("submit", function (event) {
    event.preventDefault();
    showError(el("gate-error"), "");
    json(API + "/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: el("gate-token").value }),
    }).then(function (result) {
      if (result.ok) {
        el("gate-token").value = "";
        loadSession();
      } else {
        showError(el("gate-error"), (result.body && result.body.error) || "That did not work.");
      }
    });
  });

  el("signout").addEventListener("click", function () {
    json(API + "/signout", { method: "POST" }).then(function () {
      window.location.reload();
    });
  });

  /* ------------------------------------------------------------ */
  /* video type: required, no default                              */
  /* ------------------------------------------------------------ */
  function onVideoTypeChange() {
    var picked = selectedValue("videoType");
    el("makeBtn").disabled = !picked;
    show(el("videoTypePrompt"), !picked);
    show(el("makeHint"), !picked);
    if (picked) loadScript(picked);
  }

  Array.prototype.forEach.call(document.querySelectorAll('input[name="videoType"]'), function (input) {
    input.addEventListener("change", onVideoTypeChange);
  });

  function loadScript(videoType) {
    var query =
      "?videoType=" +
      encodeURIComponent(videoType) +
      "&firstName=" +
      encodeURIComponent(el("firstName").value.trim()) +
      "&company=" +
      encodeURIComponent(el("company").value.trim());
    json(API + "/script" + query).then(function (result) {
      if (result.ok) setText(el("scriptText"), result.body.text);
    });
  }

  ["firstName", "company"].forEach(function (id) {
    el(id).addEventListener("blur", function () {
      var picked = selectedValue("videoType");
      if (picked) loadScript(picked);
    });
  });

  /* ------------------------------------------------------------ */
  /* voice: AI or overdub                                          */
  /* ------------------------------------------------------------ */
  function onVoiceChange() {
    show(el("overdub"), selectedValue("voiceMode") === "overdub");
  }

  Array.prototype.forEach.call(document.querySelectorAll('input[name="voiceMode"]'), function (input) {
    input.addEventListener("change", onVoiceChange);
  });

  function stopTicking() {
    if (state.recTimer) clearInterval(state.recTimer);
    state.recTimer = null;
  }

  function tick() {
    var seconds = Math.floor((Date.now() - state.recStart) / 1000);
    setText(el("recTimer"), Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0"));
  }

  el("recBtn").addEventListener("click", function () {
    if (state.recorder && state.recorder.state === "recording") {
      state.recorder.stop();
      return;
    }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setText(el("recState"), "This browser cannot record. Upload a file instead.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(function (stream) {
        state.recordedStream = stream;
        var chunks = [];
        var recorder = new MediaRecorder(stream);
        state.recorder = recorder;
        recorder.ondataavailable = function (event) {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.onstop = function () {
          stopTicking();
          stream.getTracks().forEach(function (track) {
            track.stop();
          });
          state.recordedBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          state.uploadedFile = null;
          setText(el("fileState"), "No file chosen");
          var player = el("recPlayback");
          player.src = URL.createObjectURL(state.recordedBlob);
          show(player, true);
          setText(el("recState"), "Recorded. Play it back, or record again to replace it.");
          setText(el("recBtn"), "Record again");
        };
        recorder.start();
        state.recStart = Date.now();
        setText(el("recTimer"), "0:00");
        stopTicking();
        state.recTimer = setInterval(tick, 250);
        setText(el("recState"), "Recording. Talk, then press stop.");
        setText(el("recBtn"), "Stop recording");
      })
      .catch(function () {
        setText(el("recState"), "No microphone permission. Upload a file instead.");
      });
  });

  el("audioFile").addEventListener("change", function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    state.uploadedFile = file;
    state.recordedBlob = null;
    show(el("recPlayback"), false);
    setText(el("fileState"), file.name);
    setText(el("recState"), "Using your uploaded file.");
  });

  /* ------------------------------------------------------------ */
  /* make video                                                    */
  /* ------------------------------------------------------------ */
  el("form").addEventListener("submit", function (event) {
    event.preventDefault();
    showError(el("form-error"), "");

    var videoType = selectedValue("videoType");
    if (!videoType) {
      showError(el("form-error"), 'Pick a video type first: "School only" or "School + Neighborhood".');
      return;
    }

    var voiceMode = selectedValue("voiceMode");
    var data = new FormData();
    data.append("firstName", el("firstName").value.trim());
    data.append("company", el("company").value.trim());
    data.append("websiteUrl", el("websiteUrl").value.trim());
    data.append("customerEmail", el("customerEmail").value.trim());
    data.append("videoType", videoType);
    data.append("voiceMode", voiceMode);
    data.append("fromId", selectedValue("fromId"));

    if (voiceMode === "overdub") {
      if (state.uploadedFile) data.append("overdub", state.uploadedFile, state.uploadedFile.name);
      else if (state.recordedBlob) data.append("overdub", state.recordedBlob, "overdub.webm");
      else {
        showError(el("form-error"), "Record your voice or upload a file first.");
        return;
      }
    }

    el("makeBtn").disabled = true;
    setText(el("makeBtn"), "Starting...");

    fetch(API + "/jobs", { method: "POST", body: data, credentials: "same-origin" })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok) throw new Error((result.body && result.body.error) || "That did not start.");
        state.jobId = result.body.id;
        show(el("form"), false);
        show(el("progress"), true);
        show(el("result"), false);
        show(el("failed"), false);
        startPolling();
      })
      .catch(function (error) {
        showError(el("form-error"), error.message);
        el("makeBtn").disabled = false;
        setText(el("makeBtn"), "Make video");
      });
  });

  function startPolling() {
    if (state.poll) clearInterval(state.poll);
    var check = function () {
      json(API + "/jobs/" + state.jobId).then(function (result) {
        if (!result.ok) return;
        var job = result.body;
        paintSteps(job.progress || []);
        if (job.status === "ready") {
          clearInterval(state.poll);
          paintResult(job);
        } else if (job.status === "failed") {
          clearInterval(state.poll);
          show(el("progress"), false);
          show(el("failed"), true);
          setText(el("failedWhy"), job.error || "Something went wrong.");
        }
      });
    };
    check();
    state.poll = setInterval(check, 2500);
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

  function paintResult(job) {
    show(el("progress"), false);
    show(el("result"), true);

    var summary = [job.result.videoTypeLabel, job.result.voice.label, job.result.durationSeconds + " seconds"];
    var text = summary.join(" \u00b7 ") + ".";
    if (job.result.notes && job.result.notes.length) text += " " + job.result.notes.join(" ");
    setText(el("resultSummary"), text);

    el("player").src = "/v/" + job.id + "/video.mp4";
    el("player").poster = "/v/" + job.id + "/poster.jpg";
    el("shareLink").value = job.watchUrl;
    el("emailTo").value = job.input.customerEmail;

    var fromSelect = el("emailFrom");
    fromSelect.innerHTML = "";
    (state.session.fromAddresses || []).forEach(function (entry) {
      var option = document.createElement("option");
      option.value = entry.id;
      option.textContent = "From: " + entry.label;
      if (entry.id === job.input.fromId) option.selected = true;
      fromSelect.appendChild(option);
    });

    json(API + "/jobs/" + job.id + "/email-draft").then(function (result) {
      if (!result.ok) return;
      setText(el("draftText"), "Subject: " + result.body.subject + "\n\n" + result.body.text);
      show(el("draftWrap"), true);
    });
  }

  el("copyBtn").addEventListener("click", function () {
    copy(el("shareLink").value, el("copyBtn"), "Copy link");
  });

  el("copyDraft").addEventListener("click", function () {
    copy(el("draftText").textContent, el("copyDraft"), "Copy email text");
  });

  function copy(value, button, resetLabel) {
    // execCommand runs inside the click itself, so it works even where the async
    // clipboard API is blocked or left hanging.
    var copied = legacyCopy(value);
    if (copied) return done();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(done, failed);
    }
    return failed();

    function done() {
      setText(button, "Copied");
      setTimeout(function () {
        setText(button, resetLabel);
      }, 2000);
    }
    function failed() {
      setText(button, "Press Ctrl+C to copy");
      el("shareLink").focus();
      el("shareLink").select();
      setTimeout(function () {
        setText(button, resetLabel);
      }, 4000);
    }
  }

  function legacyCopy(value) {
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
    return ok;
  }

  el("sendBtn").addEventListener("click", function () {
    showError(el("sendError"), "");
    show(el("sendOk"), false);
    el("sendBtn").disabled = true;
    setText(el("sendBtn"), "Sending...");
    json(API + "/jobs/" + state.jobId + "/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: el("emailTo").value.trim(), fromId: el("emailFrom").value }),
    }).then(function (result) {
      el("sendBtn").disabled = false;
      setText(el("sendBtn"), "Send email");
      if (result.ok && result.body.sent) {
        setText(el("sendOk"), "Sent to " + result.body.to + " from " + result.body.from + ".");
        show(el("sendOk"), true);
      } else {
        showError(el("sendError"), (result.body && result.body.error) || "The email did not send.");
        show(el("draftWrap"), true);
      }
    });
  });

  function backToForm() {
    if (state.poll) clearInterval(state.poll);
    state.jobId = null;
    show(el("result"), false);
    show(el("failed"), false);
    show(el("progress"), false);
    show(el("form"), true);
    setText(el("makeBtn"), "Make video");
    onVideoTypeChange();
  }

  el("againBtn").addEventListener("click", function () {
    // reset() clears the video-type choice, because neither one is checked in the markup.
    el("form").reset();
    state.recordedBlob = null;
    state.uploadedFile = null;
    show(el("recPlayback"), false);
    setText(el("recBtn"), "Start recording");
    setText(el("recState"), "Not recording");
    setText(el("recTimer"), "0:00");
    setText(el("fileState"), "No file chosen");
    paintSession();
    backToForm();
  });

  el("retryBtn").addEventListener("click", backToForm);

  loadSession();
  onVideoTypeChange();
})();
