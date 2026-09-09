"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");
const voices = require("./voices");
const voiceCache = require("./voice-cache");
const { run } = require("./exec");

// Enough lead-in that the first word is never clipped by a player that starts slow.
const LEAD_SILENCE_SECONDS = 0.6;

/**
 * The breath between one AI line and the next, and the whole of the gap.
 *
 * On the AI path this is not a minimum, it is the answer: a line is spoken, the
 * dead air is cut off both ends of it, and this much silence goes after it. See
 * buildAiVoiceTrack for why the script's own seconds no longer decide.
 */
const AI_BREATH_SECONDS = 0.32;

/** How long the last picture is held after the last AI word, and no longer. */
const AI_TAIL_SECONDS = 0.4;

/**
 * The shortest an AI scene is allowed to be.
 *
 * Only the last scene can be pushed down here - it is pulled back to wherever
 * the voice stopped - and a picture nobody has time to see is not a scene.
 */
const AI_LEAST_SCENE_SECONDS = 0.8;

const END_SILENCE_THRESHOLD = "-45dB";
const SAMPLE_RATE = 44100;

async function probeDuration(file) {
  const { stdout } = await run(config.ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    file,
  ]);
  const seconds = Number(String(stdout).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Could not read the length of ${path.basename(file)}`);
  return seconds;
}

async function makeSilence(seconds, outFile) {
  await run(config.ffmpegPath, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=${SAMPLE_RATE}:cl=mono`,
    "-t",
    String(seconds),
    "-c:a",
    "pcm_s16le",
    outFile,
  ]);
  return outFile;
}

async function toWav(inputFile, outFile) {
  await run(config.ffmpegPath, [
    "-y",
    "-i",
    inputFile,
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(SAMPLE_RATE),
    "-c:a",
    "pcm_s16le",
    outFile,
  ]);
  return outFile;
}

/**
 * Cut the silence off the end of a voice track.
 *
 * A take is usually stopped a moment after the last word, and an AI track ends
 * on the breath that was put after the last line, so either can carry dead air
 * on the end. Left there it would drag the picture out behind it.
 *
 * On the overdub path this is about the audio and not the picture: the picture
 * still runs to the silent cut's length whatever the voice does, and only a
 * person trimming on the final review shortens it. On the AI path the picture
 * follows the voice, so cutting this silence is what stops the video ending on
 * a held still - see buildAiVoiceTrack.
 *
 * Reversing the audio turns "trailing silence" into "leading silence", which
 * ffmpeg can already remove, and reversing it back leaves it on the last word.
 */
async function trimTrailingSilence(inputFile, outFile) {
  try {
    await run(config.ffmpegPath, [
      "-y",
      "-i",
      inputFile,
      "-af",
      `areverse,silenceremove=start_periods=1:start_duration=0.15:start_threshold=${END_SILENCE_THRESHOLD}:detection=peak,areverse`,
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-c:a",
      "pcm_s16le",
      outFile,
    ]);
  } catch (_) {
    await fsp.copyFile(inputFile, outFile);
    return outFile;
  }
  const duration = await probeDuration(outFile).catch(() => 0);
  if (duration > 0.4) return outFile;
  // It ate the whole thing; keep what we had.
  await fsp.copyFile(inputFile, outFile);
  return outFile;
}

/**
 * Trim dead air from the front of a recording, then put a known 0.6s of silence
 * back. Overdubs recorded in a browser often start with several seconds of room
 * tone before the first word.
 */
async function trimLeadingSilence(inputFile, outFile) {
  await run(config.ffmpegPath, [
    "-y",
    "-i",
    inputFile,
    "-af",
    "silenceremove=start_periods=1:start_duration=0.08:start_threshold=-45dB:detection=peak",
    "-ac",
    "1",
    "-ar",
    String(SAMPLE_RATE),
    "-c:a",
    "pcm_s16le",
    outFile,
  ]);
  const duration = await probeDuration(outFile).catch(() => 0);
  if (duration > 0.4) return outFile;
  // Silence removal ate the whole take; keep the original instead.
  await fsp.copyFile(inputFile, outFile);
  return outFile;
}

/**
 * Cut the dead air off both ends of one spoken line.
 *
 * A hosted voice does not hand back only the words. It puts a moment of nothing
 * in front of the first one and leaves another after the last, and on a nine
 * line script that is most of a second of silence at every join even before
 * anything is padded on. Bill heard those joins as the video stopping and
 * starting, so each line is cut back to its own words here and the gap between
 * lines becomes exactly the breath the track puts there on purpose.
 *
 * A line that is nearly all quiet - a short word, or a voice that trails away -
 * can be eaten by the filter, so what came back is checked and the original is
 * kept if it looks like the words went with the silence.
 */
