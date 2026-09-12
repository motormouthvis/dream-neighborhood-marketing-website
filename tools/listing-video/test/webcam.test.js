"use strict";

/*
 * The marketer's face, in the bottom left corner, and the four things that have
 * to stay true about it:
 *
 *   where it is      bottom LEFT. The School Explorer house button is drawn in
 *                    the bottom right of every listing frame and covering it
 *                    would break the one thing the video is for
 *   when it is       from the first word to the last, and nowhere else. A take
 *                    has its dead air trimmed off the front, so a card that
 *                    started with the recording would be up before the voice
 *   what replaces it a re-record replaces the face along with the voice, and a
 *                    re-record with the camera off takes it away entirely
 *   what never has it the AI voice. Nobody was in the room, so there is nothing
 *                    to film and asking for one cannot make one appear
 *
 * The pictures are flat colours on purpose: a scene that is only blue and a
 * camera that is only green means "is the face there" can be asked of a pixel
 * rather than of a person.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-webcam-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "webcam-token";

const config = require("../src/config");
const store = require("../src/store");
const templates = require("../src/templates");
const { run } = require("../src/exec");
const { buildVideo, buildSilentVideo } = require("../src/video");
const { launch, closeBrowser } = require("../src/browser");
const { buildRecordedTrack, probeDuration } = require("../src/audio");
const { attachAudio } = require("../src/render");
const webcam = require("../src/webcam");
const app = require("../server");

const TOOL = "/tools/listing-video";

/* The frames are this blue, the camera is this green, the card's edge is white. */
const SCENE = [0x1a, 0x3a, 0x8a];
const FACE = [0x22, 0xcc, 0x44];

/* ---------------------------------------------------------------- */
/* fixtures                                                         */
/* ---------------------------------------------------------------- */

