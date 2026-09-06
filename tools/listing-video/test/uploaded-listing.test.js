"use strict";

/*
 * The way out of a site that will not be filmed.
 *
 * Bill pasted a Scott Rodgers Real Estate listing and got "blocked the capture
 * on 4 pages (HTTP 403)". The panel offered "paste one listing URL and try
 * again", and that URL 403s as well, so there was nowhere left to go.
 *
 * These drive the real server, real ffmpeg and real Chrome: a job is started
 * from an uploaded screenshot and has to come out as a silent video with the
 * Explorer popups on it, without their site being opened at all. And the journey
 * Bill would actually take - a capture that fails on a 403, then an upload
 * against that same job - has to end with a video.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const test = require("node:test");
const assert = require("node:assert/strict");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnlv-upload-"));
process.env.LISTING_VIDEO_DATA_DIR = dataDir;
process.env.LISTING_VIDEO_TOKEN = "upload-test-token";

const config = require("../src/config");
const store = require("../src/store");
const { run } = require("../src/exec");
const { sniffImageType, fitInFrame, prepareListingImage, readSize } = require("../src/listing-image");
const { addressFromFields, stateCodeFor } = require("../src/geocode");
const fixture = require("./fixture-site");
const app = require("../server");

const TOOL = "/tools/listing-video";
const noChrome = !config.chromePath;
const options = noChrome ? { skip: "no Chrome or Chromium on this machine" } : {};

/* Bill's listing, as he would type it in. */
const ROSEMEAD = {
  addressStreet: "6031 N Rosemead Dr",
  addressCity: "Peoria",
  addressState: "IL",
  addressZip: "61614",
};

/* ---------------------------------------------------------------- */
/* making test screenshots                                          */
/* ---------------------------------------------------------------- */

/**
 * A picture standing in for a screenshot of a listing page, in a colour a test
 * can look for in the finished frame.
 */
async function makeImage({ width = 1024, height = 576, colour = "0x2f6fae", type = "png" } = {}) {
  const file = path.join(dataDir, `shot-${width}x${height}-${Math.random().toString(16).slice(2, 8)}.${type}`);
  await run(
    config.ffmpegPath,
    ["-y", "-f", "lavfi", "-i", `color=c=${colour}:s=${width}x${height}`, "-frames:v", "1", file],
    { timeout: 30000 }
  );
  return file;
}