async function tightenLine(inputFile, outFile) {
  const before = await probeDuration(inputFile).catch(() => 0);
  const keepOriginal = async () => {
    await fsp.copyFile(inputFile, outFile);
    return { file: outFile, seconds: before };
  };

  const cut = `silenceremove=start_periods=1:start_duration=0.05:start_threshold=${END_SILENCE_THRESHOLD}:detection=peak`;
  try {
    await run(config.ffmpegPath, [
      "-y",
      "-i",
      inputFile,
      "-af",
      `${cut},areverse,${cut},areverse`,
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-c:a",
      "pcm_s16le",
      outFile,
    ]);
  } catch (_) {
    return keepOriginal();
  }

  const after = await probeDuration(outFile).catch(() => 0);
  if (after < 0.25) return keepOriginal();
  if (before > 0 && after < before * 0.4) return keepOriginal();
  return { file: outFile, seconds: after };
}

async function concatWavs(files, outFile, workDir) {
  const listFile = path.join(workDir, `concat-${path.basename(outFile)}.txt`);
  await fsp.writeFile(listFile, files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  await run(config.ffmpegPath, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-c:a",
    "pcm_s16le",
    "-ar",
    String(SAMPLE_RATE),
    "-ac",
    "1",
    outFile,
  ]);
  return outFile;
}

async function normalizeLoudness(inputFile, outFile) {
  try {
    await run(config.ffmpegPath, [
      "-y",
      "-i",
      inputFile,
      "-af",
      "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      outFile,
    ]);
    return outFile;
  } catch (_) {
    await fsp.copyFile(inputFile, outFile);
    return outFile;
  }
}

/* ------------------------------------------------------------------ */
/* AI voice providers - one professional female English voice          */
/* ------------------------------------------------------------------ */

/*
 * What the voice sounds like. Named, because the cache key has to carry them:
 * change either and every kept line has to be spoken again.
 */
const ELEVEN_MODEL = "eleven_multilingual_v2";
const ELEVEN_SETTINGS = { stability: 0.45, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true };

async function speakElevenLabs(text, outFile, workDir, voiceId) {
  const voice = String(voiceId || config.elevenLabsVoiceId);
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenLabsKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVEN_MODEL,
        voice_settings: ELEVEN_SETTINGS,
      }),
    }
  );
  if (!response.ok) {
    /*
     * A voice this plan cannot use is dropped from the picker rather than tried
     * again. On a free plan that is what a Voice Library voice answers, and it
     * would otherwise fail on every job for ever.
     */
    if (voices.statusMeansNoAccess(response.status)) {
      voices.blockVoice(voice);
      throw new Error(`That ElevenLabs voice is not available on this account (${response.status})`);
    }
    throw new Error(`ElevenLabs returned ${response.status}`);
  }
  const mp3 = path.join(workDir, `${path.basename(outFile, ".wav")}.mp3`);
  await fsp.writeFile(mp3, Buffer.from(await response.arrayBuffer()));
  return toWav(mp3, outFile);
}

async function speakOpenAi(text, outFile, workDir) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openAiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: config.openAiVoice, input: text, response_format: "mp3" }),
  });
  if (!response.ok) throw new Error(`OpenAI TTS returned ${response.status}`);
  const mp3 = path.join(workDir, `${path.basename(outFile, ".wav")}.mp3`);
  await fsp.writeFile(mp3, Buffer.from(await response.arrayBuffer()));
  return toWav(mp3, outFile);
}

async function speakPiper(text, outFile) {
  await run(config.piperBin, ["-m", config.piperVoice, "-f", outFile], { input: text, timeout: 120000 });
  return outFile;
}

function availableVoiceEngines() {
  const engines = [];
  if (config.elevenLabsKey) engines.push({ id: "elevenlabs", label: "ElevenLabs" });
  if (config.openAiKey) engines.push({ id: "openai", label: `OpenAI ${config.openAiVoice} female voice` });
  if (config.piperBin && config.piperVoice && fs.existsSync(config.piperBin) && fs.existsSync(config.piperVoice)) {
    engines.push({ id: "piper", label: "Built-in female voice" });
  }
  return engines;
}

async function speak(engineId, text, outFile, workDir, voiceId) {
  if (engineId === "elevenlabs") return speakElevenLabs(text, outFile, workDir, voiceId);
  if (engineId === "openai") return speakOpenAi(text, outFile, workDir);
  if (engineId === "piper") return speakPiper(text, outFile);
  throw new Error(`Unknown voice engine ${engineId}`);
}

