# Spike report: screen capture quality & cost

Date: 2026-08-22 (AX-only cost run) · 2026-08-21 (quality re-measure) · macOS 15.4 · MacBook Air, Apple M1

Re-measurement after the six AX-extraction repair commits.
147 samples over ~9 min (108 CPU samples at 5 s). Apps exercised: Slack, Chrome,
VSCodium, TextEdit, Ghostty, Finder — each held frontmost ≥ 60 s doing real work.

Supersedes the 2026-08-13 run, which FAILed both axes: generic AX returned UI
chrome (no page/document body) and the char-count OCR gate suppressed the
fallback exactly where real content lived.

## Per-app extraction results

| App | Samples | AX content (median) | AX chrome (median) | sawContentRole | OCR fired | OCR chars (median) | ax_ms (med) | ocr_ms (med) | novel % |
|-----|---------|---------------------|--------------------|----------------|-----------|--------------------|-------------|--------------|---------|
| Slack | 35 | **8352** | 2215 | 100% | 0/35 | — | 107 | — | 54% |
| Google Chrome | 32 | **19719** | 2293 | 100% | 0/32 | — | 149 | — | 6% |
| VSCodium | 23 | 802 | 7256 | 100% | **19/23** | 3916 | 107 | 1360 | 83% |
| TextEdit | 3 | **17599** | 73 | 100% | 0/3 | — | 25 | — | 33% |
| Ghostty (terminal) | 21 | 0 | 30 | 10% | 20/21 | 3728 | 19 | 1331 | 71% |
| Finder | 33 | 0 | 306 | 18% | 32/33 | 1036 | 45 | 563 | 24% |

**The central 2026-08-13 finding is resolved.** AX now returns real document
content, not chrome, for the apps that failed before:

| Source | 2026-08-13 | 2026-08-21 |
|--------|------------|------------|
| Chrome AX | browser chrome only (tab title, URL, DevTools controls) | **19,719 chars real page body**, `sawContentRole=100%`, no OCR |
| Slack AX | window chrome only | **8,352 chars real message content**, no OCR |
| VSCodium AX | editor chrome only (file tree, toolbar) | **still chrome-dominated** (802 content vs 7,256 chrome) → OCR fires |

Content-role gating works: Chrome/Slack/TextEdit reach the content subtree and
skip the expensive OCR path entirely. The old char-count false-positive is gone
— `axContentChars` and `axChromeChars` are now separated, and OCR gates on the
content-to-chrome ratio (`content-swamped`) not a bare floor.

## Cost

- **Mean CPU: 16.12%** · median **0.30%** · p95 **107.6%** · max **165.3%**
- **Gate: sustained < 5% CPU → FAIL** (3.2× over) — but the mean is entirely
  OCR bursts; the **median is 0.30%**.
- AX latency: **96 ms median**, 486 ms max — cheap, affordable at the 3 s cadence.
- OCR latency: **724 ms median**, 1698 ms p95, 1807 ms max.
- OCR fired on **71/147** samples — **only** Finder, Ghostty, VSCodium. The
  three content-clean apps (Chrome, Slack, TextEdit) never triggered it.

## Findings

1. **Capture quality: PASS for AX-native apps.** Chrome, Slack, TextEdit now
   return real content via AX alone. This was the blocker; it is fixed. The
   the "per-app AX reaches the content subtree" assumption is confirmed on
   the generic reader for browser + chat + native-editor surfaces.

2. **VSCodium is the remaining content gap.** A canvas/Monaco-style editor
   exposes almost no AX content (802 chars, swamped by 7,256 chrome chars), so
   OCR fires 19/23. This is the app class that needs a
   **per-app parser**, not generic traversal — VSCodium/Electron editors need a
   dedicated extractor in M1, or they fall to OCR.

3. **CPU cost is entirely OCR — confirmed by removing it.** Median 0.30% showed
   the AX path was nearly free; the 16.12% mean came from OCR bursts >100%
   (multi-core) on the three no-content-role apps. The 2026-08-22 `--no-ocr` run
   settled it: **0.62% mean, gate PASS** (see Verdict).

4. **OCR is now correctly gated but still fixed-cadence.** OCR runs inside the
   3 s tick; at 724 ms median / 1807 ms max it fits the interval now (the old
   run peaked at 3112 ms), but firing it every tick on terminals/Finder is the
   cost. It should trigger on focus-change / settled-scroll, not every heartbeat.

5. **Novelty gating still sane.** 83% suppression on actively-scrolled VSCodium,
   6% on static Chrome reads — behaves as intended against real content.

## Verdict & M1 implications

**Re-measure result: capture quality PASS (AX-native apps), cost gate PASS
AX-only.** The R2 decision holds and is now measured on both axes.

A follow-up run on 2026-08-22 with `--no-ocr` (which is the M1 architecture,
since R2 drops OCR) measured the cost gate properly:

| Configuration | Mean CPU | Gate < 5% |
|---|---|---|
| AX + OCR (as originally built) | 16.12% | **FAIL** |
| **AX-only (`--no-ocr`, the R2 design)** | **0.62%** | **PASS** |