async function stills(dir, count) {
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const frame = path.join(dir, `frame-${i}.png`);
    await run(config.ffmpegPath, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x1a3a8a:s=1920x1080`,
      "-frames:v",
      "1",
      frame,
    ]);
    frames.push(frame);
  }
  return frames;
}

/**
 * A take as the browser records one: one file, camera and microphone together.
 *
 * `quiet` is the dead air in front of the first word, which is the thing the
 * audio pipeline trims and therefore the thing the camera has to be trimmed by.
 * The camera runs for the whole recording, quiet part included, exactly as a
 * real one would.
 */
async function takeWithCamera(dir, { speechSeconds, quietSeconds = 0, name = "take.webm" } = {}) {
  const file = path.join(dir, name);
  const total = speechSeconds + quietSeconds;
  const voice = quietSeconds
    ? `anullsrc=r=44100:cl=mono:d=${quietSeconds},asetpts=PTS-STARTPTS`
    : null;

  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x22cc44:s=640x480:r=30:d=${total}`,
  ];
  if (voice) {
    args.push("-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono:d=${quietSeconds}`);
    args.push("-f", "lavfi", "-i", `sine=frequency=320:duration=${speechSeconds}:sample_rate=44100`);
    args.push("-filter_complex", "[1:a][2:a]concat=n=2:v=0:a=1[a]");
    args.push("-map", "0:v:0", "-map", "[a]");
  } else {
    args.push("-f", "lavfi", "-i", `sine=frequency=320:duration=${speechSeconds}:sample_rate=44100`);
    args.push("-map", "0:v:0", "-map", "1:a:0");
  }
  args.push("-c:v", "libvpx", "-b:v", "600k", "-c:a", "libopus", "-t", String(total), file);

  await run(config.ffmpegPath, args, { timeout: 180000 });
  return file;
}

/** A take with no camera in it: the microphone on its own, as it always was. */
async function takeWithoutCamera(dir, { speechSeconds, quietSeconds = 0, name = "voice-only.webm" } = {}) {
  const file = path.join(dir, name);
  const args = ["-y"];
  if (quietSeconds) {
    args.push("-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono:d=${quietSeconds}`);
    args.push("-f", "lavfi", "-i", `sine=frequency=320:duration=${speechSeconds}:sample_rate=44100`);
    args.push("-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[a]", "-map", "[a]");
  } else {
    args.push("-f", "lavfi", "-i", `sine=frequency=320:duration=${speechSeconds}:sample_rate=44100`);
  }
  args.push("-c:a", "libopus", file);
  await run(config.ffmpegPath, args, { timeout: 120000 });
  return file;
}

/**
 * The average colour of a rectangle of one frame.
 *
 * Read out as raw RGB rather than looked at, so "the face is in the corner" is a
 * number and not an opinion.
 */
async function patch(file, atSeconds, { x, y, w, h }, dir) {
  const out = path.join(dir, `patch-${Math.round(atSeconds * 1000)}-${x}-${y}.raw`);
  await run(config.ffmpegPath, [
    "-y",
    "-ss",
    atSeconds.toFixed(3),
    "-i",
    file,
    "-frames:v",
    "1",
    "-vf",
    `crop=${w}:${h}:${x}:${y}`,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    out,
  ]);
  const bytes = await fsp.readFile(out);
  const totals = [0, 0, 0];
  for (let at = 0; at < bytes.length; at += 3) {
    totals[0] += bytes[at];
    totals[1] += bytes[at + 1];
    totals[2] += bytes[at + 2];
  }
  const pixels = bytes.length / 3;
  return totals.map((sum) => Math.round(sum / pixels));
}

/** Near enough, given everything has been through h264 twice. */
function looksLike(got, wanted, tolerance = 26) {
  return got.every((channel, at) => Math.abs(channel - wanted[at]) <= tolerance);
}

function describe(colour) {
  return `rgb(${colour.join(", ")})`;
}

/* Where the card sits on a finished 1920x1080 frame, from the geometry itself. */
const CARD = {
  left: webcam.PIP.margin,
  top: 1080 - webcam.CARD_HEIGHT - webcam.PIP.margin,
  width: webcam.CARD_WIDTH,
  height: webcam.CARD_HEIGHT,
};
const FACE_MIDDLE = {
  x: CARD.left + Math.round(CARD.width / 2) - 20,
  y: CARD.top + Math.round(CARD.height / 2) - 20,
  w: 40,
  h: 40,
};
/* The house button's corner, which nothing is allowed to touch. */
const HOUSE_CORNER = { x: 1920 - 200, y: 1080 - 200, w: 120, h: 120 };

/* ---------------------------------------------------------------- */
/* the geometry: bottom left, and clear of the house button          */
/* ---------------------------------------------------------------- */

test("the card is placed from the left edge, never the right", () => {
  const filter = webcam.pipFilter({ startSeconds: 0.6 });

  // x is a fixed inset from the left. `W-w-` would be the right-hand corner,
  // which is the house button, and this is the line that would let it back in.
  assert.match(filter, new RegExp(`overlay=x=${webcam.PIP.margin}:y=H-h-${webcam.PIP.margin}`));
  assert.doesNotMatch(filter, /overlay=x=W-w/);

  // It stops well short of the middle of the frame, let alone the far corner.
  assert.ok(CARD.left + CARD.width < 1920 / 2, `the card ends at ${CARD.left + CARD.width}px`);
  assert.ok(CARD.top + CARD.height < 1080, "and inside the bottom edge");
});

test("the card waits for the first word instead of starting with the recording", () => {
  assert.match(webcam.pipFilter({ startSeconds: 0.6 }), /setpts=PTS-STARTPTS\+0\.600\/TB/);
  assert.match(webcam.pipFilter({ startSeconds: 2.25 }), /setpts=PTS-STARTPTS\+2\.250\/TB/);
});

test("the card leaves when the take does, rather than freezing on screen", () => {
  // Without these the last camera frame is held for the rest of the video, so a
  // 30 second take on a 60 second cut would end on a still of somebody's face.
  const filter = webcam.pipFilter({ startSeconds: 0.6 });
  assert.match(filter, /repeatlast=0/);
  assert.match(filter, /eof_action=pass/);
});

/* ---------------------------------------------------------------- */
/* the clip: cut to the same window the voice was cut to             */
/* ---------------------------------------------------------------- */

test("a take reports which slice of it survived the trim", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "align-"));
  const take = await takeWithCamera(dir, { speechSeconds: 4, quietSeconds: 2.5 });
  const track = await buildRecordedTrack({ uploadPath: take, workDir: dir, log: () => {} });

  // The 2.5s of nothing at the front is what came off, so that is where the
  // camera has to start.
  assert.ok(
    Math.abs(track.align.skipSeconds - 2.5) < 0.4,
    `the trim says it cut ${track.align.skipSeconds.toFixed(2)}s, but the take opens with 2.5s of silence`
  );
  assert.ok(
    Math.abs(track.align.keepSeconds - 4) < 0.5,
    `it says it kept ${track.align.keepSeconds.toFixed(2)}s of a 4s line`
  );
  // And it lands after the lead silence every finished video opens with.
  assert.equal(track.align.startSeconds, 0.6);
});