/**
 * Say a line, or fetch it from the last time it was said.
 *
 * Only the words that carry the customer's name and company differ between jobs;
 * everything else in a script is the same for everybody, and used to be paid for
 * again every time. A line already spoken in this voice is read off the disk.
 *
 * Returns what happened, so the job log can say how much was actually billed.
 */
async function speakLine({ engine, text, outFile, workDir, voiceId }) {
  if (!voiceCache.canCache(engine)) {
    await speak(engine, text, outFile, workDir, voiceId);
    return { billed: false, cached: false };
  }

  const key = voiceCache.keyFor({
    engine,
    voiceId,
    text,
    model: ELEVEN_MODEL,
    settings: ELEVEN_SETTINGS,
  });

  const kept = voiceCache.find(key);
  if (kept) {
    await fsp.copyFile(kept, outFile);
    return { billed: false, cached: true };
  }

  await speak(engine, text, outFile, workDir, voiceId);
  await voiceCache.keep(key, outFile);
  return { billed: true, cached: false };
}

/**
 * AI voice: one wav per beat, using a single engine for the whole script so two
 * different voices are never spliced together.
 *
 * THE PICTURE FOLLOWS THE VOICE.
 *
 * Each scene is as long as the line spoken over it plus a breath, and that is
 * the whole of it. The script's own `seconds` decide nothing here.
 *
 * They used to. A line was laid into a window the script had sized, and every
 * second the voice did not use was left on screen as silence. Bill watched a
 * 64 second video of a script whose speech came to about forty: three seconds of
 * nothing after the first line, two and a half after the fourth, four and a half
 * sitting on the last frame at the end. Nothing was broken - the windows were
 * being honoured exactly - but the video sounded like it kept stopping.
 *
 * A hand-written duration is a guess at how long a line takes to say. Once the
 * line has actually been said there is no need to guess: the file is on disk and
 * it can be measured. So it is, and the scene is cut to it.
 *
 * The overdub path is the other way round and stays that way. There the script's
 * seconds are a person's cue - they are watching the silent cut and reading
 * along, and a window that closes early takes the words with it - so the silent
 * cut's timing is left exactly alone. See buildRecordedTrack.
 */
