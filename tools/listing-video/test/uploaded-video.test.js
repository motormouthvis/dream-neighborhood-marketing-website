"use strict";

/*
 * A finished video, uploaded rather than made.
 *
 * Myles already has videos - a screen recording, something off a phone, something
 * cut in another editor - and what he wants from this box is the half of it that
 * has nothing to do with making one: a `/v/{id}` link, a card in the Library, and
 * the same gated send. So an mp4 can be uploaded and hosted as it is.
 *
 * These drive the real server and real ffmpeg. What is under test is that an
 * uploaded video is a job like any other by the time anything else looks at it:
 * the public watch page serves it, the Library lists it, deleting it takes the
 * link down, and the send step is behind the same review. And that no Chrome is
 * opened and nothing is filmed on the way - there is no listing on this path.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-video-upload-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "video-upload-token";

const config = require("../src/config");
const store = require("../src/store");
const { run } = require("../src/exec");
const {
  looksLikeMp4,
  sniffVideoBrand,
  prepareUploadedVideo,
  MAX_UPLOADED_VIDEO_BYTES,
  MAX_UPLOADED_VIDEO_SECONDS,
} = require("../src/uploaded-video");
const app = require("../server");

const TOOL = "/tools/listing-video";

/* ---------------------------------------------------------------- */
/* making test videos                                               */
/* ---------------------------------------------------------------- */

/**
 * A short mp4 standing in for something Myles cut somewhere else.
 *
 * A flat colour with a tone over it, encoded the way an editor or a phone would:
 * H.264 and AAC in an mp4. `-movflags -faststart` is the default, so the index
 * lands at the END of the file - which is the state a video exported for a hard
 * drive is really in, and the one thing this path fixes.
 */
async function makeVideo({
  seconds = 3,
  width = 1280,
  height = 720,
  colour = "0x2f6fae",
  audio = true,
  name = `clip-${Math.random().toString(16).slice(2, 8)}.mp4`,
} = {}) {
  const file = path.join(dataDir, name);
  const args = ["-y", "-f", "lavfi", "-i", `color=c=${colour}:s=${width}x${height}:r=25`];
  if (audio) args.push("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100");
  args.push(
    "-t",
    String(seconds),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    ...(audio ? ["-c:a", "aac", "-b:a", "96k"] : ["-an"]),
    file
  );
  await run(config.ffmpegPath, args, { timeout: 120000 });
  return file;
}