test("a camera clip is cut to that window and no wider", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "clip-"));
  const take = await takeWithCamera(dir, { speechSeconds: 4, quietSeconds: 2.5 });
  const track = await buildRecordedTrack({ uploadPath: take, workDir: dir, log: () => {} });

  const clip = await webcam.prepareWebcamClip({ takePath: take, workDir: dir, align: track.align, log: () => {} });
  assert.ok(clip, "there is a camera in that take");
  assert.ok(
    Math.abs(clip.seconds - track.align.keepSeconds) < 0.35,
    `the clip is ${clip.seconds.toFixed(2)}s and the voice is ${track.align.keepSeconds.toFixed(2)}s`
  );
  assert.equal(clip.startSeconds, 0.6);

  // Cut to the card's own shape, so nothing is scaled again in the overlay pass.
  const { stdout } = await run(config.ffprobePath, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    clip.file,
  ]);
  assert.equal(stdout.trim(), `${webcam.PIP.width},${webcam.PIP.height}`);
});

test("a take with no camera in it is not a failure, it is a video without a face", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "no-cam-"));
  const take = await takeWithoutCamera(dir, { speechSeconds: 3 });

  assert.equal(await webcam.hasVideoTrack(take), false);

  const said = [];
  const clip = await webcam.prepareWebcamClip({
    takePath: take,
    workDir: dir,
    align: { skipSeconds: 0, keepSeconds: 3, startSeconds: 0.6 },
    log: (message) => said.push(message),
  });
  assert.equal(clip, null);
  assert.match(said.join(" "), /No camera in that take/);
});

/* ---------------------------------------------------------------- */
/* the burn: a face in the corner, and the corner it is in           */
/* ---------------------------------------------------------------- */

/** Burn a take onto three flat blue scenes, with the camera if there is one. */
async function burn(dir, take, { withCamera }) {
  const track = await buildRecordedTrack({ uploadPath: take, workDir: dir, log: () => {} });
  const clip = withCamera
    ? await webcam.prepareWebcamClip({ takePath: take, workDir: dir, align: track.align, log: () => {} })
    : null;
  const frames = await stills(dir, 3);
  const video = await buildVideo({
    frames,
    durations: [4, 4, 4],
    audioFile: track.audioFile,
    workDir: dir,
    outFile: path.join(dir, `out-${withCamera ? "cam" : "plain"}.mp4`),
    log: () => {},
  ...(clip ? { webcam: clip } : {}),
  });
  return { video, clip, track };
}

test("the finished video has the face bottom left and the house corner untouched", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "burn-"));
  const take = await takeWithCamera(dir, { speechSeconds: 6 });
  const { video, clip } = await burn(dir, take, { withCamera: true });

  const mid = 0.6 + clip.seconds / 2;

  const face = await patch(video.file, mid, FACE_MIDDLE, dir);
  assert.ok(looksLike(face, FACE), `the middle of the card is ${describe(face)}, wanted the camera's green`);

  // The bottom RIGHT is the listing, exactly as it was. This is the assertion
  // that fails if the card is ever moved to the other corner.
  const house = await patch(video.file, mid, HOUSE_CORNER, dir);
  assert.ok(looksLike(house, SCENE), `the house button's corner is ${describe(house)}, wanted the scene`);

  // The white edge the card is drawn with, just inside the dark hairline.
  const edge = await patch(
    video.file,
    mid,
    { x: CARD.left + CARD.width / 2, y: CARD.top + webcam.PIP.rim + 2, w: 10, h: 2 },
    dir
  );
  assert.ok(edge.every((channel) => channel > 200), `the card's edge is ${describe(edge)}, wanted white`);

  // And the corners are rounded off, so what is drawn is a card and not a box:
  // the very corner pixel is still the scene behind it.
  const corner = await patch(video.file, mid, { x: CARD.left + 1, y: CARD.top + 1, w: 3, h: 3 }, dir);
  assert.ok(looksLike(corner, SCENE, 40), `the card's corner is ${describe(corner)}, wanted the scene through it`);
});