async function buildAiVoiceTrack({ beats, workDir, log, voiceId = "" }) {
  const engines = availableVoiceEngines();
  if (engines.length === 0) {
    throw new Error(
      "The AI voice is not connected on this server. Record your own voice over the silent video instead, or set up a voice (see tools/listing-video/README.md)."
    );
  }

  let lastError = null;
  for (const engine of engines) {
    try {
      // Only ElevenLabs takes a voice id; the other engines have their own.
      const speaking = engine.id === "elevenlabs" ? await voices.resolveVoiceId(voiceId) : "";
      const heard = engine.id === "elevenlabs" ? `${engine.label}, ${await voices.labelFor(speaking)}` : engine.label;
      log(`Building the AI voice track (${heard})`);
      const pieces = [];
      const lead = await makeSilence(LEAD_SILENCE_SECONDS, path.join(workDir, "lead.wav"));
      const durations = [];
      /* What this job actually cost, as against what the whole script would have. */
      let reusedLines = 0;
      let billedCharacters = 0;
      const scriptCharacters = beats.reduce((sum, beat) => sum + voiceCache.charactersIn(beat.text), 0);

      pieces.push(lead);
      for (let index = 0; index < beats.length; index += 1) {
        const tag = String(index).padStart(3, "0");
        const wav = path.join(workDir, `voice-${tag}.wav`);
        const said = await speakLine({
          engine: engine.id,
          text: beats[index].text,
          outFile: wav,
          workDir,
          voiceId: speaking,
        });
        if (said.cached) reusedLines += 1;
        if (said.billed) billedCharacters += voiceCache.charactersIn(beats[index].text);

        /*
         * The words on their own, then a known breath after them. Both ends of
         * the line are cut back first, so the gap a viewer hears is this breath
         * and not this breath plus whatever silence the voice happened to send.
         */
        const line = await tightenLine(wav, path.join(workDir, `line-${tag}.wav`));
        const scene = line.seconds + AI_BREATH_SECONDS + (index === 0 ? LEAD_SILENCE_SECONDS : 0);
        pieces.push(line.file);
        pieces.push(await makeSilence(AI_BREATH_SECONDS, path.join(workDir, `gap-${tag}.wav`)));
        durations.push(scene);

        if ((index + 1) % 4 === 0 || index === beats.length - 1) {
          log(`Voiced ${index + 1} of ${beats.length} lines`);
        }
      }

      if (voiceCache.canCache(engine.id)) {
        if (reusedLines) {
          log(
            `Reused ${reusedLines} of ${beats.length} lines already spoken in this voice - ` +
              `built ${beats.length - reusedLines} (the personalised ones)`
          );
        } else {
          log(`Built all ${beats.length} lines in this voice - one time, then they are reused`);
        }
        log(
          `Billed ${billedCharacters.toLocaleString()} characters of the script's ` +
            `${scriptCharacters.toLocaleString()}`
        );
      }

      const joined = await concatWavs(pieces, path.join(workDir, "voice-joined.wav"), workDir);
      /*
       * The breath that went after the last line has nothing following it, so it
       * is not a breath, it is the video ending on silence. Off it comes.
       */
      const tightened = await trimTrailingSilence(joined, path.join(workDir, "voice-tight.wav"));
      const finalTrack = await normalizeLoudness(tightened, path.join(workDir, "voice.wav"));
      const spokenTotal = await probeDuration(finalTrack);

      /*
       * Land the last scene on the last word.
       *
       * Everything above adds up to what was going into the track; the trim
       * above then took the tail off it, and loudnorm can move the length by a
       * frame either way. Rather than assume, the finished track is measured and
       * the last scene is brought to wherever that leaves it, plus a beat to let
       * the last word sit. That beat is AI_TAIL_SECONDS, not four seconds of a
       * still frame.
       */
      const held = durations.reduce((sum, value) => sum + value, 0);
      const last = durations.length - 1;
      durations[last] = Math.max(
        AI_LEAST_SCENE_SECONDS,
        Math.round((durations[last] + (spokenTotal + AI_TAIL_SECONDS - held)) * 1000) / 1000
      );

      const scriptTotal = beats.reduce((sum, beat) => sum + (Number(beat.seconds) || 0), 0);
      const pictureTotal = durations.reduce((sum, value) => sum + value, 0);
      log(
        `The voice runs ${spokenTotal.toFixed(1)}s. The picture follows it, so this cut is ` +
          `${pictureTotal.toFixed(1)}s rather than the script's ${scriptTotal.toFixed(1)}s - ` +
          `the difference was silence between the lines.`
      );

      return {
        audioFile: finalTrack,
        durations,
        totalDuration: spokenTotal,
        voice: {
          mode: "ai",
          engine: engine.id,
          label: heard,
          voiceId: speaking,
          reusedLines,
          billedCharacters,
          scriptCharacters,
          // The picture was cut to the voice rather than to the script, so the
          // review step can say so instead of the length looking like a fault.
          followsSpeech: true,
          scriptSeconds: Math.round(scriptTotal * 10) / 10,
        },
      };
    } catch (error) {
      lastError = error;
      log(`${engine.label} did not work (${error.message}) - trying the next voice`);
    }
  }
  throw lastError || new Error("No AI voice could be used.");
}

/**
 * A take recorded while watching the silent video, so it is already in time
 * with the picture and nothing is re-stretched. Dead air is trimmed off the
 * front and a known 0.6s of silence is put back, so the first word is never
 * clipped by a player that starts slow.
 */
async function buildRecordedTrack({ uploadPath, workDir, log }) {
  log("Preparing your recording");
  let converted;
  try {
    converted = await toWav(uploadPath, path.join(workDir, "take-raw.wav"));
  } catch (error) {
    // ffmpeg's own words are no use to Myles here, so keep them in the log.
    console.error(`Could not read the uploaded audio: ${error.message}`);
    throw new Error(
      "That audio could not be read. It may be empty, or not really an audio file. Record the take again, or upload an mp3, wav, m4a or webm."
    );
  }
  const trimmed = await trimLeadingSilence(converted, path.join(workDir, "take-trimmed.wav"));
  /*
   * Room tone left running after the last word goes too, so a take that was
   * stopped late does not make the finished video longer than the script. It
   * cannot make it shorter - the picture runs to the silent cut's length - and
   * nothing is added after the last word.
   */
  const tightened = await trimTrailingSilence(trimmed, path.join(workDir, "take-tight.wav"));
  const lead = await makeSilence(LEAD_SILENCE_SECONDS, path.join(workDir, "lead.wav"));
  const joined = await concatWavs([lead, tightened], path.join(workDir, "take-joined.wav"), workDir);
  const finalTrack = await normalizeLoudness(joined, path.join(workDir, "voice.wav"));

  return {
    audioFile: finalTrack,
    totalDuration: await probeDuration(finalTrack),
    voice: { mode: "recorded", engine: "recorded", label: "Your recorded voice" },
  };
}

module.exports = {
  LEAD_SILENCE_SECONDS,
  AI_BREATH_SECONDS,
  AI_TAIL_SECONDS,
  availableVoiceEngines,
  buildAiVoiceTrack,
  buildRecordedTrack,
  tightenLine,
  trimTrailingSilence,
  probeDuration,
};