/** Audio only, in the same container - the case a byte check alone lets through. */
async function makeAudioOnlyMp4() {
  const file = path.join(dataDir, `sound-only-${Math.random().toString(16).slice(2, 8)}.m4a`);
  await run(
    config.ffmpegPath,
    ["-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "2", "-c:a", "aac", file],
    { timeout: 60000 }
  );
  return file;
}

async function makeWebm() {
  const file = path.join(dataDir, `clip-${Math.random().toString(16).slice(2, 8)}.webm`);
  await run(
    config.ffmpegPath,
    [
      "-y", "-f", "lavfi", "-i", "color=c=0x2f6fae:s=640x360:r=25",
      "-t", "2", "-c:v", "libvpx-vp9", "-b:v", "200k", "-an", file,
    ],
    { timeout: 180000 }
  );
  return file;
}

/* ---------------------------------------------------------------- */
/* the server, signed in                                            */
/* ---------------------------------------------------------------- */

async function startServer() {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const signin = await fetch(`${origin}${TOOL}/api/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "video-upload-token" }),
  });
  const cookie = signin.headers.getSetCookie()[0].split(";")[0];
  return { origin, cookie, close: () => new Promise((resolve) => server.close(resolve)) };
}

const CUSTOMER = {
  firstName: "Vanessa",
  company: "DOMO Realty",
  customerEmail: "vanessa@example.test",
  fromId: "myles",
};

async function upload(tool, fields, file, contentType = "video/mp4") {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) {
    const bytes = await fsp.readFile(file);
    form.append("video", new Blob([bytes], { type: contentType }), path.basename(file));
  }
  const response = await fetch(`${tool.origin}${TOOL}/api/uploaded-videos`, {
    method: "POST",
    headers: { cookie: tool.cookie },
    body: form,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

/* ---------------------------------------------------------------- */
/* the file itself                                                  */
/* ---------------------------------------------------------------- */

test("an upload is judged on its bytes, not on what it claims to be", async () => {
  const mp4 = await makeVideo({ seconds: 1 });
  const bytes = await fsp.readFile(mp4);

  assert.ok(looksLikeMp4(bytes), `brand was ${JSON.stringify(sniffVideoBrand(bytes))}`);
  // The brand is read out of the ftyp box rather than off the extension.
  assert.equal(bytes.toString("latin1", 4, 8), "ftyp");

  // A browser will label an upload whatever it likes, so the signature decides.
  assert.equal(looksLikeMp4(Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n")), false);
  assert.equal(looksLikeMp4(Buffer.from("<!doctype html><html></html>")), false);
  assert.equal(looksLikeMp4(Buffer.alloc(0)), false);
  assert.equal(looksLikeMp4(null), false);
  // A Matroska/WebM header is an mp4's opposite number and is not one.
  assert.equal(looksLikeMp4(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), false);
});

test("a prepared video ends up playable, with its index at the front", async () => {
  const jobDir = await fsp.mkdtemp(path.join(dataDir, "prepared-"));
  const prepared = await prepareUploadedVideo({ sourcePath: await makeVideo({ seconds: 3 }), jobDir });

  assert.equal(prepared.videoFile, path.join(jobDir, "video.mp4"));
  assert.ok(fs.existsSync(prepared.videoFile));
  assert.equal(prepared.durationSeconds, 3);
  assert.deepEqual({ width: prepared.width, height: prepared.height }, { width: 1280, height: 720 });

  // A poster, and from a frame rather than from nothing: the watch page opens on
  // it, and a black rectangle there reads as a broken link.
  assert.ok(fs.existsSync(prepared.posterFile));
  assert.ok(fs.statSync(prepared.posterFile).size > 1000);

  /*
   * The moov atom is at the front. This is the one thing the remux is for: an
   * editor writes it last, and a browser then cannot start playing until the
   * whole file has downloaded.
   */
  const head = (await fsp.readFile(prepared.videoFile)).subarray(0, 4096).toString("latin1");
  const moov = head.indexOf("moov");
  const mdat = head.indexOf("mdat");
  assert.ok(moov > 0, "moov is not in the first 4KB of the file");
  assert.ok(mdat === -1 || moov < mdat, `moov at ${moov}, mdat at ${mdat}`);
});

test("a file that is not an mp4 is refused before it is hosted", async () => {
  const jobDir = await fsp.mkdtemp(path.join(dataDir, "notvideo-"));
  const fake = path.join(jobDir, "video-really.mp4");
  await fsp.writeFile(fake, "This is a PDF really, or a zip, or nothing at all.");

  await assert.rejects(
    () => prepareUploadedVideo({ sourcePath: fake, jobDir }),
    (error) => {
      assert.equal(error.code, "UPLOADED_VIDEO_NOT_MP4");
      assert.match(error.message, /not an mp4/i);
      // And it says what to do rather than only saying no.
      assert.match(error.message, /H\.264/);
      return true;
    }
  );
});

/*
 * An m4a is the same container as an mp4, so the byte check passes it. ffprobe is
 * what catches it, and it has to: a watch page playing a black rectangle with a
 * voice over it is a link somebody would send to a customer.
 */
test("a file with no picture in it is refused, even though the container is right", async () => {
  const jobDir = await fsp.mkdtemp(path.join(dataDir, "audioonly-"));
  const soundOnly = await makeAudioOnlyMp4();
  assert.ok(looksLikeMp4(await fsp.readFile(soundOnly)), "an m4a really is the same container");

  await assert.rejects(
    () => prepareUploadedVideo({ sourcePath: soundOnly, jobDir }),
    (error) => {
      assert.equal(error.code, "UPLOADED_VIDEO_NO_PICTURE");
      assert.match(error.message, /no picture/i);
      return true;
    }
  );
});

test("a video with no sound in it is fine, because plenty of them have none", async () => {
  const jobDir = await fsp.mkdtemp(path.join(dataDir, "silent-"));
  const prepared = await prepareUploadedVideo({ sourcePath: await makeVideo({ seconds: 2, audio: false }), jobDir });
  assert.equal(prepared.durationSeconds, 2);
  assert.ok(fs.existsSync(prepared.videoFile));
});

test("a clip too short to be a video is refused", async () => {
  const jobDir = await fsp.mkdtemp(path.join(dataDir, "tiny-"));
  const blink = await makeVideo({ seconds: 0.2 });
  await assert.rejects(
    () => prepareUploadedVideo({ sourcePath: blink, jobDir }),
    (error) => error.code === "UPLOADED_VIDEO_TOO_SHORT"
  );
});

/*
 * The two numbers the form promises. They are here so that changing one without
 * the README and the hint on the form is a failing test rather than a surprise
 * for whoever hits the limit.
 */
test("the limits are the ones a small dyno can actually take", () => {
  assert.equal(MAX_UPLOADED_VIDEO_BYTES, 120 * 1024 * 1024);
  assert.equal(MAX_UPLOADED_VIDEO_SECONDS, 20 * 60);
});

/* ---------------------------------------------------------------- */
/* the whole way through                                            */
/* ---------------------------------------------------------------- */

test("an uploaded video becomes a ready job with a watch link that plays", async () => {
  const tool = await startServer();
  try {
    const uploaded = await upload(tool, CUSTOMER, await makeVideo({ seconds: 3, colour: "0x2f6fae" }));
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));

    const { id, watchUrl, job } = uploaded.body;
    assert.match(watchUrl, new RegExp(`/v/${id}$`), watchUrl);

    // Ready the moment it answers. There is nothing to capture, no voice to lay
    // on and no scene to draw, so there is nothing to wait for either.
    assert.equal(job.status, "ready");
    assert.equal(job.uploaded, true);
    assert.equal(job.result.durationSeconds, 3);
    assert.equal(job.input.firstName, "Vanessa");
    assert.equal(job.input.company, "DOMO Realty");
    assert.equal(job.input.customerEmail, "vanessa@example.test");
    assert.equal(job.input.fromId, "myles");
    // Said out loud, so a video that was uploaded never reads like one this tool
    // made and nobody goes looking for the listing it was filmed on.
    assert.match(job.result.notes.join(" "), /uploaded, not made here/i);
    assert.equal(job.silent, null, "there is no silent cut to record over");

    // What the file was, so the panel can say it back and nobody has to guess
    // whether the right export went up.
    assert.equal(job.result.uploaded.width, 1280);
    assert.equal(job.result.uploaded.height, 720);
    assert.ok(job.result.uploaded.originalName.endsWith(".mp4"), job.result.uploaded.originalName);
    assert.ok(job.result.uploaded.bytes > 1000);
    // And no path on this box anywhere in what the browser is handed.
    assert.equal(JSON.stringify(job).includes(dataDir), false, "no server file paths in what the browser gets");

    /* ---- the public watch page, which is the whole point ---- */
    const page = await fetch(`${tool.origin}/v/${id}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, new RegExp(`/v/${id}/video.mp4`));
    assert.match(html, /DOMO Realty/);

    const video = await fetch(`${tool.origin}/v/${id}/video.mp4`);
    assert.equal(video.status, 200);
    assert.ok(Number(video.headers.get("content-length")) > 1000);

    const poster = await fetch(`${tool.origin}/v/${id}/poster.jpg`);
    assert.equal(poster.status, 200);

    // No sign-in on any of those three: the customer has a link, not an account.
    assert.equal(page.headers.get("set-cookie"), null);
  } finally {
    await tool.close();
  }
});

