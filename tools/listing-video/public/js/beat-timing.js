/*
 * How long a beat should be on screen, worked out from the words in it.
 *
 * A beat carries two things: a picture and a line to say over it. "Suggested
 * seconds" is how long the picture is held. It is a floor rather than a
 * verdict - src/audio.js stretches a beat whose recorded line runs longer - so
 * getting it wrong is not fatal, it is just untidy in both directions. Too
 * short and the picture is stretched to fit the voice, which is where a scene
 * that was meant to be brisk ends up hanging. Too long and the voice finishes
 * and the viewer sits looking at a still.
 *
 * Until now the number was typed in by hand and nothing connected it to the
 * words beside it, so editing a line left the old duration behind.
 *
 * THE FORMULA
 *
 *   seconds = LEAD_IN_SECONDS + characters / CHARACTERS_PER_SECOND
 *
 * CHARACTERS_PER_SECOND is 16, which is about 160 words a minute at the usual
 * six characters per word including the space. That is an ordinary voiceover
 * pace - unhurried, but not slow - and it is what the hosted voices actually
 * read at.
 *
 * LEAD_IN_SECONDS is 1.5 and covers the part that is not reading speed: the
 * breath before the first word, the beat after the last one, and the moment a
 * viewer needs to take in a new picture before any of it means anything.
 *
 * Those two numbers are not invented. They are fitted to the listing beats of
 * the three shipped scripts in src/default-templates.js, which were timed by
 * hand against the approved reference video - so this reproduces durations
 * somebody already watched and accepted, rather than a figure from a table. A
 * 69-character line was timed at 5.7s and this suggests 5.8; a 162-character
 * one was timed at 11 and 12 across two scripts and this suggests 11.6. Across
 * all eleven listing beats it is within half a second of the hand-timed value.
 *
 * It reads LONG against the shipped Explorer beats, by a couple of seconds, and
 * that is the formula being right rather than wrong. Those beats were written
 * as floors and left deliberately short, because the Explorer picture is a
 * still and the voice is what should decide how long it stays up. Somebody
 * writing one of those still wants a number that fits the words; they can hold
 * it shorter, and holding it is one keystroke.
 *
 * LEAST_SECONDS is the floor under all of it. A beat is a picture as well as a
 * line, and a picture nobody has time to look at is not worth cutting to,
 * however few words go over it. It also keeps the suggestion going the way the
 * words do: without a floor, a beat with nothing in it was suggested 2.5s and
 * typing the first short word took it down to 1.9, so writing made the beat
 * shorter. Two and a half seconds is long enough for a picture to register and
 * short enough that a beat left empty by accident still looks wrong.
 *
 * This file is loaded by the browser AND required by Node, on purpose. It is
 * the number the editor puts in the box, so the test that checks the number has
 * to be checking this file and not a second copy of the arithmetic.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.DNBeatTiming = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CHARACTERS_PER_SECOND = 16;
  var LEAD_IN_SECONDS = 1.5;
  var LEAST_SECONDS = 2.5;

  // The same bounds src/templates.js will accept on the way back in, so the
  // editor can never suggest a number the save would then reject.
  var MIN_SECONDS = 0.5;
  var MAX_SECONDS = 120;

  /**
   * What to hold this beat's picture for, given the words said over it.
   *
   * @param {string} text the line to be spoken; empty is a silent beat
   * @returns {number} seconds, to one decimal place
   */
  function suggestSeconds(text) {
    var words = String(text == null ? "" : text).trim();
    var spoken = LEAD_IN_SECONDS + words.length / CHARACTERS_PER_SECOND;
    var rounded = Math.round(Math.max(LEAST_SECONDS, spoken) * 10) / 10;
    return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, rounded));
  }

  /**
   * Whether a duration is the one this would have suggested for that text.
   *
   * The editor uses it to tell "nobody has touched this" from "somebody typed a
   * number", so that typing in the box stops the suggestion overwriting it and
   * clearing the box hands it back. Compared loosely, because the value has been
   * through an input box and back.
   */
  function isSuggested(seconds, text) {
    return Math.abs(Number(seconds) - suggestSeconds(text)) < 0.05;
  }

  return {
    suggestSeconds: suggestSeconds,
    isSuggested: isSuggested,
    CHARACTERS_PER_SECOND: CHARACTERS_PER_SECOND,
    LEAD_IN_SECONDS: LEAD_IN_SECONDS,
    LEAST_SECONDS: LEAST_SECONDS,
  };
});
