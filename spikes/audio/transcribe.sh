#!/usr/bin/env bash
# Usage: ./transcribe.sh artifacts/chunk-001.wav > artifacts/chunk-001.json
set -euo pipefail
: "${DEEPGRAM_API_KEY:?export DEEPGRAM_API_KEY first}"
curl -fsS -X POST \
  "https://api.deepgram.com/v1/listen?model=nova-3&diarize=true&smart_format=true&punctuate=true" \
  -H "Authorization: Token ${DEEPGRAM_API_KEY}" \
  -H "Content-Type: audio/wav" \
  --data-binary @"$1"