/*
 * The refactor this change needed, and the proof it cost nothing.
 *
 * buildVideo used to hand ffmpeg a `-vf` and map the concat input straight to
 * the output. An overlay needs a second video input, which means a filtergraph,
 * which means every video that has nothing to do with the camera now goes down a
 * different code path than it did yesterday.
 *
 * So this runs the command as it was written before the camera existed, over the
 * frame list buildVideo itself wrote, and compares the bytes. Not "close enough"
 * and not "the same length": the same file.
 */
test("a video with no camera is the same file the old one-pass command made", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "unchanged-"));
  const take = await takeWithoutCamera(dir, { speechSeconds: 6 });
  const track = await buildRecordedTrack({ uploadPath: take, workDir: dir, log: () => {} });
  const frames = await stills(dir, 3);

  const now = await buildVideo({
    frames,
    durations: [4, 4, 4],
    audioFile: track.audioFile,
    workDir: dir,
    outFile: path.join(dir, "now.mp4"),
    log: () => {},
  });

  const before = path.join(dir, "before.mp4");
  await run(config.ffmpegPath, [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", path.join(dir, "frames-voiced.txt"),
    "-i", track.audioFile,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-t", "12.000",
    "-af", "apad",
    "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-profile:v", "high",
    "-level", "4.0",
    "-movflags", "+faststart",
    "-crf", "21",
    "-c:a", "aac",
    "-b:a", "160k",
    "-ar", "44100",
    before,
  ], { timeout: 900000 });

  const digest = async (file) =>
    crypto.createHash("sha256").update(await fsp.readFile(file)).digest("hex");
  assert.equal(await digest(now.file), await digest(before), "the filtergraph changed what a plain video encodes to");
});

test("the picture is the length the scenes asked for, camera or no camera", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "length-"));
  const take = await takeWithCamera(dir, { speechSeconds: 5 });
  const { video } = await burn(dir, take, { withCamera: true });

  // Bill's rule is not up for renegotiation by an overlay: twelve seconds of
  // scenes is a twelve second video whatever is composited onto it.
  assert.ok(Math.abs(video.duration - 12) < 0.4, `the video is ${video.duration.toFixed(2)}s, wanted 12s`);
});

test("the face is not on screen before the first word, or after the last", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "window-"));
  const take = await takeWithCamera(dir, { speechSeconds: 4 });
  const { video, clip } = await burn(dir, take, { withCamera: true });

  const before = await patch(video.file, 0.2, FACE_MIDDLE, dir);
  assert.ok(looksLike(before, SCENE), `at 0.2s the corner is ${describe(before)}, but nobody has spoken yet`);

  const after = await patch(video.file, Math.min(11.5, 0.6 + clip.seconds + 1.5), FACE_MIDDLE, dir);
  assert.ok(looksLike(after, SCENE), `after the take the corner is ${describe(after)}, so the last frame froze there`);
});

test("a video burned without the camera has nothing in that corner at all", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "plain-"));
  const take = await takeWithCamera(dir, { speechSeconds: 5 });
  const { video } = await burn(dir, take, { withCamera: false });

  for (const at of [0.2, 3, 6, 9]) {
    const corner = await patch(video.file, at, FACE_MIDDLE, dir);
    assert.ok(looksLike(corner, SCENE), `at ${at}s the corner is ${describe(corner)} on a video nobody asked a face for`);
  }
});

/* ---------------------------------------------------------------- */
/* re-recording, and the path that can never have a face             */
/* ---------------------------------------------------------------- */

/**
 * A job sitting on the record step with three flat scenes behind it.
 *
 * `withSilentCut` builds the mp4 the record step actually plays, which only the
 * browser test needs - it is a render, and the other tests have no player.
 */
