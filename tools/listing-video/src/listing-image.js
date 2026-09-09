"use strict";

/**
 * The listing picture, uploaded by hand instead of photographed off the site.
 *
 * Some sites will not be filmed. Scott Rodgers Real Estate answers an automated
 * browser with 403 on every page that holds a listing, and no amount of looking
 * like Chrome changes that - the refusal is the point of the product they are
 * paying for. Before this, that was the end of the road: the failure panel could
 * only offer "paste one listing URL and try again", and the URL 403s too.
 *
 * So the picture can come from a person instead. Bill opens the listing in his
 * own browser, where it loads perfectly, screenshots it, and uploads that. The
 * shot stands in for the one capture would have taken, and everything downstream
 * - the scenes, the School Explorer and Neighborhood Explorer popups, the silent
 * cut, the voice - runs exactly as it always did.
 *
 * Two things this deliberately does NOT do:
 *
 *   It does not read the address off the image. There is no OCR here and no
 *   guessing from the file name. The Explorer is pointed at coordinates, and a
 *   misread house number would film another street's schools and commutes while
 *   looking completely correct. The address is typed in by the person who can
 *   see the listing, or there is no video.
 *
 *   It does not trust the upload's own content type or file extension. A
 *   browser will say whatever it likes and multer passes it straight through, so
 *   the bytes are sniffed and anything that is not really a PNG or a JPEG is
 *   refused before ffmpeg is asked to open it.
 */

const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");
const { run } = require("./exec");

/** The frame is 1920x1080, so that is what a background has to end up as. */
const FRAME_WIDTH = 1920;
const FRAME_HEIGHT = 1080;

/*
 * The pad colour is #stage's own background in views/frame.html.
 *
 * A screenshot that is not 16:9 has to be padded to fill the frame, and padding
 * it in the stage's own grey makes the letterboxing read as the page's own
 * margin rather than as black bars.
 */
const PAD_COLOR = "0xf2f4f6";

/* Well beyond a full-page screenshot of a listing, and short of a decompression bomb. */
const MAX_SOURCE_PIXELS = 80 * 1000 * 1000;
const MIN_SOURCE_EDGE = 320;

function imageError(code, message) {
  const error = new Error(message);
  error.code = code;
  // Fixable by the person looking at the screen, so the panel offers another go
  // rather than sending them back to the form.
  error.isCaptureRefusal = true;
  return error;
}

/**
 * What these bytes actually are.
 *
 * PNG's eight-byte signature and JPEG's SOI marker. Anything else is refused,
 * whatever the upload claimed to be.
 */
function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return "";
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  return "";
}

/** The file's own idea of how big it is, read with ffprobe rather than guessed. */
async function readSize(file) {
  const { stdout } = await run(
    config.ffprobePath,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0:s=x",
      file,
    ],
    { timeout: 20000 }
  );
  const [width, height] = String(stdout).trim().split("x").map((value) => Number.parseInt(value, 10));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw imageError("LISTING_IMAGE_UNREADABLE", "That image could not be opened. Save it again as a PNG or JPG and upload it.");
  }
  return { width, height };
}

/** Even numbers only: an odd dimension is not encodable as yuv420p. */
const even = (value) => Math.max(2, Math.round(value / 2) * 2);

/**
 * How the upload sits in the 1920x1080 frame.
 *
 * Contained, never cropped: the whole of what was uploaded is visible, scaled to
 * fit and padded to fill. Cropping to fill would look tidier on a hero photo and
 * would be wrong on a screenshot - the address is usually near one edge, and
 * cutting it off would take the one thing the video is about out of the picture.
 *
 * A screenshot of a browser window is already about 16:9, so the common case
 * scales to exactly 1920x1080 and is padded by nothing at all.
 */
function fitInFrame({ width, height }) {
  const scale = Math.min(FRAME_WIDTH / width, FRAME_HEIGHT / height);
  const drawWidth = Math.min(FRAME_WIDTH, even(width * scale));
  const drawHeight = Math.min(FRAME_HEIGHT, even(height * scale));
  return {
    drawWidth,
    drawHeight,
    padX: Math.round((FRAME_WIDTH - drawWidth) / 2),
    padY: Math.round((FRAME_HEIGHT - drawHeight) / 2),
    padded: drawWidth < FRAME_WIDTH || drawHeight < FRAME_HEIGHT,
  };
}

/**
 * Turn an upload into the background the renderer expects.
 *
 * Comes out as a PNG the exact size of the frame, so views/frame.html draws it
 * the same way it draws a real capture and nothing downstream has to know where
 * the picture came from.
 */
async function prepareListingImage({ sourcePath, outDir, log = () => {} }) {
  let buffer;
  try {
    buffer = await fsp.readFile(sourcePath);
  } catch (_) {
    throw imageError("LISTING_IMAGE_MISSING", "That upload is no longer on the server. Upload the screenshot again.");
  }

  const type = sniffImageType(buffer);
  if (!type) {
    throw imageError(
      "LISTING_IMAGE_NOT_AN_IMAGE",
      "That file is not a PNG or a JPG. Screenshot the listing page in your browser and upload that - a PDF, a HEIC or a screen recording will not do."
    );
  }

  const source = await readSize(sourcePath);
  if (source.width * source.height > MAX_SOURCE_PIXELS) {
    throw imageError(
      "LISTING_IMAGE_TOO_BIG",
      `That image is ${source.width} by ${source.height}, which is too large to render. Screenshot the visible page rather than the whole scrolled page.`
    );
  }
  if (source.width < MIN_SOURCE_EDGE || source.height < MIN_SOURCE_EDGE) {
    throw imageError(
      "LISTING_IMAGE_TOO_SMALL",
      `That image is only ${source.width} by ${source.height}, which would be a blurry video. Upload a screenshot at least ${MIN_SOURCE_EDGE} pixels on both sides.`
    );
  }

  const fit = fitInFrame(source);
  const outFile = path.join(outDir, "site.png");

  await run(
    config.ffmpegPath,
    [
      "-y",
      "-i",
      sourcePath,
      "-vf",
      [
        `scale=${fit.drawWidth}:${fit.drawHeight}:flags=lanczos`,
        `pad=${FRAME_WIDTH}:${FRAME_HEIGHT}:${fit.padX}:${fit.padY}:color=${PAD_COLOR}`,
      ].join(","),
      "-frames:v",
      "1",
      outFile,
    ],
    { timeout: 60000 }
  );

  log(
    `Using the screenshot you uploaded (${source.width}x${source.height} ${type.toUpperCase()})${
      fit.padded ? ", fitted into the 1920x1080 frame" : ""
    }`
  );

  return {
    file: outFile,
    type,
    sourceWidth: source.width,
    sourceHeight: source.height,
    padded: fit.padded,
    bytes: buffer.length,
  };
}

module.exports = {
  prepareListingImage,
  sniffImageType,
  fitInFrame,
  readSize,
  FRAME_WIDTH,
  FRAME_HEIGHT,
  MIN_SOURCE_EDGE,
  MAX_SOURCE_PIXELS,
};