/** The average colour of a patch of a video's first frame. */
async function frameColour(videoFile, crop) {
  const { stdout } = await run(
    config.ffmpegPath,
    ["-v", "error", "-i", videoFile, "-vf", `crop=${crop},scale=1:1`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer", timeout: 60000 }
  );
  const pixel = Buffer.from(stdout, "binary");
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
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
    body: JSON.stringify({ token: "upload-test-token" }),
  });
  const cookie = signin.headers.getSetCookie()[0].split(";")[0];
  return {
    origin,
    cookie,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function postForm(tool, url, fields, file, contentType = "image/png") {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) {
    const bytes = await fsp.readFile(file);
    form.append("listingImage", new Blob([bytes], { type: contentType }), path.basename(file));
  }
  const response = await fetch(`${tool.origin}${url}`, {
    method: "POST",
    headers: { cookie: tool.cookie },
    body: form,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

/**
 * Wait for a job to stop being worked on.
 *
 * A render of a School-Explorer-only script is Chrome drawing a handful of
 * stills plus one ffmpeg pass, so this is seconds rather than minutes - but it
 * is a real render, so it gets room.
 */
async function settle(tool, id, { timeoutMs = 180000 } = {}) {
  const until = Date.now() + timeoutMs;
  let job = null;
  while (Date.now() < until) {
    const response = await fetch(`${tool.origin}${TOOL}/api/jobs/${id}`, { headers: { cookie: tool.cookie } });
    job = await response.json();
    if (job.status !== "queued" && job.status !== "capturing" && job.status !== "voicing") return job;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`job ${id} never settled; last status ${job && job.status}`);
}

/* The School-Explorer-only script has no Neighborhood Explorer beats, so nothing
 * here needs the live Explorer widget or the geocoder. */
const SE_ONLY = "vanessa-se-only-v11";

const CUSTOMER = {
  templateId: SE_ONLY,
  firstName: "Bill",
  company: "Scott Rodgers Real Estate",
  websiteUrl: "https://www.scottrodgersrealestate.com/",
  customerEmail: "fixture@example.test",
  fromId: "marketing",
};

/* ---------------------------------------------------------------- */
/* the picture itself                                               */
/* ---------------------------------------------------------------- */

test("an upload is judged on its bytes, not on what it claims to be", async () => {
  const png = await makeImage({ type: "png" });
  const jpg = await makeImage({ type: "jpg" });

  assert.equal(sniffImageType(await fsp.readFile(png)), "png");
  assert.equal(sniffImageType(await fsp.readFile(jpg)), "jpeg");

  // A browser will label an upload whatever it likes, so the signature decides.
  assert.equal(sniffImageType(Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n")), "");
  assert.equal(sniffImageType(Buffer.from("<!doctype html><html></html>")), "");
  assert.equal(sniffImageType(Buffer.alloc(0)), "");
  assert.equal(sniffImageType(null), "");
});

test("a screenshot of a browser window fills the frame exactly, with no padding", () => {
  // The common case: 16:9, so it scales to 1920x1080 and nothing is added.
  const fit = fitInFrame({ width: 1024, height: 576 });
  assert.equal(fit.drawWidth, 1920);
  assert.equal(fit.drawHeight, 1080);
  assert.equal(fit.padded, false);
});

test("an odd shape is fitted whole rather than cropped", () => {
  // A tall grab of the whole scrolled page. Cutting it to fill would take the
  // address off the top, which is the one thing the video is about.
  const tall = fitInFrame({ width: 1200, height: 3000 });
  assert.ok(tall.drawHeight <= 1080);
  assert.ok(tall.drawWidth <= 1920);
  assert.equal(tall.padded, true);
  assert.ok(Math.abs(tall.drawWidth / tall.drawHeight - 1200 / 3000) < 0.02, "the shape is kept");

  // A hero photo, wider than tall but not 16:9.
  const photo = fitInFrame({ width: 1600, height: 1200 });
  assert.equal(photo.drawHeight, 1080);
  assert.equal(photo.padded, true);
  assert.ok(Math.abs(photo.drawWidth / photo.drawHeight - 4 / 3) < 0.02);
});

test("whatever is uploaded comes out as a 1920x1080 background", async () => {
  const outDir = await fsp.mkdtemp(path.join(dataDir, "prepared-"));
  for (const shape of [{ width: 1024, height: 576 }, { width: 1600, height: 1200 }, { width: 900, height: 2400 }]) {
    const prepared = await prepareListingImage({ sourcePath: await makeImage(shape), outDir });
    assert.deepEqual(await readSize(prepared.file), { width: 1920, height: 1080 }, `${shape.width}x${shape.height}`);
  }
});

test("a file that is not an image is refused before ffmpeg is asked to open it", async () => {
  const outDir = await fsp.mkdtemp(path.join(dataDir, "notimage-"));
  const fake = path.join(outDir, "listing.png");
  await fsp.writeFile(fake, "This is a PDF really, or a HEIC, or nothing at all.");

  await assert.rejects(
    () => prepareListingImage({ sourcePath: fake, outDir }),
    (error) => {
      assert.equal(error.code, "LISTING_IMAGE_NOT_AN_IMAGE");
      assert.match(error.message, /PNG or a JPG/i);
      return true;
    }
  );
});

test("a screenshot too small to render is refused rather than made blurry", async () => {
  const outDir = await fsp.mkdtemp(path.join(dataDir, "tiny-"));
  const tiny = await makeImage({ width: 200, height: 120 });
  await assert.rejects(
    () => prepareListingImage({ sourcePath: tiny, outDir }),
    (error) => error.code === "LISTING_IMAGE_TOO_SMALL"
  );
});

/* ---------------------------------------------------------------- */
/* the address, which is typed and never read off the picture        */
/* ---------------------------------------------------------------- */

test("the typed address comes out in the shape the geocoder wants", () => {
  const address = addressFromFields({ street: " 6031 N Rosemead Dr ", city: "Peoria", state: "il", zip: "61614" });
  assert.equal(address.street, "6031 N Rosemead Dr");
  assert.equal(address.cityState, "Peoria, IL");
  assert.equal(address.zip, "61614");
  assert.equal(address.source, "typed");
  // Typed in by somebody looking at the listing, so it is what the video is
  // about - the same standing a heading read off the page would have.
  assert.equal(address.isSubject, true);
});

test("a state can be typed either way, and nonsense is refused", () => {
  assert.equal(stateCodeFor("IL"), "IL");
  assert.equal(stateCodeFor("illinois"), "IL");
  assert.equal(stateCodeFor("Illinois"), "IL");
  assert.equal(stateCodeFor("Narnia"), "");
  assert.throws(
    () => addressFromFields({ street: "6031 N Rosemead Dr", city: "Peoria", state: "XX" }),
    /not a US state/
  );
});

test("no street address means no video, because nothing reads it off the picture", () => {
  assert.throws(
    () => addressFromFields({ city: "Peoria", state: "IL", zip: "61614" }),
    (error) => {
      assert.equal(error.code, "ADDRESS_INCOMPLETE");
      assert.equal(error.status, 400);
      assert.match(error.message, /street address/i);
      return true;
    }
  );
});

test("a ZIP that is not a ZIP is refused, and a ZIP+4 is trimmed", () => {
  assert.equal(addressFromFields({ street: "6031 N Rosemead Dr", zip: "61614-1234" }).zip, "61614");
  assert.throws(() => addressFromFields({ street: "6031 N Rosemead Dr", zip: "616" }), /five digit ZIP/);
});

test("a street on its own is allowed, because the geocoder can still place it", () => {
  const address = addressFromFields({ street: "6031 N Rosemead Dr" });
  assert.equal(address.street, "6031 N Rosemead Dr");
  assert.equal(address.cityState, "");
});

/* ---------------------------------------------------------------- */
/* the whole way through                                            */
/* ---------------------------------------------------------------- */

test(
  "a job started from an uploaded screenshot becomes a silent video, with their site never opened",
  options,
  async () => {
    const tool = await startServer();
    /*
     * Their site is running and answering 403 to everything, exactly as Scott
     * Rodgers does. It is here so the test can prove it was never asked.
     */
    const site = await fixture.listen(fixture.DETAIL_URL_SITE_FORBIDDEN);
    try {
      const shot = await makeImage({ width: 1024, height: 576, colour: "0x2f6fae" });
      const started = await postForm(
        tool,
        `${TOOL}/api/jobs`,
        { ...CUSTOMER, websiteUrl: site.origin, ...ROSEMEAD },
        shot
      );
      assert.equal(started.status, 202, JSON.stringify(started.body));

      const job = await settle(tool, started.body.id);
      assert.equal(job.status, "silent-ready", job.error || "");

      // The picture is the upload, and the job says so rather than leaving it to
      // be guessed at from an empty page URL.
      assert.equal(job.silent.uploadedPicture, true);
      assert.equal(job.silent.capturedAddress, "6031 N Rosemead Dr");
      assert.equal(job.silent.capturedPageUrl, "", "no page was filmed, so there is no URL to show");
      assert.match(job.silent.notes.join(" "), /screenshot you uploaded/i);
      assert.match(job.silent.notes.join(" "), /6031 N Rosemead Dr, Peoria, IL, 61614/);

      // Their site was never touched. This is the whole point of the path.
      assert.deepEqual(site.hits, {}, `their site should never be opened, was asked for ${Object.keys(site.hits)}`);

      // And there is a real video, built on the uploaded picture.
      const silent = await fetch(`${tool.origin}${TOOL}/api/jobs/${started.body.id}/silent.mp4`, {
        headers: { cookie: tool.cookie },
      });
      assert.equal(silent.status, 200);
      assert.ok(job.silent.durationSeconds > 0);

      const stored = await store.getJob(started.body.id);
      const colour = await frameColour(stored.silent.file, "600:400:60:500");
      assert.ok(
        colour.b > colour.r + 20,
        `the frame should be built on the blue screenshot, got rgb(${colour.r},${colour.g},${colour.b})`
      );
    } finally {
      await new Promise((resolve) => site.server.close(resolve));
      await tool.close();
    }
  }
);

test(
  "Bill's journey: the capture 403s, he uploads a screenshot, and that job finishes",
  options,
  async () => {
    const tool = await startServer();
    const site = await fixture.listen(fixture.DETAIL_URL_SITE_FORBIDDEN);
    try {
      /* ---- what happened to him ---- */
      const started = await fetch(`${tool.origin}${TOOL}/api/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: tool.cookie },
        body: JSON.stringify({
          ...CUSTOMER,
          websiteUrl: site.origin,
          listingUrl: `${site.origin}${fixture.ROSEMEAD_PATH}?src=4`,
        }),
      });
      assert.equal(started.status, 202);
      const { id } = await started.json();

      const failed = await settle(tool, id);
      assert.equal(failed.status, "failed");
      assert.equal(failed.errorCode, "SITE_BLOCKED");
      assert.equal(failed.retryable, true, "the panel has to offer a way on");
      // The refusal names the upload, because pasting another URL from this site
      // is the one thing already known not to work.
      assert.match(failed.error, /upload a screenshot/i);
      // The job stays in the library with the failure written down.
      assert.equal(failed.failure.httpStatus, 403);

      /* ---- what he can do about it now ---- */
      const uploaded = await postForm(
        tool,
        `${TOOL}/api/jobs/${id}/listing-image`,
        ROSEMEAD,
        await makeImage({ width: 1440, height: 810, colour: "0x2f6fae" })
      );
      assert.equal(uploaded.status, 202, JSON.stringify(uploaded.body));

      const done = await settle(tool, id);
      assert.equal(done.status, "silent-ready", done.error || "");
      assert.equal(done.silent.uploadedPicture, true);
      assert.equal(done.silent.capturedAddress, "6031 N Rosemead Dr");
      // Same job: same script, same customer, same email address.
      assert.equal(done.input.firstName, "Bill");
      assert.equal(done.input.templateId, SE_ONLY);
      assert.equal(done.errorCode, null, "the failure is cleared once it works");

      // The scenes are drawn on the upload, and the School Explorer popup is on
      // top of it - the video is not just the screenshot held for a minute.
      const stored = await store.getJob(id);
      assert.ok(stored.silent.frames.length >= stored.beats.length);
    } finally {
      await new Promise((resolve) => site.server.close(resolve));
      await tool.close();
    }
  }
);

test("a screenshot with no street address is sent back, and no job is started", async () => {
  const tool = await startServer();
  try {
    const before = (await store.listJobs()).length;
    const refused = await postForm(
      tool,
      `${TOOL}/api/jobs`,
      { ...CUSTOMER, addressCity: "Peoria", addressState: "IL", addressZip: "61614" },
      await makeImage()
    );
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /street address/i);
    assert.equal((await store.listJobs()).length, before, "a refused form must not leave a job behind");

    // And the rejected upload is not left sitting in the uploads directory.
    const uploads = await fsp.readdir(path.join(dataDir, "uploads")).catch(() => []);
    assert.deepEqual(uploads.filter((name) => name.startsWith("listing-")), []);
  } finally {
    await tool.close();
  }
});

test("a file that is not a PNG or JPG is refused on the way in", async () => {
  const tool = await startServer();
  try {
    const notAnImage = path.join(dataDir, "listing.pdf");
    await fsp.writeFile(notAnImage, "%PDF-1.7 not really");
    const refused = await postForm(
      tool,
      `${TOOL}/api/jobs`,
      { ...CUSTOMER, ...ROSEMEAD },
      notAnImage,
      "application/pdf"
    );
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /PNG or JPG/i);
  } finally {
    await tool.close();
  }
});

test("uploading to a job that is gone is a 404, not a crash", async () => {
  const tool = await startServer();
  try {
    const missing = await postForm(
      tool,
      `${TOOL}/api/jobs/bd7620f10ca57c5459/listing-image`,
      ROSEMEAD,
      await makeImage()
    );
    assert.equal(missing.status, 404);
  } finally {
    await tool.close();
  }
});

test("the upload needs the password, like everything else", async () => {
  const tool = await startServer();
  try {
    const form = new FormData();
    for (const [key, value] of Object.entries(ROSEMEAD)) form.append(key, value);
    const response = await fetch(`${tool.origin}${TOOL}/api/jobs/abcdef123456/listing-image`, {
      method: "POST",
      body: form,
    });
    assert.equal(response.status, 401);
  } finally {
    await tool.close();
  }
});

test("retrying with a listing URL drops the uploaded screenshot", options, async () => {
  const tool = await startServer();
  const site = await fixture.listen(fixture.DETAIL_URL_SITE);
  try {
    const started = await postForm(
      tool,
      `${TOOL}/api/jobs`,
      { ...CUSTOMER, websiteUrl: site.origin, ...ROSEMEAD },
      await makeImage()
    );
    assert.equal(started.status, 202);
    const { id } = started.body;
    await settle(tool, id);

    const uploadPath = (await store.getJob(id)).input.uploadedListing.file;
    assert.ok(fs.existsSync(uploadPath));

    /*
     * A retry with a URL means going back to the live site. Leaving the upload
     * in place would make it win silently, so the pasted URL would look ignored.
     */
    const again = await fetch(`${tool.origin}${TOOL}/api/jobs/${id}/recapture`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: tool.cookie },
      body: JSON.stringify({ listingUrl: `${site.origin}${fixture.ROSEMEAD_PATH}` }),
    });
    assert.equal(again.status, 202);

    const job = await settle(tool, id);
    assert.equal(job.status, "silent-ready", job.error || "");
    assert.equal(job.silent.uploadedPicture, false, "this one was filmed off their site");
    assert.equal(job.input.uploadedListing, null);
    assert.equal(new URL(job.silent.capturedPageUrl).pathname, fixture.ROSEMEAD_PATH);
    assert.equal(fs.existsSync(uploadPath), false, "the replaced screenshot is not left on disk");
  } finally {
    await new Promise((resolve) => site.server.close(resolve));
    await tool.close();
  }
});

test("deleting a job takes the uploaded screenshot with it", options, async () => {
  const tool = await startServer();
  try {
    const started = await postForm(tool, `${TOOL}/api/jobs`, { ...CUSTOMER, ...ROSEMEAD }, await makeImage());
    assert.equal(started.status, 202);
    await settle(tool, started.body.id);

    const uploadPath = (await store.getJob(started.body.id)).input.uploadedListing.file;
    assert.ok(fs.existsSync(uploadPath));

    const deleted = await fetch(`${tool.origin}${TOOL}/api/videos/${started.body.id}`, {
      method: "DELETE",
      headers: { cookie: tool.cookie },
    });
    assert.equal(deleted.status, 200);
    assert.equal(fs.existsSync(uploadPath), false);
  } finally {
    await tool.close();
  }
});

test("what the browser is told about an upload carries no server paths", options, async () => {
  const tool = await startServer();
  try {
    const started = await postForm(tool, `${TOOL}/api/jobs`, { ...CUSTOMER, ...ROSEMEAD }, await makeImage());
    await settle(tool, started.body.id);

    const job = await store.getJob(started.body.id);
    const view = store.publicView(job);
    assert.equal(JSON.stringify(view).includes(dataDir), false, "no server file paths in what the browser gets");
    // It still says what was uploaded and which address came with it.
    assert.ok(view.input.uploadedListing.originalName);
    assert.equal(view.input.uploadedListing.address.street, "6031 N Rosemead Dr");
  } finally {
    await tool.close();
  }
});