async function jobReadyToRecord({ withSilentCut = false } = {}) {
  const template = await templates.getDefault("vanessa-se-only-v11");
  const input = {
    templateId: template.id,
    firstName: "Myles",
    company: "DOMO Realty",
    websiteUrl: "https://example.test/",
    listingUrl: "",
    customerEmail: "fixture@example.test",
    fromId: "myles",
    voiceId: "",
    showCaptions: false,
  };
  const job = await store.createJob({ input, template, beats: templates.renderBeats(template, input) });
  const dir = store.jobDir(job.id);
  const workDir = path.join(dir, "work");
  await fsp.mkdir(workDir, { recursive: true });

  const frames = await stills(workDir, 3);
  job.beats = [0, 1, 2].map((at) => ({
    scene: "listing",
    seconds: 4,
    text: `Scene ${at + 1}.`,
    caption: { headline: "", subline: "" },
    neTab: null,
    neTabName: "",
  }));
  const silentPath = path.join(dir, "silent.mp4");
  if (withSilentCut) {
    await buildSilentVideo({
      frames,
      durations: [4, 4, 4],
      workDir,
      outFile: silentPath,
      log: () => {},
    });
  }

  job.silent = {
    file: silentPath,
    posterFile: "",
    durationSeconds: 12,
    frames,
    frameBeats: [0, 1, 2],
    capturedPageUrl: "",
    capturedAddress: null,
    checkedPages: [],
    notes: [],
  };
  job.status = "silent-ready";
  await store.persist(job);
  return { job, dir, workDir };
}

test("a second take replaces the face, and a second take without one takes it away", async () => {
  const { job, dir, workDir } = await jobReadyToRecord();

  const withCamera = await takeWithCamera(workDir, { speechSeconds: 5, name: "first.webm" });
  await attachAudio(job, { source: "recorded", uploadPath: withCamera, withWebcam: true });
  assert.equal(job.status, "ready", job.error || "");
  assert.equal(job.result.webcam.shown, true);
  assert.equal(job.result.webcam.corner, "bottom-left");

  const framed = await patch(job.result.videoFile, 3, FACE_MIDDLE, dir);
  assert.ok(looksLike(framed, FACE), `the first take put ${describe(framed)} in the corner`);

  // Now record it again with the camera switched off. The old clip must not
  // survive into the new cut - it is the scratch file sitting in the same folder.
  const plain = await takeWithoutCamera(workDir, { speechSeconds: 5, name: "second.webm" });
  await attachAudio(job, { source: "recorded", uploadPath: plain, withWebcam: false });
  assert.equal(job.status, "ready", job.error || "");
  assert.equal(job.result.webcam.asked, false);
  assert.equal(job.result.webcam.shown, false);

  for (const at of [1, 3, 6]) {
    const corner = await patch(job.result.videoFile, at, FACE_MIDDLE, dir);
    assert.ok(
      looksLike(corner, SCENE),
      `the re-record left ${describe(corner)} in the corner at ${at}s - the old take is still in the video`
    );
  }
  assert.equal(fs.existsSync(path.join(workDir, "webcam.mp4")), false, "and the clip is not left on disk");
});

test("asking for a camera on a take that has none says so rather than pretending", async () => {
  const { job, workDir } = await jobReadyToRecord();
  const plain = await takeWithoutCamera(workDir, { speechSeconds: 4, name: "asked.webm" });

  await attachAudio(job, { source: "recorded", uploadPath: plain, withWebcam: true });
  assert.equal(job.status, "ready", job.error || "");
  // Asked for, not delivered, and both halves are written down: the review step
  // is the only place anybody would find out otherwise.
  assert.equal(job.result.webcam.asked, true);
  assert.equal(job.result.webcam.shown, false);
  assert.match(job.progress.map((entry) => entry.message).join(" "), /No camera in that take/);
});

