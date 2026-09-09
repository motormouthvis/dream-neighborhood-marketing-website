"use strict";

/*
 * The suggested seconds on a script beat.
 *
 * Writing a beat used to mean guessing how long its words take to say, and the
 * number stayed where it was put while the words underneath it changed. This is
 * the arithmetic that now follows the text as it is typed.
 *
 * The file under test is the one the browser loads. There is no second copy of
 * the formula in Node to drift away from it - see public/js/beat-timing.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const timing = require("../public/js/beat-timing.js");
const { DEFAULT_TEMPLATES } = require("../src/default-templates");
const { MIN_BEAT_SECONDS, MAX_BEAT_SECONDS } = require("../src/templates");

/** A line of exactly this many characters. */
const line = (count) => "x".repeat(count);

test("the duration is the lead-in plus the words at a speaking pace", () => {
  // 16 characters a second is about 160 words a minute, and 1.5s covers the
  // breath at each end and the moment it takes to read a new picture.
  assert.equal(timing.CHARACTERS_PER_SECOND, 16);
  assert.equal(timing.LEAD_IN_SECONDS, 1.5);

  assert.equal(timing.suggestSeconds(line(16)), 2.5);
  assert.equal(timing.suggestSeconds(line(160)), 11.5);
  assert.equal(timing.suggestSeconds(line(320)), 21.5);
});

test("a longer line is always suggested a longer beat", () => {
  let last = 0;
  for (let length = 0; length <= 600; length += 7) {
    const seconds = timing.suggestSeconds(line(length));
    assert.ok(seconds >= last, `${length} characters went backwards: ${seconds} after ${last}`);
    last = seconds;
  }
});

test("the number is one somebody can read, and one the save will accept", () => {
  for (const length of [0, 1, 7, 33, 100, 999, 5000]) {
    const seconds = timing.suggestSeconds(line(length));
    assert.equal(seconds, Math.round(seconds * 10) / 10, `${length} characters gave ${seconds}`);
    assert.ok(seconds >= MIN_BEAT_SECONDS, `${seconds} is below what a script may hold`);
    assert.ok(seconds <= MAX_BEAT_SECONDS, `${seconds} is above what a script may hold`);
  }
});

test("a beat with no words gets a picture's worth of time, not none", () => {
  // Reading speed says nothing about a beat with nothing to read.
  assert.equal(timing.suggestSeconds(""), timing.LEAST_SECONDS);
  assert.equal(timing.suggestSeconds("   \n  "), timing.LEAST_SECONDS);
  assert.equal(timing.suggestSeconds(null), timing.LEAST_SECONDS);
  assert.equal(timing.suggestSeconds(undefined), timing.LEAST_SECONDS);
  assert.ok(timing.LEAST_SECONDS > 1, "a picture nobody speaks over still has to be seen");
});

test("and writing the first few words never makes the beat shorter", () => {
  // Without a floor under the spoken figure, an empty beat was suggested 2.5s
  // and typing one short word took it to 1.9 - so starting to write shortened
  // the picture, which is the opposite of what anybody expects.
  assert.ok(timing.suggestSeconds("Look.") >= timing.suggestSeconds(""));
});

test("surrounding whitespace is not something anybody says", () => {
  assert.equal(timing.suggestSeconds("  a line  "), timing.suggestSeconds("a line"));
});

/*
 * The constants are fitted to the shipped scripts rather than taken from a
 * table, so this is what says they still are. Those beats were timed by hand
 * against the approved reference video.
 *
 * Listing beats only. The Explorer beats were deliberately written short - the
 * picture is a still and the voice is what decides how long it stays up - so
 * they are not evidence about reading speed. See public/js/beat-timing.js.
 */
test("it reproduces the hand-timed durations of the shipped listing beats", () => {
  const off = [];
  for (const template of DEFAULT_TEMPLATES) {
    for (const beat of template.beats) {
      if (beat.scene !== "listing") continue;
      const gap = Math.abs(timing.suggestSeconds(beat.text) - beat.seconds);
      off.push({ gap, seconds: beat.seconds, characters: beat.text.length, template: template.id });
    }
  }

  assert.ok(off.length >= 10, `expected the shipped listing beats to be there, found ${off.length}`);
  const worst = off.sort((a, b) => b.gap - a.gap)[0];
  assert.ok(worst.gap <= 3, `${worst.characters} characters was timed at ${worst.seconds}s: ${JSON.stringify(worst)}`);

  const median = off.map((one) => one.gap).sort((a, b) => a - b)[Math.floor(off.length / 2)];
  assert.ok(median <= 1, `half the shipped listing beats should be within a second, median was ${median}`);
});

/*
 * isSuggested is how the editor tells "nobody has touched this" from "somebody
 * typed a number", which is what decides whether the box keeps following the
 * words. It has to survive the value going through an input box and back.
 */
test("a duration is recognised as the suggested one, or as somebody's own", () => {
  assert.equal(timing.isSuggested(timing.suggestSeconds("a line of words"), "a line of words"), true);
  assert.equal(timing.isSuggested(String(timing.suggestSeconds("a line")), "a line"), true, "as a string too");
  assert.equal(timing.isSuggested(9.5, "a line of words"), false);
  assert.equal(timing.isSuggested(timing.LEAST_SECONDS, ""), true);

  // A beat whose words changed under a following duration is no longer at it,
  // which is exactly the state the editor is about to correct.
  assert.equal(timing.isSuggested(timing.suggestSeconds("short"), "a very much longer line than that"), false);
});
