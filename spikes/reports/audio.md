# Spike report: audio capture + diarized transcription

Date: 2026-08-22 (system-tap leg closed) · macOS 15.4 (24E248) · MacBook Air, Apple M1

Mic capture + Deepgram nova-3 transcription exercised on ~3.5 min of real speech
(7×30 s chunks). System-audio process tap measured from a signed `.app` bundle:
62 s of two-voice playback captured. Deepgram key supplied via environment
(never committed).

| Leg | Result | Notes |
|-----|--------|-------|
| Mic capture, 30 s chunk rotation | **PASS** | 7 chunks, clean 30 s rotation, ~5.7 MB each (chunk-007 a short tail). |
| Deepgram nova-3 transcript quality (read it: usable?) | **PASS** | Fluent, accurate, smart-formatted. Proper nouns and figures intact ("Poppy AI", "Higgsfield", "Framer", "15 to 18 lakhs", "35 thousand"). Fully usable. |
| Diarization correctness (2 speakers) | **WEAK on mixed single-track audio** | A genuine two-person interview came back entirely as `S0` (229 words, 1 turn). Deepgram *ran* diarization and signalled its own doubt: `speaker_confidence` collapses to **0.03** exactly where the second voice interjects ("Oh, yeah?" at t=44.4 s), and 44/229 words score below 0.5. It did not split the speakers. **Low impact for Nova** — see below. |
| System-audio process tap (14.4+ API) | **PASS** | Solved by running from a signed `.app` bundle with `NSAudioCaptureUsageDescription` + the audio-input entitlement. 23.8 MB / 62 s, **100% nonzero samples, peak 0.857**, transcribes cleanly. The bare CLI binary was the whole problem. |
| Latency: 30 s chunk → transcript | ~2–4 s per 30 s chunk | Well within "transcript within 5 min of meeting end" (US-2.2). |

## What the transcript looks like (mic leg, redacted to 2 lines)

```
S0: …full time team members benefit — you get their time, you get quality, and
    you are able to train and motivate them…
S0: …Claude, Fable five was able to go through my browser… it saw the comments,
    saw the retention… and made a report…
```

Legible, correctly punctuated, speaker-turn structure intact. Transcription is
not the risk.

## System-audio tap: solved, after three code bugs and one entitlement

The tap went through four distinct problems. All are now resolved.

**Three code bugs (took `system-audio.wav` from 4096 B to a full-size file):**

1. `AVAudioPCMBuffer(bufferListNoCopy:)` leaves `frameLength = 0` → writes zero
   frames. Set it from `mDataByteSize / mBytesPerFrame`.
2. The IO block assumed a fixed 48 kHz/2 ch format instead of querying the tap's
   actual stream format (`kAudioTapPropertyFormat`).
3. `AVAudioFile.write(from:)` called on the realtime IO thread **never
   persists** — 23.9 MB flowed through the callback (proven with a counter) yet
   the file stayed a bare header across three flush strategies. `AVAudioFile` is
   not realtime-safe from an IO proc. Fix: append raw PCM to a plain
   `FileHandle` in the callback, backfill the WAV header on shutdown.

**Then: correct-size files, but pure digital silence (0% nonzero samples).**
Three tap configurations were tried and all behaved identically — stereo global
exclude, mono global exclude, and an explicit process-inclusion mixdown over all
27 live audio process objects — with and without the default output device bound
as an aggregate sub-device. Every one wrote the right byte count and zero audio.

**The cause was authorization, not code.** macOS 14.4+ process taps require
audio-capture authorization, and a bare CLI binary cannot request it: the tap is
created successfully and then silently delivers zeroed buffers, with no error at
any call site. That failure mode is why six code fixes made no difference.

**The fix** (`bundle.sh`): run from a signed `.app` bundle carrying
`NSAudioCaptureUsageDescription`, `NSMicrophoneUsageDescription`, and the
`com.apple.security.device.audio-input` entitlement. Ad-hoc signing
(`codesign -s -`) is sufficient — no Apple Developer account needed for local
capture. First run from the bundle: **23.8 MB / 62 s, 100% nonzero samples, peak
0.857**, transcribed cleanly by Deepgram.

**Carry into M1:** the real client must be a signed bundle with these keys from
day one, or system-audio capture silently returns silence with nothing in the
logs to explain it.

## Diarization: weak on mixed single-track audio

A genuine two-person interview (62 s, 229 words) came back as **one speaker,
one turn**. Deepgram ran diarization — every word carries `speaker` and
`speaker_confidence` — and signalled its own uncertainty rather than splitting:

| Signal | Value |
|---|---|
| Distinct speakers returned | 1 (all `S0`) |
| Median `speaker_confidence` | 0.787 |
| Words below 0.5 confidence | 44 / 229 |
| Confidence at the clearest interjection ("Oh, yeah?", t=44.4 s) | **0.03** |

The confidence floor lands exactly where the second voice cuts in, so the model
detects the change and still fails to attribute it. Podcast-style audio mixed
down to one track is a hard case: both voices share the same channel, the same
recording chain, and similar levels.

**Why this is low-impact for Nova.** The architecture does not depend on
diarization for the main case. Meeting capture records **mic and system audio as
two separate tracks**, so "me" vs "them" comes from track identity for free —
no model involved. Deepgram diarization only matters for multiple people
physically co-located on the *same* mic. Treat it as best-effort there, and
never as the source of truth for speaker labels.

## Verdict & M1 implications

**Spike 2 result: PASS.** Both capture legs work end-to-end and transcription
quality is not a risk.

- **Meeting capture is proven:** mic (AVAudioEngine, 30 s chunks) and system
  audio (CoreAudio process tap) both capture real audio and transcribe cleanly.
  The dual-track design is validated.
- **M1 must ship a signed bundle with audio-capture entitlements** from the
  start. This is the single most important carry-over: without it the tap fails
  silently — correct file sizes, zero audio, no error anywhere.
- **Do not rely on diarization for speaker labels.** Use track identity (mic vs
  system) for the two-party case, which is free and exact. Deepgram diarization
  is best-effort for co-located speakers on one mic, and measured weak there.
- **Write audio off the realtime thread.** `AVAudioFile` from an IO proc does
  not persist; use a ring buffer or raw appends and finalize on stop.
- **Estimated Deepgram cost/user/day at 2 h meetings:** nova-3 streaming is
  ~$0.0077/min ⇒ 120 min ≈ **$0.92/user/day** at list price (validate against a
  real meeting mix and any committed-use discount in M1).

## Reproducing

```
cd spikes/audio
export DEEPGRAM_API_KEY=...
./bundle.sh                                   # build + ad-hoc sign SpikeAudio.app
./SpikeAudio.app/Contents/MacOS/spike-audio   # grant TCC, restart once, then Ctrl-C
./transcribe.sh artifacts/system-audio.wav > artifacts/system-audio.json
bun format.ts artifacts/system-audio.json
```

Running the raw `.build/debug/spike-audio` binary instead of the bundle
reproduces the silent-capture failure.