test("it shows up in the Library like any other video", async () => {
  const tool = await startServer();
  try {
    const uploaded = await upload(tool, CUSTOMER, await makeVideo({ seconds: 2 }));
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));

    const listed = await fetch(`${tool.origin}${TOOL}/api/videos`, { headers: { cookie: tool.cookie } });
    const { videos } = await listed.json();
    const mine = videos.find((video) => video.id === uploaded.body.id);
    assert.ok(mine, "it is not in the library");

    assert.equal(mine.status, "ready");
    assert.equal(mine.hasVideo, true);
    assert.equal(mine.uploaded, true, "the card has to be able to say it was not made here");
    assert.equal(mine.firstName, "Vanessa");
    assert.equal(mine.durationSeconds, 2);
    assert.match(mine.watchUrl, new RegExp(`/v/${uploaded.body.id}$`));
    // A card asks a job what script it was made from, and "(no script)" there
    // reads like something went wrong.
    assert.equal(mine.templateName, "A video you uploaded");
    assert.equal(mine.error, "");
  } finally {
    await tool.close();
  }
});

/*
 * Sending is the one thing that is not just "like any other video" - it is
 * exactly like any other video, which is the point. Nothing goes to a realtor
 * until somebody has watched it.
 */
test("sending it is behind the same review as everything else", async () => {
  const tool = await startServer();
  try {
    const uploaded = await upload(tool, CUSTOMER, await makeVideo({ seconds: 2 }));
    const { id } = uploaded.body;

    const tooSoon = await fetch(`${tool.origin}${TOOL}/api/jobs/${id}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: tool.cookie },
      body: JSON.stringify({ to: "vanessa@example.test" }),
    });
    assert.equal(tooSoon.status, 409, "an unreviewed video must not be sendable");
    assert.match((await tooSoon.json()).error, /reviewed/i);

    const reviewed = await fetch(`${tool.origin}${TOOL}/api/jobs/${id}/reviewed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: tool.cookie },
      body: JSON.stringify({ how: "confirmed" }),
    });
    assert.equal(reviewed.status, 200);
    assert.equal((await reviewed.json()).review.reviewed, true);

    // The draft is the email that would go, and it must not promise a
    // Neighborhood Explorer upgrade in a video that showed neither product.
    const draft = await fetch(`${tool.origin}${TOOL}/api/jobs/${id}/email-draft`, {
      headers: { cookie: tool.cookie },
    });
    const body = await draft.json();
    assert.match(body.subject, /Vanessa/);
    assert.match(body.text, new RegExp(`/v/${id}`));
    assert.doesNotMatch(body.text, /Neighborhood Explorer/);
  } finally {
    await tool.close();
  }
});