Median 0.00%, p95 5.10%, max 8.10% over 49 samples / 80 captures. This confirms
the earlier diagnosis exactly: OCR was the entire cost, and removing it — which
the reconciliation already decided — takes the gate from 3.2x over to 8x under.

That run also showed **Ghostty now yields 15,462 AX content chars** (it needed
OCR in the previous run) and **Zed returns 0 content, 0% content-role** — the
same editor-class gap as VSCodium, now confirmed across two editors.

## Editor-class apps: VSCodium solved, Zed not reachable (2026-08-22)

The editor gap turned out to be two different problems, not one.

**VSCodium / Electron — SOLVED.** Chromium does not build a full accessibility
tree until an AX client asks for one. Setting **`AXManualAccessibility`** on the
application element makes Monaco's backing textarea appear as a real
`AXTextArea` carrying document text. Measured before and after, same file:

| | AX content (median) | sawContentRole | basis |
|---|---|---|---|
| Before the poke | 802 (chrome fragments) | — | content-swamped → OCR |
| **After the poke** | **11,604** (max 16,559) | **97%** | `focus` |

Implementation notes, all measured — each of these silently breaks the fix:
- The value must be an **`NSNumber`**; `kCFBooleanTrue` is ignored.
- The attribute **always reads back `0`**, even when working. Check for an
  `AXTextArea` instead; never trust the readback.
- The flag **persists for the life of the target process**, so poke once per
  pid, not per capture.
- Do **not** set `AXEnhancedUserInterface`: it returns `kAXErrorIllegalArgument`
  (-25208) on current Electron and carries VoiceOver side effects.
- No need to touch the user's `editor.accessibilitySupport` setting — at its
  default (`auto`), VS Code detects the AX client and switches itself.

Verified by reading the extracted text, not by character count (the mistake
that produced the 2026-08-13 false PASS): captures contain genuine TypeScript
source — imports, exported declarations, multi-line comments — at ~11-14k chars
and 240+ lines per sample, stable across 14 samples. A little chrome (tab bar,
breadcrumb) leaks into the first two lines of the content region; harmless for
retrieval, worth trimming later.

**Known limit: the exposed text is a ~500-line window that tracks the cursor**
(`editor.accessibilityPageSize`, default 500), not the whole file. On a
3001-line file, after paging to the end, `AXValue` held only the tail. The
text-marker APIs (`AXStringForTextMarkerRange`, `AXStringForRange`) read the
same paged buffer and do not escape it. For Nova this is acceptable and
arguably correct — ambient memory should record *what the user was looking at* —
but it must not be described as capturing files.

**Zed — not reachable via AX.** Zed renders text on the GPU (Rust/GPUI). Its
editor pane exposes as an `AXGroup` of unlabeled buttons with **zero text
nodes**; 33/33 samples returned 0 content chars and 0% content-role. Zed ships
AccessKit and has a `ZED_EXPERIMENTAL_A11Y` flag, but with the flag confirmed
active the tree grows only trivially and still carries no document text. The
upstream a11y tracking issue is **closed as not planned**, with accessibility
stated to extend beyond 1.0. `AXManualAccessibility` is unsupported (-25205).

No parser can read text an app does not expose. The options for GPU-rendered
editors are a per-app OCR exception (which R2 permits by name) or no capture.
Recommend **no capture for Zed in M1**, revisited if upstream a11y lands.

- **AX-only viable for:** Chrome, Slack, TextEdit — confirmed real content, sub-150 ms, no OCR.
- **Needs a per-app parser (M1):** VSCodium and Electron/canvas editors — generic AX is chrome-swamped.
- **No content role (terminal, Finder):** out of scope for AX; accept no capture rather than pay OCR — aligns with R2 (drop OCR).

**Required M1 changes:**

1. **Drop OCR (R2) — measured, not assumed.** With OCR removed the CPU driver is
   gone: 0.62% mean vs a 5% gate. The gate is reachable **only** by not doing
   OCR, which the reconciliation already decided.
2. **Build per-app parsers for editor-class apps** (VSCodium first). Generic AX
   will not reach Monaco/canvas content; this is the parser-runtime
   pattern.
3. **If any OCR exception survives, gate it on focus-change, never the 3 s tick.**
4. **Keep the content/chrome separation and the ratio gate** — they are what
   turned the false PASS into an honest measurement.

**Net: both gates pass for the M1 architecture.** AX-only reads the apps that
matter at 0.62% CPU. The one open build task is per-app parsers for editor-class
surfaces (VSCodium, Zed), which is a known M1 work item, not an unknown.

## Reproducing

```
cd capture && swift build
.build/debug/nova-capture --no-ocr > /tmp/screen.jsonl   # the M1 architecture
.build/debug/nova-capture                                # with OCR, for comparison
.build/debug/nova-capture --no-ocr --dump 2>/tmp/text.txt  # inspect extracted text
```

Sample CPU alongside it with
`while true; do ps -o %cpu= -p $(pgrep -f nova-capture); sleep 5; done`.
Never commit `--dump` output — it contains real screen content.