test("the AI voice never has a face, because nobody was there to film", async () => {
  const engines = require("../src/audio").availableVoiceEngines();
  if (engines.length === 0) {
    // Nothing to speak with on this machine; the wiring is still worth checking.
    const { job, workDir } = await jobReadyToRecord();
    const take = await takeWithCamera(workDir, { speechSeconds: 4, name: "ai.webm" });
    await attachAudio(job, { source: "recorded", uploadPath: take, withWebcam: true });
    assert.equal(job.result.webcam.shown, true);

    await attachAudio(job, { source: "ai", uploadPath: take, withWebcam: true });
    // The AI path failed for want of a voice engine, which drops back to the
    // record step and leaves the previous cut alone - so the assertion that
    // matters is the one below, on the source check itself.
    assert.equal(job.status, "silent-ready");
  }

  // withWebcam is ignored outright on the AI path: there is no take to cut a
  // clip out of, and a face from some earlier recording is not this voice.
  const source = fs.readFileSync(path.join(config.root, "src", "render.js"), "utf8");
  assert.match(source, /if \(source !== "ai" && withWebcam\)/);
  assert.match(source, /asked: source !== "ai" && Boolean\(withWebcam\)/);
});

/* ---------------------------------------------------------------- */
/* the toggle, and the switch that turns the whole thing off         */
/* ---------------------------------------------------------------- */