test("deleting it takes the watch link down with it", async () => {
  const tool = await startServer();
  try {
    const uploaded = await upload(tool, CUSTOMER, await makeVideo({ seconds: 2 }));
    const { id } = uploaded.body;
    assert.equal((await fetch(`${tool.origin}/v/${id}`)).status, 200);

    const deleted = await fetch(`${tool.origin}${TOOL}/api/videos/${id}`, {
      method: "DELETE",
      headers: { cookie: tool.cookie },
    });
    assert.equal(deleted.status, 200);

    assert.equal((await fetch(`${tool.origin}/v/${id}`)).status, 404);
    assert.equal((await fetch(`${tool.origin}/v/${id}/video.mp4`)).status, 404);
    assert.equal(fs.existsSync(store.jobDir(id)), false);
  } finally {
    await tool.close();
  }
});

/* ---------------------------------------------------------------- */
/* what it refuses, and what it leaves behind                       */
/* ---------------------------------------------------------------- */

test("a refused file leaves no job in the Library and no file on disk", async () => {
  const tool = await startServer();
  try {
    const before = (await store.listJobs()).length;

    const notAVideo = path.join(dataDir, "deck.mp4");
    await fsp.writeFile(notAVideo, "%PDF-1.7 not really a video at all");
    const refused = await upload(tool, CUSTOMER, notAVideo);

    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /not an mp4/i);
    assert.equal((await store.listJobs()).length, before, "a refused upload must not leave a job behind");

    // Neither the upload nor the folder it was checked in is left lying about.
    const uploads = await fsp.readdir(path.join(dataDir, "uploads")).catch(() => []);
    assert.deepEqual(uploads.filter((name) => name.startsWith("finished-")), []);
  } finally {
    await tool.close();
  }
});

