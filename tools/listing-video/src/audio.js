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
const SEGMENT_GAP_SECONDS = 0.32;
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
 * This is about the audio, not the picture. An AI line is padded out to whatever
 * the template allowed for, and a take is usually stopped a moment after the last
 * word, so a track can carry seconds of nothing on the end. Left there, that dead
 * air can push the finished video past the length of the script.
 *
 * It never makes the video shorter. The picture runs to the silent cut's length
 * whatever the voice does; only a person trimming on the final review shortens it.
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
 * different voices are never spliced together. Scene lengths come from the
 * template, stretched only when a line takes longer to say than the template
 * allowed for.
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
        const wav = path.join(workDir, `voice-${String(index).padStart(3, "0")}.wav`);
        const said = await speakLine({
          engine: engine.id,
          text: beats[index].text,
          outFile: wav,
          workDir,
          voiceId: speaking,
        });
        if (said.cached) reusedLines += 1;
        if (said.billed) billedCharacters += voiceCache.charactersIn(beats[index].text);
        const spoken = await probeDuration(wav);
        // Keep the template's picture timing unless the line simply will not fit.
        const budget = beats[index].seconds - (index === 0 ? LEAD_SILENCE_SECONDS : 0);
        const scene = Math.max(beats[index].seconds, spoken + SEGMENT_GAP_SECONDS + (index === 0 ? LEAD_SILENCE_SECONDS : 0));
        const padding = Math.max(0, scene - spoken - (index === 0 ? LEAD_SILENCE_SECONDS : 0));
        pieces.push(wav);
        if (padding > 0.01) {
          pieces.push(await makeSilence(padding, path.join(workDir, `pad-${String(index).padStart(3, "0")}.wav`)));
        }
        durations.push(scene);
        if (spoken > budget + 0.35) {
          log(`Line ${index + 1} needs ${spoken.toFixed(1)}s but the template allows ${budget.toFixed(1)}s - that scene was stretched`);
        }
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
       * Each line was padded out to the length the template allowed for, so the
       * last one usually ends in silence. Cutting back to the last word keeps
       * that dead air from making the finished video longer than the script.
       *
       * It cannot make the video shorter: the picture runs to the silent cut's
       * length whatever the voice does. Nothing is added after the last word.
       */
      const tightened = await trimTrailingSilence(joined, path.join(workDir, "voice-tight.wav"));
      const finalTrack = await normalizeLoudness(tightened, path.join(workDir, "voice.wav"));
      return {
        audioFile: finalTrack,
        durations,
        totalDuration: await probeDuration(finalTrack),
        voice: {
          mode: "ai",
          engine: engine.id,
          label: heard,
          voiceId: speaking,
          reusedLines,
          billedCharacters,
          scriptCharacters,
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
  availableVoiceEngines,
  buildAiVoiceTrack,
  buildRecordedTrack,
  trimTrailingSilence,
  probeDuration,
};
