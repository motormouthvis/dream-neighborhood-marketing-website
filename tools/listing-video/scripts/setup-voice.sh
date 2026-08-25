#!/usr/bin/env bash
# Install the built-in AI voice (Piper, one professional female English voice)
# for the listing video maker. Run once on the staging box.
#
#   bash tools/listing-video/scripts/setup-voice.sh
#
# Alternatively, skip this and set ELEVENLABS_API_KEY or OPENAI_API_KEY instead;
# the tool prefers a hosted voice when a key is present.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VOICES="$HERE/voices"
VOICE_NAME="en_US-lessac-medium"
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium"

mkdir -p "$VOICES"

if ! command -v piper >/dev/null 2>&1 && [ ! -x "$VOICES/piper" ]; then
  echo ">> Installing piper-tts"
  python3 -m pip install --user --quiet piper-tts
  PIPER_BIN="$(command -v piper || echo "$HOME/.local/bin/piper")"
  if [ ! -x "$PIPER_BIN" ]; then
    echo "piper was installed but is not on PATH. Set PIPER_BIN to its full path." >&2
    exit 1
  fi
  ln -sf "$PIPER_BIN" "$VOICES/piper"
else
  ln -sf "$(command -v piper)" "$VOICES/piper" 2>/dev/null || true
fi

for file in "$VOICE_NAME.onnx" "$VOICE_NAME.onnx.json"; do
  if [ ! -s "$VOICES/$file" ]; then
    echo ">> Downloading $file"
    curl -fsSL -o "$VOICES/$file" "$BASE/$file"
  fi
done

echo ">> Checking the voice"
echo "School Explorer is free for life. No credit card." \
  | "$VOICES/piper" -m "$VOICES/$VOICE_NAME.onnx" -f "$VOICES/check.wav"
rm -f "$VOICES/check.wav"

echo "Voice ready in $VOICES"
