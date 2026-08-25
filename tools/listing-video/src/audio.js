"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const config = require("./config");
const { run } = require("./exec");

// Enough lead-in that the first word is never clipped by a player that starts slow.
const LEAD_SILENCE_SECONDS = 0.6;
const SEGMENT_GAP_SECONDS = 0.32;
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

async function speakElevenLabs(text, outFile, workDir) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenLabsVoiceId)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenLabsKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
      }),
    }
  );
  if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}`);
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
  if (config.elevenLabsKey) engines.push({ id: "elevenlabs", label: "ElevenLabs female voice" });
  if (config.openAiKey) engines.push({ id: "openai", label: `OpenAI ${config.openAiVoice} female voice` });
  if (config.piperBin && config.piperVoice && fs.existsSync(config.piperBin) && fs.existsSync(config.piperVoice)) {
    engines.push({ id: "piper", label: "Built-in female voice" });
  }
  return engines;
}

async function speak(engineId, text, outFile, workDir) {
  if (engineId === "elevenlabs") return speakElevenLabs(text, outFile, workDir);
  if (engineId === "openai") return speakOpenAi(text, outFile, workDir);
  if (engineId === "piper") return speakPiper(text, outFile);
  throw new Error(`Unknown voice engine ${engineId}`);
}

/**
 * AI voice: one wav per narration segment, so each scene lasts exactly as long
 * as its line. Returns the finished track plus per-segment scene durations.
 */
async function buildAiVoiceTrack({ segments, workDir, log }) {
  const engines = availableVoiceEngines();
  if (engines.length === 0) {
    throw new Error(
      "The AI voice is not connected on this server. Record or upload an overdub instead, or set up a voice (see tools/listing-video/README.md)."
    );
  }

  let lastError = null;
  for (const engine of engines) {
    try {
      log(`Recording the voice track (${engine.label})`);
      const pieces = [];
      const gap = await makeSilence(SEGMENT_GAP_SECONDS, path.join(workDir, "gap.wav"));
      const lead = await makeSilence(LEAD_SILENCE_SECONDS, path.join(workDir, "lead.wav"));
      const durations = [];

      pieces.push(lead);
      for (let index = 0; index < segments.length; index += 1) {
        const wav = path.join(workDir, `voice-${String(index).padStart(3, "0")}.wav`);
        await speak(engine.id, segments[index].text, wav, workDir);
        const spoken = await probeDuration(wav);
        pieces.push(wav, gap);
        durations.push(spoken + SEGMENT_GAP_SECONDS + (index === 0 ? LEAD_SILENCE_SECONDS : 0));
        if ((index + 1) % 4 === 0 || index === segments.length - 1) {
          log(`Voiced ${index + 1} of ${segments.length} lines`);
        }
      }

      const joined = await concatWavs(pieces, path.join(workDir, "voice-joined.wav"), workDir);
      const finalTrack = await normalizeLoudness(joined, path.join(workDir, "voice.wav"));
      return {
        audioFile: finalTrack,
        durations,
        totalDuration: await probeDuration(finalTrack),
        voice: { mode: "ai", engine: engine.id, label: engine.label },
      };
    } catch (error) {
      lastError = error;
      log(`${engine.label} did not work (${error.message}) - trying the next voice`);
    }
  }
  throw lastError || new Error("No AI voice could be used.");
}

/**
 * Overdub: use Myles' own audio as-is. Scene lengths are spread across the take
 * in proportion to how much of the script each line is.
 */
async function buildOverdubTrack({ segments, uploadPath, workDir, log }) {
  log("Preparing your recording");
  const converted = await toWav(uploadPath, path.join(workDir, "overdub-raw.wav"));
  const trimmed = await trimLeadingSilence(converted, path.join(workDir, "overdub-trimmed.wav"));
  const lead = await makeSilence(LEAD_SILENCE_SECONDS, path.join(workDir, "lead.wav"));
  const tail = await makeSilence(0.5, path.join(workDir, "tail.wav"));
  const joined = await concatWavs([lead, trimmed, tail], path.join(workDir, "overdub-joined.wav"), workDir);
  const finalTrack = await normalizeLoudness(joined, path.join(workDir, "voice.wav"));
  const totalDuration = await probeDuration(finalTrack);

  const weights = segments.map((segment) => Math.max(12, segment.text.length));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const durations = weights.map((weight) => (totalDuration * weight) / weightTotal);

  return {
    audioFile: finalTrack,
    durations,
    totalDuration,
    voice: { mode: "overdub", engine: "overdub", label: "Your recorded voice" },
  };
}

module.exports = {
  LEAD_SILENCE_SECONDS,
  availableVoiceEngines,
  buildAiVoiceTrack,
  buildOverdubTrack,
  probeDuration,
};