test("a webm is refused, because Safari will not play one", async () => {
  const tool = await startServer();
  try {
    const refused = await upload(tool, CUSTOMER, await makeWebm(), "video/webm");
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /not an mp4/i);
    assert.match(refused.body.error, /webm/i);
  } finally {
    await tool.close();
  }
});

test("the customer fields are required, because the Library and the email need them", async () => {
  const tool = await startServer();
  try {
    const clip = await makeVideo({ seconds: 1 });

    const noName = await upload(tool, { ...CUSTOMER, firstName: "" }, clip);
    assert.equal(noName.status, 400);
    assert.match(noName.body.error, /Customer first name/);

    const badEmail = await upload(tool, { ...CUSTOMER, customerEmail: "not-an-email" }, clip);
    assert.equal(badEmail.status, 400);
    assert.match(badEmail.body.error, /Customer email/);

    const noFile = await upload(tool, CUSTOMER, null);
    assert.equal(noFile.status, 400);
    assert.match(noFile.body.error, /No video came through/i);

    // And none of those left an upload sitting in the uploads directory.
    const uploads = await fsp.readdir(path.join(dataDir, "uploads")).catch(() => []);
    assert.deepEqual(uploads.filter((name) => name.startsWith("finished-")), []);
  } finally {
    await tool.close();
  }
});

test("the upload needs the password, like everything else", async () => {
  const tool = await startServer();
  try {
    const form = new FormData();
    for (const [key, value] of Object.entries(CUSTOMER)) form.append(key, value);
    const response = await fetch(`${tool.origin}${TOOL}/api/uploaded-videos`, { method: "POST", body: form });
    assert.equal(response.status, 401);
  } finally {
    await tool.close();
  }
});

/*
 * The switch, so a box that should only ever build videos can be told to stop
 * accepting them without a deploy. The tab hides itself off the same answer.
 */
test("hosting an uploaded video can be switched off", async () => {
  const tool = await startServer();
  const was = config.uploadedVideos.allowed;
  try {
    config.uploadedVideos.allowed = false;

    const session = await fetch(`${tool.origin}${TOOL}/api/session`, { headers: { cookie: tool.cookie } });
    assert.equal((await session.json()).videoUpload.allowed, false, "the tab reads this to hide itself");

    const refused = await upload(tool, CUSTOMER, await makeVideo({ seconds: 1 }));
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /switched off/i);
  } finally {
    config.uploadedVideos.allowed = was;
    await tool.close();
  }
});

test("the session says the limits, so the form and the refusal agree", async () => {
  const tool = await startServer();
  try {
    const session = await fetch(`${tool.origin}${TOOL}/api/session`, { headers: { cookie: tool.cookie } });
    const { videoUpload } = await session.json();
    assert.equal(videoUpload.allowed, true);
    assert.equal(videoUpload.maxMegabytes, Math.round(MAX_UPLOADED_VIDEO_BYTES / (1024 * 1024)));
    assert.equal(videoUpload.maxMinutes, Math.round(MAX_UPLOADED_VIDEO_SECONDS / 60));
  } finally {
    await tool.close();
  }
});