async function startServer() {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const signin = await fetch(`${origin}${TOOL}/api/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "webcam-token" }),
  });
  const cookie = signin.headers.getSetCookie()[0].split(";")[0];
  return { origin, cookie, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Wait for a queued render to stop being a queued render. */
async function settled(jobId, timeoutMs = 120000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const job = await store.getJob(jobId);
    if (job && job.status !== "voicing") return job;
    if (Date.now() > until) throw new Error(`job ${jobId} never finished rendering`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test("the record step ships the camera toggle switched off", () => {
  const page = fs.readFileSync(path.join(config.root, "public", "tool.html"), "utf8");
  const field = page.match(/<div id="webcamField"[\s\S]*?<\/div>/);
  assert.ok(field, "there is a camera toggle on the record step");

  const box = field[0].match(/<input type="checkbox" id="webcamToggle"[^>]*>/);
  assert.ok(box, field[0]);
  assert.doesNotMatch(box[0], /checked/, "nothing ships with the camera already on");
  // And it says which corner, because that is the question anybody asks first.
  assert.match(field[0], /bottom-left/i);

  // The front end clears it every time the record step is painted, so a job that
  // was recorded with a face does not quietly arm the next one.
  const maker = fs.readFileSync(path.join(config.root, "public", "js", "maker.js"), "utf8");
  assert.match(maker, /el\("webcamToggle"\)\.checked = false/);
});

test("the session says whether this box offers the camera at all", async () => {
  const tool = await startServer();
  try {
    const answered = await fetch(`${tool.origin}${TOOL}/api/session`, { headers: { cookie: tool.cookie } });
    const body = await answered.json();
    assert.equal(body.webcam.allowed, config.webcam.allowed);
    assert.equal(body.webcam.corner, "bottom-left");
  } finally {
    await tool.close();
  }
});

test("a box with the camera switched off keeps the take and drops the face", async () => {
  const { job, workDir } = await jobReadyToRecord();
  const take = await takeWithCamera(workDir, { speechSeconds: 4, name: "switched-off.webm" });

  const tool = await startServer();
  const was = config.webcam.allowed;
  try {
    config.webcam.allowed = false;

    const form = new FormData();
    form.append("webcam", "on");
    form.append("audio", new Blob([await fsp.readFile(take)], { type: "video/webm" }), "take.webm");
    const posted = await fetch(`${tool.origin}${TOOL}/api/jobs/${job.id}/audio`, {
      method: "POST",
      headers: { cookie: tool.cookie },
      body: form,
    });

    // Accepted, not refused. Losing a recording over a setting somebody cannot
    // see would be the worse of the two answers.
    assert.equal(posted.status, 202);
    const after = await store.getJob(job.id);
    assert.equal(after.input.webcam, false);
    assert.match(
      after.progress.map((entry) => entry.message).join(" "),
      /camera card is switched off on this server/
    );
  } finally {
    config.webcam.allowed = was;
    await tool.close();
  }
});

test("a take that asks for the camera on a box that allows it is recorded as asking", async () => {
  const { job, workDir } = await jobReadyToRecord();
  const take = await takeWithCamera(workDir, { speechSeconds: 3, name: "asked-on.webm" });

  const tool = await startServer();
  try {
    const form = new FormData();
    form.append("webcam", "on");
    form.append("audio", new Blob([await fsp.readFile(take)], { type: "video/webm" }), "take.webm");
    const posted = await fetch(`${tool.origin}${TOOL}/api/jobs/${job.id}/audio`, {
      method: "POST",
      headers: { cookie: tool.cookie },
      body: form,
    });
    assert.equal(posted.status, 202);
    assert.equal((await store.getJob(job.id)).input.webcam, true);

    // The render is queued, not done, and the take it is reading gets deleted
    // when it finishes - so the second post waits for the first to let go.
    await settled(job.id);

    // And a take that does not ask is not given one.
    const quiet = await store.getJob(job.id);
    quiet.status = "silent-ready";
    await store.persist(quiet);
    const plainForm = new FormData();
    plainForm.append("webcam", "off");
    plainForm.append("audio", new Blob([await fsp.readFile(take)], { type: "video/webm" }), "take.webm");
    await fetch(`${tool.origin}${TOOL}/api/jobs/${job.id}/audio`, {
      method: "POST",
      headers: { cookie: tool.cookie },
      body: plainForm,
    });
    assert.equal((await store.getJob(job.id)).input.webcam, false);
  } finally {
    await tool.close();
  }
});

test("a finished cut says whether there is somebody in it", async () => {
  const { job, workDir } = await jobReadyToRecord();
  const take = await takeWithCamera(workDir, { speechSeconds: 4, name: "review.webm" });
  // What the route writes down when a take asks for the camera, so the record
  // step can put the toggle back where it was left.
  job.input.webcam = true;
  await attachAudio(job, { source: "recorded", uploadPath: take, withWebcam: true });

  const view = store.publicView(job);
  assert.equal(view.result.webcam.shown, true);
  assert.equal(view.result.webcam.corner, "bottom-left");
  assert.ok(view.result.webcam.seconds > 1, `${view.result.webcam.seconds}s of camera`);
  assert.equal(view.input.webcam, true);

  // The review step names it, so a face is never something that has to be
  // spotted in the player.
  const maker = fs.readFileSync(path.join(config.root, "public", "js", "maker.js"), "utf8");
  assert.match(maker, /you in the bottom-left corner for/);
});

/* ---------------------------------------------------------------- */
/* the whole thing, in a real browser, with a real camera            */
/* ---------------------------------------------------------------- */

/*
 * Everything above this line tests the half of the feature that runs on the
 * server. The other half is a browser opening a camera, recording it into the
 * same file as the microphone and posting it, and none of it is exercised by
 * calling functions.
 *
 * So this drives the actual record step in actual Chrome. src/browser.js already
 * launches with --use-fake-device-for-media-stream, for an unrelated reason - a
 * realtor site's voice widget being told no put a permission panel in the middle
 * of a finished video - and a fake camera is exactly what this needs.
 */
const noChrome = !config.chromePath;
const needsChrome = noChrome ? { skip: "no Chrome or Chromium on this machine" } : {};

async function openRecordStep(jobId) {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const signin = await fetch(`${origin}${TOOL}/api/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "webcam-token" }),
  });
  const cookie = signin.headers.getSetCookie()[0].split(";")[0];

  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookie({
    name: cookie.split("=")[0],
    value: cookie.split("=").slice(1).join("="),
    domain: "127.0.0.1",
    path: "/",
  });
  await page.goto(`${origin}${TOOL}`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => window.DNLV && window.DNLV.maker, { timeout: 20000 });
  await page.evaluate((id) => window.DNLV.maker.openJob(id), jobId);
  await page.waitForFunction(() => !document.getElementById("step-record").hidden, { timeout: 20000 });

  return {
    page,
    origin,
    async close() {
      await closeBrowser(browser);
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("a browser records the camera with the voice and the burn puts it in the corner", needsChrome, async () => {
  const { job } = await jobReadyToRecord({ withSilentCut: true });
  const tool = await openRecordStep(job.id);
  try {
    // Offered, and offered off.
    assert.equal(await tool.page.$eval("#webcamField", (field) => field.hidden), false);
    assert.equal(await tool.page.$eval("#webcamToggle", (box) => box.checked), false);

    await tool.page.click("#webcamToggle");
    await tool.page.click("#recBtn");

    // The self-view comes up, with a real camera behind it rather than a poster.
    await tool.page.waitForFunction(
      () => {
        const live = document.getElementById("webcamLive");
        return !live.hidden && live.videoWidth > 0 && !live.paused;
      },
      { timeout: 20000 }
    );
    assert.match(await tool.page.$eval("#recState", (node) => node.textContent), /you are in shot bottom left/);

    await new Promise((resolve) => setTimeout(resolve, 3500));
    await tool.page.click("#recBtn");

    // A take, with a camera in it, previewed in the corner it will be burned in.
    await tool.page.waitForFunction(() => !document.getElementById("takeWrap").hidden, { timeout: 20000 });
    const held = await tool.page.evaluate(() => ({
      previewShown: !document.getElementById("webcamPreview").hidden,
      previewHasSource: Boolean(document.getElementById("webcamPreview").src),
      noteShown: !document.getElementById("takeWebcamNote").hidden,
      liveGone: document.getElementById("webcamLive").hidden,
      state: document.getElementById("recState").textContent.trim(),
    }));
    assert.equal(held.previewShown, true);
    assert.equal(held.previewHasSource, true);
    assert.equal(held.noteShown, true);
    assert.equal(held.liveGone, true, "the live camera is released the moment the take stops");
    assert.match(held.state, /with you in it/);

    // The preview sits where ffmpeg will put the real thing, which is the only
    // reason it is worth having.
    const where = await tool.page.evaluate(() => {
      const player = document.getElementById("silentPlayer").getBoundingClientRect();
      const card = document.getElementById("webcamPreview").getBoundingClientRect();
      return {
        fromLeft: (card.left - player.left) / player.width,
        fromBottom: (player.bottom - card.bottom) / player.height,
        width: card.width / player.width,
      };
    });
    assert.ok(Math.abs(where.fromLeft - webcam.PIP.margin / 1920) < 0.01, `${where.fromLeft} of the way across`);
    assert.ok(Math.abs(where.fromBottom - webcam.PIP.margin / 1080) < 0.01, `${where.fromBottom} up from the bottom`);
    assert.ok(Math.abs(where.width - webcam.CARD_WIDTH / 1920) < 0.01, `${where.width} of the width`);

    // And then the only thing that burns anything.
    await tool.page.click("#keepTakeBtn");
    await tool.page.waitForFunction(() => !document.getElementById("step-review").hidden, { timeout: 120000 });

    const summary = await tool.page.$eval("#reviewSummary", (node) => node.textContent);
    assert.match(summary, /you in the bottom-left corner/);
  } finally {
    await tool.close();
  }

  // The file itself, which is the only claim that matters. The fake camera is a
  // rolling colour pattern, so "there is a camera here" is "this is not the flat
  // blue the scenes are", and the house corner still is.
  const burned = await store.getJob(job.id);
  assert.equal(burned.result.webcam.shown, true);

  const dir = store.jobDir(job.id);
  const face = await patch(burned.result.videoFile, 2, FACE_MIDDLE, dir);
  assert.ok(!looksLike(face, SCENE, 40), `the corner is ${describe(face)}, which is the scene and not a camera`);

  const house = await patch(burned.result.videoFile, 2, HOUSE_CORNER, dir);
  assert.ok(looksLike(house, SCENE), `the house button's corner is ${describe(house)}, wanted the scene`);
});

test("with the camera switched off on the server, the record step does not offer it", needsChrome, async () => {
  const { job } = await jobReadyToRecord({ withSilentCut: true });
  const was = config.webcam.allowed;
  config.webcam.allowed = false;
  let tool;
  try {
    tool = await openRecordStep(job.id);
    assert.equal(await tool.page.$eval("#webcamField", (field) => field.hidden), true);
  } finally {
    config.webcam.allowed = was;
    if (tool) await tool.close();
  }
});

test("probeDuration still reads a burned video with a card on it", async () => {
  const dir = await fsp.mkdtemp(path.join(dataDir, "probe-"));
  const take = await takeWithCamera(dir, { speechSeconds: 3 });
  const { video } = await burn(dir, take, { withCamera: true });
  assert.ok((await probeDuration(video.file)) > 1);
});
