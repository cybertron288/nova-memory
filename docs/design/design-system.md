---
version: alpha
name: Nova
description: >
  Ambient personal memory for the AI era. A macOS menu-bar app that passively
  captures what you see and hear on your Mac, builds a private on-device
  memory, serves it to any LLM over MCP, and finds and closes open loops.
  The design language is "instrument, not app": a precision instrument for
  your own life, built from native macOS materials with three owned
  signatures — the aperture mark, ink-and-trace motion, and the redaction
  aesthetic.

colors:
  # ——— Substrate. The panel paints its own ground (glass + gradient, §2.4);
  # these serve the onboarding window, Settings, mockups, and anywhere
  # vibrancy is unavailable.
  surface-page-light: "oklch(0.982 0.002 250)"
  surface-page-dark: "oklch(0.192 0.006 250)"
  surface-raised-light: "oklch(1.000 0 0)"
  surface-raised-dark: "oklch(0.238 0.007 250)"
  surface-sunken-light: "oklch(0.958 0.003 250)"
  surface-sunken-dark: "oklch(0.162 0.006 250)"

  # ——— Ink. Cool-neutral, never pure black or pure white.
  ink-primary-light: "oklch(0.235 0.010 250)"
  ink-primary-dark: "oklch(0.962 0.003 250)"
  ink-secondary-light: "oklch(0.486 0.010 250)"
  ink-secondary-dark: "oklch(0.728 0.008 250)"
  ink-tertiary-light: "oklch(0.646 0.008 250)"
  ink-tertiary-dark: "oklch(0.578 0.008 250)"
  ink-quaternary-light: "oklch(0.784 0.005 250)"
  ink-quaternary-dark: "oklch(0.432 0.007 250)"

  # ——— Accent. ONE HUE DRIVES THE ENTIRE APP.
  # `--nova-hue: 296` is the single variable. Every value below is derived
  # from it by the formulas in §2.1 — change that one number and the whole
  # app re-themes coherently. 296 is violet.
  accent-light: "oklch(0.548 0.196 296)"
  accent-dark: "oklch(0.706 0.176 296)"
  accent-hover-light: "oklch(0.488 0.206 296)"
  accent-hover-dark: "oklch(0.764 0.166 296)"
  accent-wash-light: "oklch(0.962 0.028 296)"
  accent-wash-dark: "oklch(0.288 0.072 296)"
  accent-muted-light: "oklch(0.706 0.116 296)"
  accent-muted-dark: "oklch(0.588 0.116 296)"

  # ——— Glow. Emitted light, not a drop shadow. Always the accent hue at
  # high chroma with an alpha, layered as box-shadow or radial-gradient.
  glow-core: "oklch(0.648 0.232 296 / 0.56)"
  glow-mid: "oklch(0.648 0.232 296 / 0.24)"
  glow-far: "oklch(0.648 0.232 296 / 0.10)"

  # ——— Gradient stops. Hue-adjacent, never hue-opposite: every gradient in
  # Nova travels ±26° around the accent hue and nowhere else. This is what
  # stops it reading as an AI-startup mesh gradient.
  grad-from-light: "oklch(0.588 0.186 270)"
  grad-to-light: "oklch(0.528 0.196 322)"
  grad-from-dark: "oklch(0.468 0.162 270)"
  grad-to-dark: "oklch(0.388 0.166 322)"
  grad-veil-light: "oklch(0.962 0.028 296 / 0.72)"
  grad-veil-dark: "oklch(0.232 0.052 296 / 0.76)"

  # ——— Redaction. The solid block that stands where withheld text was.
  # Deliberately ink, not red: redaction is normal operation, not an error.
  redaction-light: "oklch(0.235 0.010 250)"
  redaction-dark: "oklch(0.962 0.003 250)"

  # ——— Status. Muted; these appear at 8px dot scale, never as fills.
  status-live: "oklch(0.642 0.112 158)"
  status-paused: "oklch(0.646 0.008 250)"
  status-attention: "oklch(0.682 0.132 62)"
  status-error: "oklch(0.588 0.148 27)"

  # ——— Hairlines. Structure comes from these, not from shadow.
  rule-light: "oklch(0.892 0.004 250)"
  rule-dark: "oklch(0.318 0.008 250)"
  rule-strong-light: "oklch(0.784 0.005 250)"
  rule-strong-dark: "oklch(0.432 0.007 250)"

typography:
  # System faces only. Nova ships no webfont: on macOS, SF is the face that
  # makes software feel like it belongs to the machine, and a menu-bar app
  # that uses anything else reads as foreign at 11pt.
  display:
    fontFamily: "SF Pro Display, -apple-system, system-ui, sans-serif"
    fontSize: 34px
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.021em"
  title:
    fontFamily: "SF Pro Display, -apple-system, system-ui, sans-serif"
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.22
    letterSpacing: "-0.014em"
  heading:
    fontFamily: "SF Pro Text, -apple-system, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "-0.006em"
  body:
    fontFamily: "SF Pro Text, -apple-system, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.46
    letterSpacing: "0"
  body-emphasis:
    fontFamily: "SF Pro Text, -apple-system, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.46
    letterSpacing: "0"
  caption:
    fontFamily: "SF Pro Text, -apple-system, system-ui, sans-serif"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.36
    letterSpacing: "0.004em"
  label:
    fontFamily: "SF Pro Text, -apple-system, system-ui, sans-serif"
    fontSize: 10px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.064em"
  capture:
    # The redaction aesthetic's face. Monospace signals "this is data we
    # read", not "this is prose we wrote".
    fontFamily: "SF Mono, ui-monospace, Menlo, monospace"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.54
    letterSpacing: "0"

rounded:
  none: 0px
  xs: 3px
  sm: 5px
  md: 8px
  lg: 11px
  xl: 14px
  full: 9999px

spacing:
  0: 0px
  1: 2px
  2: 4px
  3: 6px
  4: 8px
  5: 12px
  6: 16px
  7: 20px
  8: 24px
  9: 32px
  10: 40px
  11: 56px
  12: 72px

components:
  panel-section-header:
    typography: "{typography.label}"
    textColor: "{colors.ink-tertiary-light}"
    padding: "{spacing.5}"
    height: 28px
  loop-row:
    backgroundColor: "transparent"
    padding: "{spacing.5}"
    rounded: "{rounded.none}"
  loop-row-hover:
    backgroundColor: "{colors.surface-sunken-light}"
  loop-lead:
    typography: "{typography.label}"
    textColor: "{colors.ink-tertiary-light}"
  loop-description:
    typography: "{typography.body-emphasis}"
    textColor: "{colors.ink-primary-light}"
  loop-meta:
    typography: "{typography.caption}"
    textColor: "{colors.ink-tertiary-light}"
  action-button:
    typography: "{typography.caption}"
    textColor: "{colors.ink-secondary-light}"
    backgroundColor: "transparent"
    rounded: "{rounded.xs}"
    height: 22px
    padding: "{spacing.4}"
  action-button-hover:
    backgroundColor: "{colors.surface-sunken-light}"
    textColor: "{colors.ink-primary-light}"
  action-button-primary-hover:
    backgroundColor: "{colors.accent-wash-light}"
    textColor: "{colors.accent-light}"
  button-primary:
    backgroundColor: "{colors.accent-light}"
    textColor: "oklch(1.000 0 0)"
    typography: "{typography.body-emphasis}"
    rounded: "{rounded.sm}"
    height: 32px
    padding: "{spacing.7}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover-light}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary-light}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: 32px
    padding: "{spacing.7}"
  capture-preview:
    backgroundColor: "{colors.surface-sunken-light}"
    textColor: "{colors.ink-secondary-light}"
    typography: "{typography.capture}"
    rounded: "{rounded.md}"
    padding: "{spacing.6}"
  redaction-block:
    backgroundColor: "{colors.redaction-light}"
    rounded: "{rounded.xs}"
    height: 11px
  permission-card:
    backgroundColor: "{colors.surface-raised-light}"
    rounded: "{rounded.lg}"
    padding: "{spacing.9}"
  onboarding-window:
    width: 720px
    height: 560px
    backgroundColor: "{colors.surface-page-light}"
    rounded: "{rounded.xl}"
  status-dot:
    size: 7px
    rounded: "{rounded.full}"
  panel:
    width: 440px
    backgroundColor: "{colors.surface-raised-dark}"
    rounded: "{rounded.xl}"
    padding: "{spacing.0}"
  panel-header:
    typography: "{typography.label}"
    textColor: "{colors.ink-tertiary-dark}"
    height: 44px
    padding: "{spacing.6}"
  panel-loop-row:
    typography: "{typography.body-emphasis}"
    textColor: "{colors.ink-primary-dark}"
    padding: "{spacing.5}"
    height: 56px
  panel-loop-row-active:
    backgroundColor: "{colors.accent-wash-dark}"
  panel-footer:
    typography: "{typography.caption}"
    textColor: "{colors.ink-quaternary-dark}"
    height: 34px
---

# Nova — Design System & Experience Specification

**Version:** 1.0 · **Date:** 2026-09-21 · **Status:** Draft for review
**Companions:** `docs/features.md` (F1–F6), the original user-flow spec (Flows 1–11),
`docs/decisions.md` (R1a, D9),
the M2 shell design (the shell this dresses)

**Format:** This document follows the `design.md` specification
(`google-labs-code/design.md`): YAML front matter carries machine-readable
tokens; the `##` sections below appear in the mandated order. Sections 9
onward are conforming extensions — flow-by-flow experience design, and
Appendix A's generation prompts.

---

## 0. What Nova is — read this before designing anything

*This section is not part of the design.md schema. It exists because every
prompt in Appendix A is written to be self-sufficient, and a designer or model
that does not understand Nova will produce a beautiful thing that is wrong.*

### The product in one paragraph

Nova watches what you do on your Mac and **keeps track of what you owe people**.
Every day you make dozens of small promises — "I'll send that Friday", "let me
check and get back to you" — scattered across email, Slack, docs, and meetings.
Nova notices them, tracks them as **open loops**, and closes them automatically
when it sees you followed through. Hit **⌃⌥** from anywhere and a small window
shows what's still open. That is the product.

Underneath, Nova builds a private encrypted memory of everything it reads,
stored on your own Mac. That memory also powers a second capability for people
who want it: Nova can serve it to an AI assistant like Claude, so you can ask
questions about your own work and get answers with sources. That's a real
feature, and some users will care about it a lot — but it is **not** what Nova
is for, and it is not how Nova should be introduced.

### The hierarchy, and why it matters

**Primary — open loops.** This is the feature every user gets value from on day
one, with nothing to configure and no technical knowledge required. A person who
lives in Gmail, Sheets, and PowerPoint should finish onboarding understanding
exactly what Nova does for them: it remembers what they said they'd do. More
features and integrations will be built around this over time — treat open loops
as the product's spine, not as one feature among several.

**Secondary — the AI connector.** Connecting Claude or another assistant is an
optional power-user step, offered after the core product has already proven
itself. It is never a requirement, never a blocker, and never the headline.

**A design rule follows from this.** No screen before the final onboarding step
may mention MCP, connectors, LLMs, or AI assistants. If a screen's value
proposition depends on the user being a developer, it is wrong. The welcome
screen sells memory of your commitments; the connector screen — last, and
skippable — sells the AI capability to the people who want it.

### The three surfaces

| Surface | What it's for | Frequency |
|---|---|---|
| **The panel** (⌃⌥ or icon click) | The product. A small centered window listing active loops and Nova's status, opened from anywhere and dismissed instantly. | Several times a day |
| **The menu-bar glyph + its menu** | Status only: is Nova working, is it paused — plus pause, settings, quit. Left-clicking it opens the panel. | Glanced at constantly; clicked occasionally |
| **Onboarding** | Runs once. Earns the right to watch someone's screen. | Once |

### The three facts that must shape every screen

**1. Nova is asking for extraordinary trust.** It reads the user's screen. Not a
folder, not an inbox — everything. Every design decision is either building that
trust or spending it. There is no neutral element. A screen that looks slick but
evasive is a failure; a screen that is plain but candid is a success.

**2. Nova must be worth summoning.** The panel is the product. It appears because
the user asked for it, which means it can be richer and more expressive than a
passive UI ever could — the user is looking straight at it, on purpose. This is
where Nova's visual ambition belongs. The menu-bar glyph stays quiet, because
it is ambient.

**3. Nova should be understandable by someone who doesn't know what an API is.**
The primary user is not a developer. They should never encounter a screen that
assumes otherwise before the final, optional step.

### Who uses it

Nova is for anyone whose work generates commitments — which is nearly everyone
who works on a computer.

- **The Juggler** — an IC in 5–15 apps a day. Wants to stop dropping things.
- **The Orchestrator** — PM or founder, 4–8 meetings a day, high commitment
  volume in both directions. Wants the morning list of what they owe people.
- **The Desk Worker** — lives in Gmail, Sheets, PowerPoint, and a browser. Not
  technical, has never heard of MCP, will never connect an AI assistant. **Nova
  must be completely valuable to this person**, and they are the reason open
  loops lead and the connector is optional. If a design only works for someone
  who reads changelogs, it is the wrong design.
- **The Researcher** — reads heavily, wants to resurface something from three
  weeks ago. This person is the main beneficiary of the AI connector.

All are privacy-literate enough to read a permission dialog. Design for a reader
looking for the catch — but not for a reader who knows what a daemon is.

### What the user actually does, in order

Installs → grants Accessibility and Microphone → picks which apps Nova may
observe → **sees Nova capture something real from their own screen** →
optionally connects an AI → learns the ⌃⌥ shortcut → forgets Nova exists →
**hits ⌃⌥ a few times a day to see what's open** → clears loops → occasionally
pauses it → very occasionally deletes a time range.

**There is no sign-in.** Accounts are deferred; Nova works fully without one.
"No account needed" is a trust claim and appears on the welcome screen.

### Vocabulary (from `docs/glossary.md`)

| Term | Meaning in UI copy |
|---|---|
| **Capture** | Reading text from the frontmost window. Never "recording" — Nova takes no screenshots in v1. |
| **Memory** | The stored, encrypted, searchable result. |
| **Derivative** | An atomic extracted fact. Never shown by that name in UI; say "fact". |
| **Open loop** | A commitment, question, or follow-up that isn't closed yet. Shown as "open loop" — the term is good and users get it. |
| **Auto-resolve** | Nova noticing a loop was closed. UI says "closed for you". |
| **Relay** | The cloud API call for embedding/transcription. UI says "sent for processing" and names the vendor. |
| **MCP connector** | The link to the user's AI. UI says "connect your AI" — the letters MCP appear only on the connector screen itself, never before it. |
| **The panel** | The ⌃⌥ window. In UI copy it has no name at all — it is just what appears. Never called "the panel", "the panel", or "the overlay" to users; the menu item that opens it says "Open Nova". |

**Forbidden words in UI copy:** *record*, *surveil*, *monitor*, *track*,
*spy*, *AI-powered*, *seamless*, *effortless*, *revolutionary*, *magic*. The
first five because they are false or alarming; the rest because they are hype.
Say what happens, in plain words, in the fewest of them.

---

## 1. Overview

### The direction: instrument, not app

Nova is a measuring instrument pointed at the user's own working life. The
design language comes from instruments — a light meter, an oscilloscope, a
seismograph — rather than from consumer software. Instruments are trusted
because they are legible: they show their state plainly, they do not decorate,
and their readouts look like readouts.

This resolves Nova's central tension. A product that watches everything cannot
also be cute; cuteness reads as misdirection. But it cannot be cold either, or
no one installs it. An instrument is the third thing: *precise, candid, and
quietly well-made.* The user should feel the same way about Nova that they feel
about a good mechanical keyboard — that someone cared, and that nothing is
hidden.

### What that means concretely

An instrument is not the same as a plain one. Nova's substrate is native macOS —
vibrancy, SF Pro, SF Symbols, standard controls — and the ambient surfaces stay
quiet. But the panel is summoned, and a summoned surface earns expressiveness: the
user is looking directly at it, deliberately, for a few seconds at a time.

**So Nova runs two registers, and which one applies depends entirely on whether
the user asked to see it.**

| Register | Surfaces | Treatment |
|---|---|---|
| **Ambient** | The 16pt menu-bar glyph and its native menu | Quiet. Monochrome glyph (an OS requirement), no glow, no gradient, no custom chrome. Seen constantly, so it must never demand attention. |
| **Summoned** | The panel, onboarding | Expressive. Violet gradient grounds, real glow on live and focused elements, glass materials, depth. Seen on purpose, so it can be beautiful. |

This split is the resolution of Nova's central design tension. "Quiet by
default" (PRD principle 4) is about *unprompted* attention — it forbids Nova
from interrupting, not from being striking when invited. A product that is
invisible until called and then genuinely impressive is quieter than one that
is mildly decorative all the time.

**What does not change between registers:** one hue, one motion curve, one type
system, no illustration or mascot, no shadow used as fake depth. Glow is
emitted light and is allowed; a gray drop shadow under a card is still wrong.

### 1.1 Signature one — the aperture mark

Nova's mark is an **aperture**: a circle formed by overlapping blades, like a
camera iris, which can be drawn more open or more closed. It is simultaneously
a lens (Nova sees), an eye (Nova is watching, and says so), and the letter O
(Nova's roundest letter). At 16pt in the menu bar it reads as a ring with a
notch; at 128pt on the welcome screen it reads as a precision-machined part.

Geometry: six blades, each a circular-arc segment, rotationally symmetric at
60°. Outer diameter 16pt at menu-bar size, stroke 1.5pt, aperture opening
varying from 62% of outer diameter (fully open, capturing) to 0% (closed,
paused). The blades rotate 30° between open and closed, which is what produces
the mechanical-iris feeling rather than a simple scale.

The mark is always a **template image** in the menu bar — macOS recolors it for
light and dark menu bars and for the highlighted state. It is never colored.
Status is carried by *form* (open/closed/marked), never by hue, because a 16pt
colored dot is illegible and because colorblind users exist.

**This is the one custom-drawn vector in the product.** Everything else uses SF
Symbols. If a generation tool cannot draw the aperture cleanly, it should draw
a plain ring and annotate it — a bad aperture is worse than a placeholder.

### 1.2 Signature two — ink-and-trace motion

**Nothing in Nova slides, bounces, springs, or scales up from zero.** Motion in
consumer apps says "look what I can do". Motion in an instrument says "a value
changed". Nova's motion vocabulary has exactly four verbs:

| Verb | What it does | Where |
|---|---|---|
| **Develop** | opacity 0→1 with scale 0.96→1.00, origin at the element's anchor | anything appearing: the panel, rows, cards |
| **Settle** | a value moves to its new position and damps, no overshoot past 1% | counts changing, list reflow |
| **Trace** | a stroke draws along its own path, 0→100% length | the aperture, progress, the capture preview typing in |
| **Dissolve** | opacity 1→0 with a 2pt upward drift, leaving no gap until complete | anything leaving: a resolved loop, a dismissed toast |
| **Bloom** | glow radius and alpha rise, then settle back to resting | summoned surfaces only: the panel appearing, a row taking focus, a loop resolving |

**Bloom is the only verb exclusive to the summoned register.** It never appears
in the menu bar or its menu. It is light, not movement — the element does not
travel, it brightens. Resting glow is `glow-mid`; bloomed is
`glow-core` at 1.4× radius, returning over `motion-base`.

**The single easing curve** is `cubic-bezier(0.32, 0.72, 0.28, 1.00)` —
fast-out, long-settle, no overshoot. Every transition in Nova uses it. Having
one curve is itself the signature: the whole app moves with one hand.

**Durations** — three values, no others:

| Token | Value | Use |
|---|---|---|
| `motion-quick` | 140ms | state feedback: hover, press, toggle |
| `motion-base` | 240ms | element enter/exit, panel summon, row removal |
| `motion-considered` | 420ms | screen transitions, the aperture state change, first-run beats |

**Reduced motion is not a degraded path.** Under
`prefers-reduced-motion: reduce`, every *Develop* becomes a 100ms opacity-only
fade, *Trace* becomes an instant final state, *Dissolve* becomes a 100ms fade,
and the glyph animation stops entirely at its current state. Nothing is lost
except the movement — no information is carried by motion alone. This is a
requirement, not a courtesy: users who set that preference are often the users
most bothered by an animated menu-bar icon.

### 1.3 Signature three — the redaction aesthetic

**The problem this solves:** Nova needs to show the user what it captures. Any
honest rendering of that is a wall of somebody's private text. Showing it raw
in a screenshot, a marketing site, or a settings pane is a privacy hazard;
showing a fake sample is a lie the user will smell.

**The solution:** captured content is always rendered in SF Mono at 11pt, with
withheld spans replaced by **solid ink blocks** at x-height — not asterisks,
not blur, not a lock icon. A redaction block is `height: 11px`, `rounded: 3px`,
filled with `redaction` ink at 100% opacity, width matching the text it
replaces.

This does three things at once:
1. It looks exactly like a declassified document, which is a visual idiom
   everyone already reads as *"something was deliberately withheld here."*
2. It makes the *structure* of captured data visible — you can see it is a
   Slack thread, count the messages, see the timestamps — while the content
   stays private.
3. It is Nova's only real visual texture, and it is made of Nova's actual
   function rather than decoration.

**Where it appears:** the permission-ceremony live previews (§9.B), the first-
how-it-works diagram (§9.C), evidence lines in the panel's loop rows (§9.F), the transparency
panel when it ships (F5.5), and every marketing screenshot Nova ever takes.

**Rules:** redaction blocks never animate independently; they *Develop* with
their container. Never redact more than ~40% of a preview or it reads as
broken. Never use red. Never use a blur — blur implies recoverable, ink implies
gone.

---

## 2. Colors

### 2.1 One hue drives the entire app

Nova's whole palette derives from **a single variable**:

```css
:root { --nova-hue: 296; }   /* violet — the default */
```

Every accent, glow, gradient stop, wash, and hover state is computed from that
number. Change it to `256` and Nova is blue; `172` and it's teal; `38` and it's
amber. Nothing else needs editing, and the result stays coherent because every
value is derived by the same formulas rather than hand-picked.

**The derivation table.** `H` is `--nova-hue`. Lightness and chroma are fixed;
only hue varies. This is why oklch is mandatory — it is perceptually uniform, so
the same L and C produce equally-present colors at any hue, which HSL cannot do.

| Token | Light mode | Dark mode |
|---|---|---|
| `accent` | `oklch(0.548 0.196 H)` | `oklch(0.706 0.176 H)` |
| `accent-hover` | `oklch(0.488 0.206 H)` | `oklch(0.764 0.166 H)` |
| `accent-muted` | `oklch(0.706 0.116 H)` | `oklch(0.588 0.116 H)` |
| `accent-wash` | `oklch(0.962 0.028 H)` | `oklch(0.288 0.072 H)` |
| `glow-core` | `oklch(0.648 0.232 H / 0.56)` | same |
| `glow-mid` | `oklch(0.648 0.232 H / 0.24)` | same |
| `glow-far` | `oklch(0.648 0.232 H / 0.10)` | same |
| `grad-from` | `oklch(0.588 0.186 H−26)` | `oklch(0.468 0.162 H−26)` |
| `grad-to` | `oklch(0.528 0.196 H+26)` | `oklch(0.388 0.166 H+26)` |
| `grad-veil` | `oklch(0.962 0.028 H / 0.72)` | `oklch(0.232 0.052 H / 0.76)` |

**The neutrals also carry the hue, faintly.** Every ink and surface token holds
chroma between 0.002 and 0.010 at the accent hue — so a violet Nova has warm-
violet grays and a teal Nova has cool-teal grays. This is the detail that makes
a re-theme look designed rather than recolored. Substrate tokens in the front
matter are written at hue 250 for legibility; in implementation they take
`var(--nova-hue)` like everything else.

In CSS this is one line per token using `oklch()` with a `calc()` on the hue.
In SwiftUI it is one `Color` extension reading a single stored hue. Both are
specified in the implementation plan, not here.

### 2.2 Violet, and why

The default hue is **296** — a true violet, neither blue-leaning nor magenta.

It was chosen against three alternatives. macOS system blue is explicitly ruled
out: it reads as the OS's own accent, so Nova would have no color identity at
all, and it is the single most common accent in Mac software. A cyan-leaning
blue was the earlier direction in this document and was reversed — it read as
cold instrumentation, which suited a passive utility but not a summoned surface
the user should be glad to see. Green conflicts with the live-status dot.

Violet does three things well here: it is uncommon in productivity software, so
it is memorable; at high chroma it glows convincingly on a dark ground, which
the panel depends on; and it carries a connotation of memory and recall rather
than of alerting or urgency, which is the right emotional register for a product
about what you've already done.

### 2.3 Glow — the rules

Glow is **emitted light**, and it is the only depth effect Nova permits besides
hairlines and surface steps. It is never gray, never black, never a drop shadow
wearing a color.

- **Always the accent hue.** A glow is `glow-core`/`glow-mid`/`glow-far` and
  nothing else. There is no green glow, no red glow, no white glow.
- **Layer three stops**, never one: a tight `glow-core` at 8–12px, a `glow-mid`
  at 24–32px, and a `glow-far` at 64–80px. A single-stop glow looks like a
  cheap CSS shadow; three stops look like light.
- **Only on the summoned register.** The panel and onboarding. Never in the menu
  bar and never in its menu.
- **Only on things that are live or focused** — the aperture while capturing,
  the focused panel row, a loop in the moment it resolves. Glow means *this is
  active*, so glowing something static drains the signal.
- **Never behind body text.** Glow sits behind containers and marks, never
  behind a paragraph, because it destroys contrast.

### 2.4 Gradient — the rules

- **Hue-adjacent only.** Every gradient travels from `H−26°` to `H+26°` — a 52°
  arc around the accent. Never hue-opposite, never rainbow, never more than two
  stops. This single constraint is what separates Nova's gradients from the
  purple-to-pink mesh that marks generic AI software.
- **Grounds, not objects.** Gradients fill backgrounds — the panel's ground, an
  onboarding panel. They never fill a button, a row, a chip, or text.
- **Low contrast internally.** The two stops differ by ≤0.06 lightness. The
  gradient should be *felt* rather than seen; if a viewer can point to where it
  changes, it is too strong.
- **Always veiled where content sits.** Text over a gradient sits on a
  `grad-veil` layer, which is what keeps contrast at 4.5:1 regardless of hue.

### 2.5 Light and dark are co-equal

Nova lives in the menu bar and follows the system appearance. Both modes are
designed and every mockup is produced in both.

**The panel is the exception: it is dark in both appearances.** A summoned
overlay floating over arbitrary content needs to read as a distinct object
rather than as part of whatever is behind it, and a dark ground is what makes
violet glow work at all. This is the only element in Nova that does not follow
the system appearance, and it is deliberate.

### 2.6 Status colors, and their strict limits

`status-live`, `status-paused`, `status-attention`, `status-error` appear only
as 7px dots and as the tint of a single inline text line. They are never a
background fill, never a border, never a button, and never glow. They are also
the only colors in the app that do not derive from `--nova-hue` — a green that
turned violet with the theme would stop meaning "healthy".

### 2.7 Contrast floor

All body text meets 4.5:1 against its actual backdrop, including 11pt captions
— 11pt is not large text and does not get the 3:1 allowance. `ink-tertiary` is
the lightest ink permitted on text; `ink-quaternary` is for rules and disabled
glyphs only.

**On gradient and glow grounds, contrast is measured against the veil layer,
not the gradient.** Any mockup placing text directly on an unveiled gradient is
wrong regardless of how it looks at a glance.

## 3. Typography

### System faces, no exceptions

Nova ships **no custom font**. SF Pro Display for 22pt and above, SF Pro Text
below it, SF Mono for captured content. This is a deliberate refusal: on macOS,
a menu-bar utility that uses Inter or a display serif announces itself as a
web app in a native costume. SF is what the OS is set in, and matching it is
what makes Nova feel like part of the machine.

The identity is carried by the aperture, the motion, and the redaction
aesthetic — not by a typeface. A design system that needs a distinctive font to
feel distinctive is thin.

### The scale

Seven steps, and no interpolating between them:

| Token | Size / Weight | Use |
|---|---|---|
| `display` | 34 / 600, -0.021em | Onboarding screen titles. One per screen, max. |
| `title` | 22 / 600, -0.014em | Screen titles in onboarding. |
| `heading` | 15 / 600, -0.006em | Card titles, settings group headers. |
| `body` | 13 / 400 | Default. Loop descriptions, explanatory copy. |
| `body-emphasis` | 13 / 600 | The loop description itself; the one thing in a row the eye should hit first. |
| `caption` | 11 / 400 | Metadata: counterparty, age, source app, timestamps. |
| `label` | 10 / 600, +0.064em, uppercase | Section eyebrows only: `OPEN LOOPS`, `TODAY`. Never a sentence. |
| `capture` | 11 / 400, SF Mono | Captured content, always. |

**Negative tracking on large sizes, positive on the label** — standard optical
correction, and the `label`'s wide tracking is what makes a 10pt uppercase
eyebrow read as a structural marker rather than shouting.

### Copy rules

- **Sentence case everywhere.** Only `label` is uppercase.
- **Measure**: explanatory copy caps at 62 characters. In the 440pt panel this
  is automatic; in the 720pt onboarding window it must be enforced with
  `max-width`.
- **Numbers as figures**: "3 open loops", never "three".
- **No terminal punctuation on labels, captions, or single-sentence card
  bodies.** Periods only inside multi-sentence paragraphs.
- **Second person, active voice, present tense.** "Nova reads the text in your
  frontmost window" — not "text will be read".

---

## 4. Layout

### Three containers, and that is all

Nova has exactly three layout surfaces. Everything in §9 lives in one of them.

**The panel — 440pt wide, content height, max 420pt then scrolls.**
A floating panel centered horizontally on the active display and positioned at
32% from the top — above centre, where the eye rests, and clear of the dock. It
is opened by ⌃⌥ *or by clicking the menu-bar icon* — both routes open the same
panel in the same place — and dismissed by `esc`, by clicking outside, or by
acting on the last loop. It floats above all windows, appears on every Space,
and takes keyboard focus instantly.

440pt is chosen to be unmistakably *not* a document window: wide enough for a
loop description to breathe, narrow enough that it reads as a heads-up display
rather than an app. It is dark in both appearances (§2.5), with a violet
gradient ground and an `xl` radius.

Internal structure is a **single vertical scroll**: header → rows → footer
legend. No tabs, no sidebar, no sub-navigation, no sections. D9's search and
timeline sections are not rendered here as placeholders — the panel answers one
question, and an empty section would dilute that. They return as modes if and
when they are built (Flow F, "what the panel does not do").

**The onboarding window — 720 × 560pt, fixed, centered, not resizable.**
Fixed size because every onboarding screen is composed for exactly this frame,
and a resizable window means designing for a range nobody will look at. 720 ×
560 is a 9:7 landscape that fits comfortably on a 13" MacBook with the dock
showing, and is small enough to feel like a focused sheet rather than an app.

**The Settings window — standard macOS preferences, 680pt wide.**
A conventional toolbar-tabbed preferences window. Nova contributes copy and
grouping, not chrome. It is opened from the menu-bar icon's menu and is the
only surface that is not either summoned or run-once.

**The menu-bar icon is not a container.** It is a 16pt glyph plus a native
menu, and it holds no Nova-drawn layout at all (Flow H).

### The grid

**Panel:** single column. Horizontal padding `spacing.5` (12pt) on the header,
rows, and footer; rows bleed to full width so focus and hover read as a
full-width band. Vertical rhythm is 4pt-based.

**Onboarding:** a 12-column grid, 56pt outer margin, 16pt gutter — but almost
every screen uses one of three fixed compositions:

- **Centered-narrow** (welcome, how-it-works, connector): content in columns 3–10, vertically
  centered, max-width 460pt.
- **Split** (permission ceremony): explanation in columns 1–5, live preview in
  columns 7–12, both top-aligned at 96pt from the top.
- **Full-width list**: a single scrolling list, columns 1–12, with a fixed
  header and a fixed footer bar. Used by the Settings panes, not by onboarding.

### Spacing scale

The 12-step scale in the front matter is the whole vocabulary. Two rules
govern it:

- **Within a group**: `spacing.2`–`spacing.5` (4–12pt).
- **Between groups**: `spacing.8`–`spacing.10` (24–40pt).

The jump between those two bands is what creates legible grouping without
drawing a box. Nova uses that jump instead of cards wherever possible.

### Footer bars

Onboarding screens have a fixed 64pt footer with a top hairline. Primary action
right-aligned, secondary action immediately left of it, and a left-aligned
"why?" or skip affordance where the flow allows one. The footer never scrolls.

---

## 5. Elevation & Depth

### No drop shadows — but the summoned register has real depth

There are **no gray drop shadows in Nova's own UI**, in either register. A gray
shadow under a card is the generic solution to depth and Nova never uses it.
Every neutral shadow in the product is one macOS draws for itself: the panel's
window shadow, the onboarding window's shadow, a menu's shadow.

**What the summoned register adds instead is light.** The panel and onboarding
express depth through emitted glow (§2.3), gradient grounds (§2.4), and glass —
a translucent layer over a blurred backdrop. These are not shadows; they are the
difference between an object that sits *on* the screen and one that sits *in*
it.

In the ambient register — the menu bar and its menu — and in the onboarding
window's flatter areas, depth is expressed three ways, in order of preference:

1. **Hairline rules** (`rule` token, 1px, or 0.5px on Retina where the platform
   draws it that way). A rule above a section is Nova's primary structural
   device — it is the instrument-panel idiom, and it is cheap, sharp, and
   perfectly legible in both modes.
2. **Surface steps.** `surface-sunken` recessed below `surface-page` below
   `surface-raised`. Used for the capture preview well and for hover states.
   Never more than one step apart within a view.
3. **Vibrancy**, provided by the platform, in the panel's glass base and in native menus.

### Why no gray shadows, ever

A gray shadow is a borrowed convention that says "this floats" without saying
anything about the product. Nova's ambient content is not floating — it is
printed on the panel — and its summoned content floats by *glowing*, which is
specific to Nova and derives from the theme hue.

This is the rule most likely to be violated by a generation tool trained on web
design. **Any mockup that comes back with `box-shadow: 0 4px 12px rgba(0,0,0,…)`
is wrong and must be corrected** — in the panel it should be a three-stop accent
glow; in the onboarding window it should be a hairline.

### Focus rings

The system focus ring, unmodified. It is the accessibility affordance users
expect and it is already accent-colored by the OS. Do not restyle it.

---

## 6. Shapes

### Sharp, with a small radius on interactive elements only

| Element | Radius |
|---|---|
| Rules, sections, rows, list items | `0` |
| Action buttons, tags, inline chips | `xs` (3pt) |
| Primary/secondary buttons, inputs, toggles | `sm` (5pt) |
| The capture-preview well, permission cards | `md`–`lg` (8–11pt) |
| The onboarding window | `xl` (14pt) — matches macOS window chrome |
| Status dots, the aperture | `full` |

**The rule:** anything that holds content is square; anything you press is
slightly rounded; anything that is a *state* is a circle. A 3pt radius on a
22pt-tall action button is nearly invisible and that is the intent — it softens
the target without making the interface look bubbly.

**Never exceed 14pt.** Large radii are the single fastest way to make a
precision instrument look like a toy.

### The status dot

7px, `full` radius, one of four status colors, always paired with a text label
in `caption`. It never appears alone, because a bare colored dot is unreadable
to a colorblind user and ambiguous to everyone else.

---

## 7. Components

Every component Nova needs, and every state it can be in. States that are not
listed do not exist — a generation tool should not invent a "selected" or
"expanded" variant not specified here.

### 7.1 Status item glyph *(menu bar)*

The aperture mark at 16pt, template image. **Three states, and the transitions
between them are the product's most-seen animation.**

| State | Form | Motion |
|---|---|---|
| **Capturing** | Aperture open at 62% | Breathes: opening oscillates 62%↔58% over 4.2s, `ease-in-out`, infinite. Amplitude is deliberately near-subliminal — noticed only if looked at. |
| **Paused** | Aperture closed to 0%, blades rotated 30° | Static. No motion at all. |
| **Attention** | Aperture open at 30%, with a 3pt dot centered in the opening | Static, except a single *Trace* on entry. |

**Transitions:** `motion-considered` (420ms), blades rotating and opening
simultaneously. Capturing→Paused is the iris closing; it should read as a
mechanical shutter. This transition is the payoff of choosing an aperture as
the mark.

**A loop was found:** one pulse — opening goes 62%→68%→62% over 700ms, once.
Never repeats, never queues. If three loops are found in a minute, the glyph
pulses once.

**Under reduced motion:** all animation stops. The glyph renders the static
form for its state. No breathing, no pulse.

**Battery:** the breathing animation runs at 30fps via `CVDisplayLink`, pauses
entirely when the display sleeps, when the menu bar is hidden in fullscreen,
and on battery below 20%. Below that threshold it renders static. The animation
budget is measured and reported in the shell's performance notes; if it costs
more than 0.1% CPU it is cut to a 2-frame crossfade.

### 7.2 Loop row

The single most important component in the product. Two lines plus metadata,
rendered at the panel's 440pt width.

```
┌────────────────────────────────────────────────┐
│ YOU SAID YOU WOULD                    ← label, ink-tertiary
│ merge PR #11                          ← body-emphasis, ink-primary
│ with Dana Reyes · noticed 2d ago · said "today"  ← caption, ink-tertiary
│ [done]  [snooze ▾]  [dismiss]         ← action buttons, appear on hover
└────────────────────────────────────────────────┘
```

**Direction lead** (`label`): spelled out, never a code. `YOU SAID YOU WOULD`,
`SOMEONE OWES YOU`, `UNANSWERED`, `STALLED`. The shell copies the wording
`formatLoops()` already produces for MCP rather than inventing a second rule
(shell spec §8).

**Actions appear on row hover** and are always present for keyboard/VoiceOver
users. They do not animate in — they *Develop* at `motion-quick`. Showing them
permanently makes a 3-row list look like a form; hiding them entirely makes
them undiscoverable. Hover is the compromise, with full non-hover availability
to assistive tech.

**States:**

| State | Rendering |
|---|---|
| Default | As above, transparent background |
| Hover | `surface-sunken` full-bleed band, actions visible |
| Acting (optimistic) | Row *Dissolves* over `motion-base` the instant the action is tapped |
| Action failed | Row *Develops* back in, with an inline `caption` in `status-error`: "already resolved" — shown 4s then *Dissolves* |
| Unreadable (decrypt failed) | Row omitted entirely; the section count reads "3, 1 unreadable" |

**The dissolve on `done` is the emotional center of the daily product.** It is
the one moment Nova gives the user something to feel. The row fades and drifts
up 2pt while the rows below *Settle* into the gap — no collapse-snap, no
checkmark animation, no confetti. The satisfaction comes from the smoothness of
the reflow, not from a reward graphic.

### 7.3 Action button

22pt tall, `caption` text, `xs` radius, transparent until hovered. Three
variants by intent, differing only in hover treatment:

| Variant | Hover |
|---|---|
| `done` (primary intent) | `accent-wash` background, `accent` text |
| `snooze` | `surface-sunken` background, `ink-primary` text. Has a `▾` that opens a menu: Tomorrow 9am / This weekend / Next week / Pick a date… |
| `dismiss` | `surface-sunken` background, `ink-primary` text. **Requires confirmation** — first click replaces the row's actions with "Dismiss permanently? [yes] [cancel]" inline, because dismiss is irreversible by design (shell spec §7). |

### 7.4 Capture preview well

The redaction aesthetic's container. `surface-sunken`, `md` radius,
`spacing.6` padding, `capture` typography, with a `caption` header line naming
the source: `Chrome · docs.google.com · 2s ago`.

Content renders as structured captured text with redaction blocks. When live
(during the permission ceremony), new lines *Trace* in character by character
at ~600 chars/sec — fast enough not to be tedious, slow enough to be visibly
*happening*. Under reduced motion, lines appear complete.

**Maximum height 200pt**, scrolled, with a bottom fade to `surface-sunken`.

### 7.5 Permission card

Used three times in the ceremony. `surface-raised`, `lg` radius, `spacing.9`
padding. Contains: an SF Symbol at 28pt in `accent`, a `title`, a `body`
paragraph at 62-char measure, a plain-language "what this does and does not
allow" list, and the grant button.

**States:** not-yet-requested · requesting (system dialog is up; card dims to
60% and the button shows a spinner) · granted (symbol swaps to a filled
checkmark in `status-live`, card gets a `status-live` hairline) · denied
(symbol swaps to `status-attention`, body is replaced with recovery copy and a
"Open System Settings" button) · not-applicable (Screen Recording when no OCR
exception is enabled — card renders at 40% with "not needed for your setup").

### 7.6 Primary / secondary button

`button-primary`: accent fill, white text, 32pt tall, `sm` radius,
`body-emphasis`. Hover darkens to `accent-hover` at `motion-quick`. Press
scales to 0.98 — the only scale-on-press in the product, and it is 2%.

`button-secondary`: transparent, `ink-secondary` text, same metrics. Hover
gets `surface-sunken`.

Loading state: label is replaced by a 14pt indeterminate spinner; width is
locked to the resting width so the button does not resize.

### 7.7 Toggle, text field, list row (settings)

Standard AppKit controls, unmodified: `NSSwitch`, `NSTextField`,
`NSTableView` rows. Nova restyles none of them. The design contribution here is
grouping and copy, not chrome.

### 7.8 App policy row *(Settings → Capture → Apps)*

App icon at 28pt · app name in `body` · bundle id in `caption` `ink-tertiary`
· toggle right-aligned.

**Locked variant:** for password managers, banking apps, and private browsing —
toggle renders disabled in the off position with a 11pt SF Symbol lock beside
it, and a `caption` reading "always off". Hovering the lock shows a tooltip:
"Nova never observes this category." This is F5.1's non-overridable rule made
visible, and it is a trust-building element, not a limitation to hide.

Since onboarding no longer includes an app picker, this row now lives only in
Settings, and the locked group is the verification surface for the scope claim
onboarding makes in words (Flow B).

### 7.9 Connector card *(connect your AI)*

One per client: Claude Desktop, Claude Code, Cursor, claude.ai (web). Contains
the client name, a one-line instruction, a monospace config block, and a
`Copy` button that confirms inline ("Copied" in `status-live` for 2s).

### 7.10 Toast

A transient notice inside the panel or the onboarding window — never a
floating system-wide overlay. Single line of `caption`, `surface-sunken`
background, full width of its container, 32pt tall. *Develops* in, holds 4s,
*Dissolves*. Maximum one at a time; a second replaces the first.

---

## 8. Do's and Don'ts

**Read §1's two-register split first.** Several rules below apply to one
register and not the other, and applying a summoned-register rule to the menu
bar (or vice versa) is the most common way to get Nova wrong.

### Do

- **Do lead with open loops.** Every screen before the final onboarding step
  sells "Nova remembers what you said you'd do". Not memory, not AI, not search.
- **Do show the real thing.** Where Nova can render actual captured data
  (redacted), it must. A synthetic sample is a last resort and must be labeled.
- **Do state what Nova cannot do**, next to every permission ask.
- **Do derive every color from `--nova-hue`.** If a mockup contains a hex value
  that isn't a neutral or a status color, it's a bug.
- **Do layer glow in three stops** (§2.3), always in the accent hue, only on
  live or focused elements, only in the summoned register.
- **Do keep gradients hue-adjacent** (±26°), two stops, low internal contrast,
  backgrounds only, always veiled under text.
- **Do design both appearances** — except the panel, which is dark in both.
- **Do use hairlines and the spacing jump** to group things in the ambient
  register, before reaching for a container.
- **Do name the vendor** whenever content leaves the machine.
- **Do let silence be the state.** No loops means no notification and a calm
  "All clear" — not an empty-state illustration urging engagement.

### Don't

- **Don't mention MCP, connectors, or LLMs before the final onboarding step.**
  The primary user is not a developer and must never be made to feel like the
  product wasn't built for them.
- **Don't use a gray drop shadow.** Not on a card, not on a button, not
  anywhere, in either register. §5.
- **Don't put glow or gradient in the menu bar or its menu.** Those
  are ambient. The glyph is a monochrome template image — that one is an OS
  requirement, not a preference.
- **Don't let a gradient exceed two stops or a 52° hue arc**, and don't use one
  to fill a button, row, chip, or text. A purple-to-pink mesh is the exact
  cliché Nova's ±26° rule exists to prevent.
- **Don't glow anything static.** Glow means live or focused; glowing a resting
  element spends the signal for nothing.
- **Don't hardcode violet.** It's `--nova-hue: 296`, and the app must re-theme
  correctly at any hue.
- **Don't use macOS system blue** as an accent anywhere.
- **Don't use an illustration, a mascot, or a 3D render.** The aperture is the
  only drawn mark.
- **Don't animate with a spring, a bounce, or an overshoot.** One curve, five
  verbs. §1.2.
- **Don't use color to carry status alone.** Always a dot *and* a label.
- **Don't write marketing copy in the product.** No "unlock the power of", no
  "your second brain", no exclamation marks.
- **Don't use emoji.** Not in UI, not in notifications, not in the digest.
- **Don't invent a main window, a chat view, or a memory browser.** PRD §8
  forbids them.
- **Don't fill an empty state with encouragement.** "Nothing needs your
  attention right now" is complete.
- **Don't round anything past 14pt**, and don't round content containers in the
  ambient register at all.

---

## 9. Flows — screen by screen

*A conforming extension to the design.md schema. Each flow specifies: where it
sits, what the user is feeling, the layout, every state, the motion, the copy,
and the graphics. Flows A–G are onboarding, run once. Flows H–N are the daily
product, run forever.*

**Flow index**

Flows A–E are onboarding and run once. **Flow F is the product** — one panel,
opened either by ⌃⌥ or by clicking the menu-bar icon. Flows G–L are the
controls and states around it.

| | Flow | Surface | Source |
|---|---|---|---|
| A | Launch & welcome | Onboarding window | Flow 1 |
| B | The permission ceremony (×2) | Onboarding window | Flow 1, F6.2 |
| C | How it works | Onboarding window | **new** |
| D | Connect your AI *(optional)* | Onboarding window | Flow 1, Flow 7, F6.5 |
| E | First-run tour | Menu-bar overlay | Flow 1 |
| **F** | **The panel (⌃⌥ / icon click)** | **Floating panel** | **the product** |
| G | Loop actions | The panel | F4.4, Flow 5 |
| H | Status glyph & menu | Menu bar | F6.1, §2.7 |
| I | Pause & resume | Menu bar | Flow 6, F5.2 |
| J | Settings | Settings window | F6.3, F5.3, F6.5 |
| K | Error & recovery | Panel + glyph | Flow 8, shell spec §9 |
| L | Empty & edge states | The panel | Flow 5 |

**There is one loop surface, not two.** An earlier draft had a menu-bar popover
listing loops *and* a hotkey panel listing the same loops with different type
treatment — two components, two designs, and two places to keep in sync for no
user benefit. The popover is deleted. **Clicking the menu-bar icon opens the
same panel ⌃⌥ opens.** The icon's own job narrows to showing status and holding
a small menu (pause, settings, quit), which is what a menu-bar icon is good at.

**Onboarding is three steps.** Two former steps are gone:

- **Sign-in is removed.** Accounts are deferred; Nova works fully without one.
- **The capture-policy picker is removed.** Nova reads every app by default,
  except a locked category it will never read. Asking a user to triage 50 apps
  before they have seen any value was the slowest step in the flow and nobody
  meaningfully edited it. The protection it advertised survives as a stated
  disclosure (Flow B) and full per-app control lives in Settings (Flow J) for
  anyone who wants it.

---

### Flow A — Launch & welcome

**Where:** First launch, immediately after the user drags Nova to Applications.
**Before:** Nothing. **After:** Flow B (the permission ceremony).
**Emotional state:** Curious, slightly wary. They have just installed something
that watches their screen. They are looking for the catch.

#### The screen

Onboarding window, 720 × 560, **centered-narrow** composition.

```
                                            ○  ← aperture, 128pt, centered,
                                                  vertical position 132pt

              Nova remembers what you said you'd do
                          ← display, 34/600, centered

    You make dozens of small promises a day — in email, chat,
    docs, meetings. Nova notices them, keeps the list, and
    checks them off when it sees you followed through.
                          ← body, 13/400, centered, 62ch measure,
                            ink-secondary, 3 lines

              ─────────────────────────────────
                    ← hairline, 320pt wide, centered, spacing.9 above

              Everything stays on this Mac, encrypted
              Nova takes no screenshots
              No account needed
                          ← three caption lines, 11/400, ink-tertiary,
                            centered, spacing.3 apart

                        [ Get started ]
                          ← button-primary, centered, spacing.10 below

                    Read the privacy details
                          ← button-secondary text link, caption, spacing.5 below
```

#### Why this composition

The three claim lines below the rule are the most important element on the
screen, and they are deliberately in the smallest type. A welcome screen that
shouts its privacy claims in 34pt reads as defensive. Stating them quietly, as
plain facts, in the position where fine print usually goes — and having them be
*good* news — is the tonal move that sets up everything after it.

The aperture is large and alone at the top. It has nothing to say; it is just
well-made. That is the first impression Nova wants.

#### Motion

1. On window appear (`motion-considered`, 420ms): window *Develops*.
2. Aperture *Traces* — the six blades draw in sequence over 700ms, then settle
   to the open (capturing) position. This is the only place the aperture's
   construction is shown; it teaches the mark before it shrinks to 16pt forever.
3. Title *Develops*, delayed 200ms after the aperture completes.
4. Body, rule, and the three claim lines *Develop* in sequence, 60ms apart.
5. Button *Develops* last, 120ms after.

Total choreography: ~1.6s. **This is the longest sequence in the product** and
it is permitted here because it runs exactly once and because the user is
waiting to be convinced. Every subsequent screen is faster.

Under reduced motion: the whole screen appears at once with a 100ms fade.

#### Graphics

The aperture at 128pt, stroke 6pt, in `accent`, sitting on a soft three-stop
glow (§2.3) — `glow-core` at 12px, `glow-mid` at 32px, `glow-far` at 80px. The
window ground carries a very faint `grad-veil` wash behind the mark, no more
than 8% opacity, fading out by the headline.

Onboarding is the summoned register (§1), so this is one of the two places glow
belongs. Nothing else: no screenshot, no device frame, no illustration.

#### Copy

Headline is fixed: **"Nova remembers what you said you'd do"**. It names the
primary feature — open loops — in words a non-technical user understands
immediately, states a benefit rather than a mechanism, and does not mention AI,
memory, search, or connectors.

Rejected alternatives and why: *"Nova remembers, so you don't have to"* is
warmer but vaguer — it could describe a notes app. *"Your AI, with your
memory"* leads with the secondary feature and excludes every user who doesn't
use an AI assistant. **The word "AI" appears nowhere in onboarding until the
final, optional step** (§0, the hierarchy rule).

"No account needed" replaces the old "You choose which apps it can see" in the
claim list, because sign-in is removed and its absence is a genuine trust
claim worth stating. App choice is demonstrated two screens later anyway.

"Read the privacy details" opens the in-app privacy explainer, not a web page.
Opening a browser at this moment loses the user.

---

### Flow B — The permission ceremony

**This is the most important flow in the product.** It runs three times —
Accessibility, Microphone, and Screen Recording (conditional) — and it is where
Nova either earns the right to watch someone's screen or doesn't.

**Where:** The first step after welcome. **After:** Flow C (how it works).
**Emotional state:** Peak anxiety. macOS is about to show a scary system dialog
about controlling their computer. Most abandonment happens here (PRD §7 names
permission friction as a top risk).

#### The thesis: show, then ask, then show again

A conventional permission screen explains in words what it will do, then
triggers a dialog. Nova does something no competitor can: **it shows the user
the actual output of the permission, from their own machine, seconds after they
grant it — before any capture is stored.**

The honest sequencing matters, and it constrains the design:

> Accessibility permission is required *before* Nova can read anything. So the
> live preview cannot precede the grant. What precedes the grant is a precise,
> plain-language contract. What follows the grant, immediately, is the proof
> that the contract was kept.

This is not a workaround — it is better. The user grants on a promise and is
paid back within two seconds. That sequence *is* the trust ceremony.

#### The screen — split composition

```
 ○ Nova                                              Step 1 of 3

 ┌─ columns 1–5 ────────────────┐  ┌─ columns 7–12 ───────────────┐
 │  ⌘ SF Symbol, 28pt, accent   │  │                              │
 │                              │  │   BEFORE GRANT:              │
 │  Let Nova read your screen   │  │   ┌──────────────────────┐   │
 │  ← title, 22/600             │  │   │ The preview appears  │   │
 │                              │  │   │ here once you grant  │   │
 │  Nova uses macOS             │  │   │ access.              │   │
 │  Accessibility to read the   │  │   │                      │   │
 │  text in your frontmost      │  │   │  ○  ← aperture at    │   │
 │  window — the same way a     │  │   │     40pt, closed,    │   │
 │  screen reader does.         │  │   │     ink-quaternary   │   │
 │  ← body, 62ch, ink-secondary │  │   └──────────────────────┘   │
 │                              │  │                              │
 │  ✓ Reads text and window     │  │   AFTER GRANT:               │
 │    titles                    │  │   ┌──────────────────────┐   │
 │  ✓ Works with every app,     │  │   │ Chrome · 2s ago      │   │
 │    no setup                  │  │   │ ──────────────────── │   │
 │  ✗ Takes no screenshots      │  │   │ Pull request #11     │   │
 │  ✗ Cannot click, type, or    │  │   │ ████████ opened this │   │
 │    control anything          │  │   │ 3 days ago           │   │
 │  ← caption list, spacing.3,  │  │   │ ████████████ ██████  │   │
 │    ✓ in status-live,         │  │   │ Merge when ready     │   │
 │    ✗ in ink-tertiary         │  │   └──────────────────────┘   │
 │                              │  │   This is what Nova just     │
 │  [ Grant access ]            │  │   read from your screen.     │
 │  [ Skip ]                    │  │   Nothing is saved yet.      │
 └──────────────────────────────┘  └──────────────────────────────┘
```

#### The ✓/✗ contract list is the heart of it

Four lines, two of them negative. **The negative lines are the point.** "Cannot
click, type, or control anything" is the single most reassuring sentence in the
entire onboarding, because it addresses the specific fear the macOS
Accessibility dialog creates — that dialog says the app will be able to
"control your computer", which is terrifying and technically true of the API
but not of Nova's use.

Naming the fear before the OS does, and disowning the capability, is what
converts this screen.

#### The live preview — full specification

**Source:** Nova's real AX read of the user's actual frontmost window at the
moment of grant, passed through the real per-app parser (F1.1) and the real
redaction pass. Not a mock.

**Redaction in the preview is deliberately aggressive** — more than in normal
operation — because this content is rendered on a screen the user might be
screen-sharing, and because seeing *structure without content* is exactly the
lesson. Redact: anything matching an email, a phone number, a long digit run, a
URL path beyond the host, and any run of 3+ consecutive capitalized words that
is not a known app or UI string.

**Rendering:** capture preview well (§7.4), `capture` typography, redaction
blocks per §1.3, source line showing app + host + age.

**Motion:** on grant, the closed aperture in the well *Traces* open over 420ms,
then lines *Trace* in at 600 chars/sec. Redaction blocks appear with their
line, not separately. Total ~1.8s for a typical window.

**The caption below is non-negotiable:** *"This is what Nova just read from
your screen. Nothing is saved yet."* The second sentence is true — capture does
not start until the user finishes this step — and it is the reason the user tolerates
the first sentence.

#### The three instances

| | Symbol | Title | The contract's negative lines | Preview shows |
|---|---|---|---|---|
| **C1 · Accessibility** | `accessibility` | "Let Nova read your screen" | ✗ Takes no screenshots · ✗ Cannot click, type, or control anything | Redacted AX text from their frontmost window |
| **C2 · Microphone** | `mic` | "Let Nova hear your meetings" | ✗ Only records when a meeting app is using your mic · ✗ Never listens in the background | A live 2-second input-level meter and the sentence "Nova is not recording — this is just the level" |
| **C3 · Screen Recording** | `rectangle.inset.filled` | "Let Nova read one app that needs it" | ✗ Off unless you turn on a specific app · ✗ No video is ever recorded | Renders **not-applicable at 40%** unless the user enabled an OCR exception in Settings |

**C2's preview is a level meter, not a transcript**, because transcribing the
user's room to prove a point would be the opposite of trustworthy. The meter
proves the mic works and demonstrates restraint simultaneously. It is a row of
24 bars, 2pt wide, `accent`, responding to real input at 30fps.

**C3 is conditional.** PRD F6.2 says Screen Recording is requested only if a
per-app OCR exception is enabled. Since no exception can exist yet, C3 is deferred: the
card renders in the not-applicable state during onboarding, and the real
request is triggered later from Settings when an exception is first enabled.
*This document notes a discrepancy: the original user-flow spec Flow 1 lists
Accessibility twice and omits Screen Recording. Treat that as a doc bug; this
spec's sequence is Accessibility → Microphone → (Screen Recording deferred).*

#### States per card

Per §7.5: not-yet-requested · requesting (card dims to 60%, button spins, macOS
dialog is frontmost) · granted (symbol → filled check in `status-live`, card
gains a `status-live` hairline, preview populates) · denied.

**Denied** is designed carefully, because denial is recoverable and the user
must not feel they broke something:

```
 ⚠ (status-attention)
 Nova can't read your screen yet

 macOS needs you to enable Nova in System Settings.
 We'll wait here.

 [ Open System Settings ]   [ Continue without this ]
```

Nova polls the permission state every 1s while this card is shown and
transitions to granted automatically the moment it flips — the user never has
to come back and click anything. That auto-detection is a small thing that
feels like competence.

#### The scope disclosure — what replaces the app picker

The capture-policy step is gone (see the flow index), so the claim it used to
make visually must be made here in words. Beneath the two permission cards,
above the footer, sits a permanent disclosure block — not a card, not a
dialog, just a hairline-topped region:

```
 ─────────────────────────────────────────────────────────
  WHAT NOVA READS                        ← 10pt eyebrow

  Every app you use, once you grant access above.

  🔒 Except password managers, banking sites, and private
     browsing windows. Nova never reads those, and that
     can't be turned on.

  You can turn off any other app later in Settings.
 ─────────────────────────────────────────────────────────
```

Three lines: 13pt `ink-secondary` for the scope, 11pt `ink-tertiary` with an
11pt lock symbol for the locked category, 11pt `ink-tertiary` for the escape
hatch.

**Why this earns its place.** The old picker's most valuable element was never
the toggles — nobody edited them — it was the visible *"always off"* group,
which proved Nova has limits the user cannot remove. That is a far stronger
claim than any limit they could switch off themselves, and it survives here at
a fraction of the cost.

**The middle line's second clause is the whole point.** *"and that can't be
turned on"* is unusual phrasing for a product to volunteer, which is exactly
why it reads as true. Do not soften it to "is disabled by default".

**Honesty constraint:** this text is only permitted if the daemon genuinely
enforces the locked category with no user-reachable override. If that ever
becomes a preference, this copy must change the same day.

#### Skip

Every card is skippable. Skipping sets a capability chip that persists on the
final screen and in the panel's status line: `Screen reading is off` with a
[Fix] affordance. Nova never nags beyond that chip.

---

### Flow C — How it works

**Where:** Immediately after the permission ceremony. **After:** Flow D.
**Emotional state:** Committed but unproven. They have just said yes to
everything and want to understand what they said yes to.

#### What this screen is, and what it is not

It is **a static, illustrated explanation** of how a commitment becomes an open
loop. It is **not** a live capture of the user's screen.

An earlier draft specified this as a live reveal — Nova capturing their real
screen and showing a real extracted fact within seconds. That version was
dropped, for two reasons. It required driving extraction synchronously from the
UI, which the daemon has never done and which would need new work before
onboarding could ship. And it could fail in five distinct ways (quiet screen,
slow relay, offline, empty desktop, skipped permission), each needing its own
fallback copy — a lot of design and engineering surface for a screen the user
sees once, for eight seconds.

A diagram conveys the same understanding at a fraction of the cost. **The user
needs an idea of how it works, not a demonstration.**

#### The honesty constraint that shapes everything here

A static example is a marketing screen, and this audience is skeptical by
construction. The way it stays trustworthy is to be **obviously illustrative**
rather than to imitate a real capture.

So: the example content is plainly fictional, it is labelled as an example, and
it is drawn as a *diagram* — with flow arrows and captions — not as a
screenshot with a fake window chrome and a fake timestamp. A frank illustration
costs nothing. A fake screenshot that looks real and isn't is the version that
loses the user the moment they notice.

**Hard rule: no "2 seconds ago", no real app name, no rendered window frame.**
Nothing that implies this already happened to them.

#### The screen — centered-narrow, one beat

```
 ○ Nova                                              Step 2 of 3

                    How Nova finds your loops
                              ← title, 22/600, centered

    ┌─────────────────────────────────────────────────────┐
    │  EXAMPLE                     ← 10pt eyebrow,        │
    │                                 ink-tertiary        │
    │  ┌───────────────────────────────────────────────┐  │
    │  │ You write, in a message:                      │  │
    │  │                                               │  │
    │  │   "I'll send the Q3 deck by Friday"           │  │
    │  │        ← capture type, 11pt SF Mono,          │  │
    │  │          on surface-sunken                    │  │
    │  └───────────────────────────────────────────────┘  │
    │                       ↓                             │
    │            Nova reads it and notices                │
    │            a commitment      ← 11pt caption         │
    │                       ↓                             │
    │  ┌───────────────────────────────────────────────┐  │
    │  │  YOU SAID YOU WILL      ← 10pt label          │  │
    │  │  send the Q3 deck        ← 13pt/600           │  │
    │  │  by Friday               ← 11pt meta          │  │
    │  └───────────────────────────────────────────────┘  │
    │      ← rendered as a real panel row, accent         │
    │        hairline, faint glow                         │
    │                       ↓                             │
    │            When Nova sees you send it,              │
    │            the loop closes itself                   │
    └─────────────────────────────────────────────────────┘

    Press ⌃⌥ any time to see what's still open.
                              ← 13pt, ink-secondary, centered

    Nova sends the text it reads to Google (Gemini) to do this.
    Nothing is stored there. Everything else stays on this Mac.
                              ← 11pt caption, ink-tertiary, 62ch

                          [ Continue ]
```

#### Why the middle element is a real panel row

The extracted loop is drawn **exactly as it will appear in the panel** — same
type, same label, same accent bar and glow. The user is being taught to
recognize a shape they will see for the rest of the product's life, and this is
the cheapest possible place to teach it.

Everything else on the screen is diagram. That one element is product.

#### The third line is the whole point

*"When Nova sees you send it, the loop closes itself"* is the feature users do
not expect and would never guess. Extraction is plausible; auto-resolution is
the surprising part, and it is what separates Nova from a to-do list. It gets
its own step in the diagram rather than being folded into a sentence.

#### The relay disclosure stays

The closing caption naming Google (Gemini) survives from the earlier draft.
It is the one place in onboarding where the user is told, in plain words, what
leaves the machine and who touches it — and it reads better beside a concrete
example than as an abstract claim. Do not move it to a tooltip, shorten it, or
soften "Nothing is stored there".

#### Motion

Modest, and it runs once on screen entry. The three diagram stages *Develop* in
sequence, 180ms apart, with the two arrows *Tracing* between them. The panel-row
element *Blooms* its glow faintly as it arrives — the only glow on the screen,
which is what makes it read as the product rather than the diagram.

Total ~900ms. Under reduced motion everything appears at once.

#### States

There are none. No loading, no failure, no empty variant, no timeout — this is
a static screen and it renders identically every time. That is the point of the
change: the earlier live version needed five failure states, and removing it
removed all of them.

**Skipped-permission case:** if Accessibility was skipped, the screen still
shows — understanding how Nova works is *more* useful to someone who hasn't
granted yet, not less. The [Continue] button is unchanged. A single 11pt line
appears above it: *"Turn on screen reading to start finding these."* with a
[Fix] link.

---

### Flow D — Connect your AI *(optional)*

**Where:** After the how-it-works screen. **After:** Flow E (the tour).
**Emotional state:** Convinced; now impatient. This is the last step.

#### The design decision: Nova Cloud is the default, and the alternative is one click away

Nova's own hosted relay is already connected when this screen appears. The user
has to do nothing to have a working connector. **But the self-hosted /
custom-backend path (F6.5) is exposed here, in place, rather than buried in
Settings → Advanced** — because the people who want it are exactly the people
evaluating Nova's privacy claims right now, and making them hunt for it after
onboarding wastes the moment where it matters.

The disclosure is collapsed by default so it costs the other 95% of users
nothing against the 3-minute budget (F6.2).

#### The screen — centered-narrow with connector cards

```
 ○ Nova                                              Step 3 of 3

                    Connect your AI

    Nova is ready. Add it to the AI you already use.
                        ← body, ink-secondary

    ┌──────────────────────────────────────────────┐
    │ ● Connected to Nova Cloud                    │  ← status-live dot,
    │   Your memory stays on this Mac. The relay   │     body-emphasis
    │   passes queries through without storing.    │  ← caption
    │                                              │
    │                          Use my own backend ▾│  ← button-secondary,
    └──────────────────────────────────────────────┘     caption, right

    ─────────────────────────────────────────────────

    CLAUDE DESKTOP                       ← label eyebrow
    Paste into claude_desktop_config.json
    ┌──────────────────────────────────────────────┐
    │ "nova": {                                    │  ← capture typography,
    │   "command": "/Applications/Nova.app/…"      │     surface-sunken well
    │ }                                            │
    └──────────────────────────────────────────────┘  [ Copy ]

    CLAUDE CODE  ·  CURSOR  ·  CLAUDE.AI (WEB)     ← tabs, caption

                  [ Test connection ]     [ Finish ]
```

#### The expanded "use my own backend" state

Expands **in place**, pushing content down — never a new screen, never a modal,
because the user must not lose their place in the last step of onboarding.

```
    ┌──────────────────────────────────────────────┐
    │ ● Connected to Nova Cloud                    │
    │                                              │
    │   ○ Nova Cloud (recommended)                 │  ← radio
    │   ● My own backend                           │
    │                                              │
    │   Backend URL                                │
    │   ┌────────────────────────────────────────┐ │
    │   │ https://nova.example.com               │ │
    │   └────────────────────────────────────────┘ │
    │   ● Connected · API v2 · self-hosted         │  ← status line
    │                                              │
    │   Self-hosting uses your own Gemini and      │
    │   Deepgram keys. Billing is off; everything  │
    │   is entitled.                               │  ← caption, ink-tertiary
    │                                              │
    │                        Set up guide →        │
    └──────────────────────────────────────────────┘
```

#### States of the backend field

| State | Status line | Behavior |
|---|---|---|
| Idle | none | Field empty, placeholder `https://nova.example.com` |
| Validating | `status-paused` dot, "Checking…" | Debounced 600ms after typing stops; spinner in field trailing edge |
| Connected | `status-live` dot, "Connected · API v2 · self-hosted" | Version from the handshake (Flow 11 step 3) |
| Version skew | `status-attention` dot, "Backend is API v1 — Nova will use v1 features only" | Per Flow 11 edge case. Not an error; Nova pins and continues. |
| Unreachable | `status-error` dot, "Can't reach that host" | Field gets a `status-error` hairline |
| Not a Nova backend | `status-error` dot, "That host isn't running Nova" | Distinguished from unreachable, because the fix is different |

Switching the radio back to Nova Cloud keeps the typed URL (does not clear it),
so a user experimenting can toggle without retyping.

#### Test connection

Runs a real `search_memory` round trip. Three outcomes, all shown inline as a
toast: success (`status-live`, "Connected — your AI can reach Nova"), no client
detected ("Paste the config first, then test"), failure (the specific error).

#### Settings mirror

The exact same component renders in Settings → Connection. One component, two
mount points — this is a note to implementers, not two designs.

---

### Flow E — First-run tour

**Where:** After Finish. The onboarding window closes.
**After:** Nova is running. **Emotional state:** Done; do not detain them.

#### The single most important thing onboarding does

**Teach ⌃⌥.** A user who leaves onboarding without the hotkey in their hands
has no way to reach the product — they will discover the menu-bar glyph
eventually and think Nova is a status icon. The tour exists mainly to plant
that chord, and it makes the user *press it* rather than reading about it.

#### Four beats, ~15 seconds, fully skippable

The window *Dissolves*, and the aperture performs a shared-element transition
from the window's top-left into the menu bar, shrinking 32pt → 16pt over 520ms
along an arc, its glow fading out as it goes — the mark visibly leaves the
summoned register and enters the ambient one.

**This is the most valuable animation in the product**, because the number-one
confusion with menu-bar apps is "where did it go?" — and this answers it
physically.

Then the tour, in a 240pt overlay styled like the panel (dark, glass, rimmed) so
the user already recognizes the surface when they summon it for real:

| Beat | Copy | Treatment |
|---|---|---|
| 1 | "Nova lives here now. It's reading your screen." | Anchored to the glyph, a 3pt accent ring *Traces* around it |
| 2 | **"Press ⌃⌥ to see what you owe people."** | The chord rendered large — 28pt key caps, centered. **The overlay waits.** No Next button. |
| 3 | *(fires the instant they press it)* The real panel *Develops* in the center of the screen, showing their actual loops or the empty state. Overlay copy beneath: "That's it. From anywhere, any app." | The payoff |
| 4 | "Nova will be quiet unless something needs you." | No anchor; centered. [Done] |

#### Beat 2 waits, and that is the design

It does not auto-advance. It sits there with two key caps on screen until the
user presses the chord, because **a hotkey learned by pressing is retained and
a hotkey learned by reading is not.** A small `Skip` link in 11pt is available
for anyone who refuses, and after 20 seconds an 11pt line appears beneath:
*"Hold Control and Option together."*

This is the only place in Nova that blocks on a user action, and it is worth
it exactly once.

#### Beat 4's promise

*"Nova will be quiet unless something needs you"* is the product's entire
philosophy and the last thing onboarding says. Every later design decision has
to keep it — which is why the tour never repeats, and why Nova has no tips, no
what's-new modals, and no re-engagement prompts anywhere.

A "Show tour again" item lives in the gear menu. The hotkey is also printed in
the menu-bar icon's right-click menu permanently, for anyone who forgets.

---

### Flow F — The panel *(⌃⌥ or the menu-bar icon — the only surface)*

**Where:** Anywhere. Summoned two ways: holding **⌃⌥** from any app, or
**clicking the menu-bar icon**. Both open the same panel in the same place.
**Surface:** A 440pt floating panel, centered horizontally, 32% from the top of
the active display.
**Sits:** This is the product. Everything else is setup, status, or controls.
**User feels:** A quick check. "What am I still on the hook for?" They want an
answer in two seconds and to be gone.

#### One surface, two doors

An earlier draft had two loop lists — a menu-bar popover and a hotkey panel —
which meant two components rendering the same data with different type
treatment, kept in sync by hand. There was no user benefit: nobody needs two
ways to read the same list, they need two ways to *reach* it.

So the panel is the only loop surface, and both entry points open it centered:

| Entry | Who uses it |
|---|---|
| **⌃⌥** | The fast path. Hands already on the keys, works from inside whatever app just reminded them of a commitment. |
| **Click the menu-bar icon** | The discoverable path. For users who haven't learned the chord, and for mouse-first users who never will. |

**Clicking the icon does not open an anchored popover.** It opens the same
centered panel. A dark glass panel anchored under a 16pt corner icon would
fight the platform's popover convention and force a second visual treatment for
no reason. Centered is also simply easier to read.

The menu-bar icon keeps its own job — showing status, and holding a small
native menu on right-click for pause, settings, and quit (Flow H). That is what
a menu-bar icon is good at, and it is all it does now.

#### The header carries the status readout

Since there is no popover, the status the popover used to show — capturing or
paused, and the day's capture count — lives in the panel header. It is the
first line of the only surface, which is a better home for it than a
corner-anchored panel the user opened for a different reason.

#### The screen

```
        ╭──────────────────────────────────────────────╮
        │  ○  OPEN LOOPS                          3    │ ← 52pt header:
        │     capturing · 12 today                     │   aperture (glowing),
        ├──────────────────────────────────────────────┤   label, count, status
        │                                              │
        │  ▸ merge PR #11                              │ ← 56pt rows
        │    you said · Dana Reyes · 2d                │
        │                                              │
        │    the scaffolding CLI update               │
        │    owed to you · Dana Reyes · 2d             │
        │                                              │
        │    whether the template setup was tested     │
        │    unanswered · Dana Reyes · 1d              │
        │                                              │
        ├──────────────────────────────────────────────┤
        │  ↑↓ move   ⏎ done   S snooze   esc close     │ ← 34pt footer
        ╰──────────────────────────────────────────────╯
```

440 × content height, max 420pt then scrolls. `xl` (14pt) radius.

#### The ground — Nova's most expressive surface

Dark in both appearances (§2.5). Three layers, back to front:

1. **Glass base.** A translucent dark layer over a heavy backdrop blur (macOS
   `NSVisualEffectView`, `.hudWindow` material). Whatever the user was looking
   at is still faintly present behind it — which is what makes it read as a
   heads-up display rather than a window.
2. **Gradient ground.** A two-stop linear gradient at 145°, `grad-from-dark` →
   `grad-to-dark` (hue `H−26°` → `H+26°`), at 34% opacity over the glass. Low
   internal contrast — felt, not seen (§2.4).
3. **Ambient glow.** A large radial `glow-far` bloom behind the header's
   aperture, 180pt radius, bleeding downward. This is the light source the
   whole panel appears to be lit by, and everything else's glow should look
   consistent with it coming from there.

A 1px hairline at `oklch(0.72 0.08 H / 0.18)` rims the entire panel — a bright
edge catching the light, which is what stops glass from looking like a flat
translucent rectangle.

**No gray drop shadow.** The panel separates from its backdrop by glow and rim,
not by a shadow (§5).

#### Rows

| Element | Treatment |
|---|---|
| Description | 13pt/600 in `ink-primary-dark` — the thing the eye hits first |
| Meta line | 11pt in `ink-tertiary-dark`: `you said · Dana Reyes · 2d`, lowercase, dot-separated |
| Direction | Carried in the meta line's first token: `you said`, `owed to you`, `unanswered`, `stalled`. Lowercase, because at 56pt rows an uppercase eyebrow per row would stripe the list |
| Focused row | `accent-wash-dark` fill, a 2pt `accent` bar on the leading edge, and a `glow-mid` bloom behind the row. This is the only glowing element besides the header aperture |

**Exactly one row is focused at all times**, starting with the first. This is a
keyboard surface before it is a mouse surface — the user summons it with a
chord, so their hands are already on the keys.

#### Keyboard — the primary interaction

| Key | Action |
|---|---|
| `↑` `↓` | Move focus. Wraps at both ends. |
| `⏎` | Mark the focused loop done |
| `S` | Snooze the focused loop (opens the inline menu) |
| `⌫` | Dismiss, with inline confirmation |
| `esc` | Close |
| `⌃⌥` (again) | Close |
| `1`–`9` | Jump to that row and focus it |

The mouse works identically — hover moves focus, click acts — but the footer
advertises keys, because a user who learns them never touches the mouse again.

#### The footer is a teaching surface

`↑↓ move   ⏎ done   S snooze   esc close` in 11pt `ink-quaternary-dark`. It is
the lowest-contrast text in the product, and deliberately so: present for the
first dozen summons, invisible thereafter. It never changes, never animates,
and is never hidden — a persistent, ignorable legend.

#### Summon and dismiss

**Summon** (`motion-base`, 240ms): the panel *Develops* — opacity 0→1, scale
0.96→1.00, origin at its own center — while its glow *Blooms* from nothing to
resting. There is no slide, no drop, no spring. It fades up in place, already
lit.

The backdrop behind it does **not** dim. Dimming the user's screen for a
two-second check is heavy-handed and makes the panel feel modal, which it isn't.

**Dismiss** (`motion-quick`, 140ms): *Dissolve*, no drift, glow going first so
the panel visibly stops being lit before it stops being visible.

**Acting on the last loop closes the panel automatically** after a 400ms beat,
with the empty state visible for that moment. Clearing your list should end
with the window getting out of the way.

#### The resolve moment — the product's emotional center

When a loop is marked done in the panel:

1. The row's glow *Blooms* to `glow-core` at 1.4× radius over 120ms — a flare.
2. The row *Dissolves* over 240ms while drifting 2pt up.
3. Rows below *Settle* into the gap.
4. The header count *Settles* from 3 to 2.
5. Focus moves to the next row.

**The flare is the one indulgence in the entire product**, and it is justified:
this is the single moment where the user completes something, and it lasts
120ms. No checkmark, no sound, no confetti — a brief brightening and then the
thing is gone.

#### States

| State | Rendering |
|---|---|
| Loops present | As above |
| Empty | Aperture at 32pt in `ink-quaternary-dark`, centered, above 13pt `"Nothing open. You're clear."` Panel shrinks to 180pt tall. No footer legend. |
| Paused | A 11pt `status-paused` line under the header: `Nova is paused · resumes in 47m`. Loops still listed and still actionable. |
| Daemon down | Aperture in attention form, 13pt `"Nova isn't running"`, and an 11pt line `"Restarting…"`. No rows. |
| Loading (first summon after wake) | Three skeleton rows at 40% opacity, no glow, replaced by real rows as they arrive. Max 400ms before rows or empty state. |
| Overflow (>6 loops) | Scrolls. Top and bottom edges get a 24pt fade to the ground. Focused row always scrolls into view. |

#### What the panel does not do

No search field, no tabs, no settings, no timeline, no filters, no counts by
category, no "completed today" section. **It answers one question.** Future
features arrive as new modes in this window only after they earn it; the
temptation to add a second thing here should be resisted hard, because the
panel's entire value is that it can be read in one glance.

---

### Flow G — Loop actions

**Where:** In the panel, per row. **Source:** F4.4, shell spec §7.

#### Done

Tap → row *Dissolves* immediately (optimistic, shell spec §8) → rows below
*Settle* up → section count *Settles* from (3) to (2) → `act_on_loop` fires.

On `ok: false`: the row *Develops* back at its original position with an inline
`caption` in `status-error` ("already resolved"), held 4s, then the caption
*Dissolves* while the row stays.

**No checkmark, no toast, no sound, no confetti.** The reflow is the reward.

#### Snooze

Tap the `▾` → a small `NSMenu`: **Tomorrow 9am** (default, matches the daemon's
next-09:00-local rule) · This weekend · Next week · Pick a date…

"Pick a date…" opens a compact `NSDatePicker` in a sub-popover. On selection,
the row *Dissolves* with a toast: "Snoozed until Tuesday 9am · Undo". Undo is
available for 8s and is the only undo in the product.

#### Dismiss

**Requires inline confirmation**, because it is permanent by design and the
daemon's `dedup_key` means the loop can never return (shell spec §7):

Tap dismiss → the row's action bar is replaced in place by
`Dismiss permanently? [yes] [cancel]` in `caption`. No modal, no dialog. Yes →
row *Dissolves*. Cancel → actions *Develop* back.

The word "permanently" appears because the behavior is permanent and hiding
that would be the kind of thing that erodes trust when discovered.

#### Keyboard & VoiceOver

Arrow keys move between rows; `D` done, `S` snooze, `⌫` dismiss (with the same
confirm). Every row is a single VoiceOver element announcing direction,
description, counterparty, and age as one phrase, with the three actions as
rotor items. Action buttons are always in the accessibility tree regardless of
hover.

---

### Flow H — Status glyph & menu

**Where:** The menu bar. **Surface:** A 16pt template image, plus a native
`NSMenu`.
**Sits:** Always present. This is Nova's ambient register, and since the
popover was deleted it is the entire ambient surface.

#### The icon's two jobs

1. **Show status** — capturing, paused, or attention — through the aperture's
   form. Fully specified at §7.1.
2. **Open things** — the panel on left-click, a small menu on right-click.

It no longer lists loops, shows a count, or holds a settings pane. Those went
to the panel (Flow F) and Settings (Flow J).

| Interaction | Result |
|---|---|
| **Left-click** | Opens the panel (Flow F), centered — identical to ⌃⌥ |
| **Right-click** | Opens the menu below |
| **Hover** | Standard menu-bar highlight. No tooltip — the glyph's form already carries state, and a tooltip would say what the panel says better. |

#### The menu

A native `NSMenu`, unstyled. Nova contributes wording and grouping, not chrome.

```
  Open Nova                    ⌃⌥
  ─────────────────────────────────
  Pause capturing              ▸     30 minutes
  ─────────────────────────────────    1 hour
  Settings…                    ⌘,      Until tomorrow
  ─────────────────────────────────    Until I resume
  Quit Nova                    ⌘Q
```

**"Open Nova" is first, and shows the chord.** It is redundant with left-click
— which is the point. A user who right-clicked to look for something is shown
the shortcut at the moment they are looking, which is how the chord gets
learned by people who skipped the tour.

**While paused**, the first pause item becomes **"Resume capturing"** with no
submenu, and a disabled item above it reads `Paused · resumes in 47m`, counting
down. A disabled menu item as a status readout is a standard macOS idiom and
costs nothing.

**When the daemon is down**, a disabled item reads `Not running · restarting…`
and a **Restart Nova** item appears beneath it.

#### Why no rich popover

A menu-bar popover would be a third visual treatment — after the panel and the
onboarding window — for content that already has a home. The native menu is
instantly familiar, needs no design, renders correctly in every appearance and
accessibility setting for free, and cannot drift out of sync with the panel
because it holds no loop data at all.

---

### Flow I — Pause & resume

**Right-click the glyph** → `NSMenu`:

```
  Pause capturing         ▸   30 minutes
  ─────────────────           1 hour
  Open logs                   Until tomorrow
  Launch at login   ✓         Until I resume
  ─────────────────
  Quit Nova
```

On pause: glyph aperture *closes* over 420ms (the shutter) — this is the
transition the aperture mark exists for. No toast is shown; the glyph itself is
the feedback, and it is unmistakable.

Header copy becomes `○ Paused · resumes in 47m`, counting down, *Settling* each
minute.

**Auto-pause** (screen sharing, private browsing, per F5.2) shows a transient
macOS notification — the only unprompted notification besides the digest —
reading "Nova paused — you're sharing your screen". It auto-resumes and shows
no notification on resume, because resuming is the expected state.

---

### Flow J — Settings

The menu-bar icon's right-click menu holds the two settings that exist today,
and a "Settings…" item opening a standard window for the rest as they land.

**Today (shell spec §4 In):** Launch at login ✓ · Open logs · Show tour again ·
Quit.

**The settings window**, when it exists, is a standard macOS preferences window
with a toolbar — not a custom surface. Groups: General · Capture · Privacy ·
Connection · Advanced. Nova contributes copy and grouping here, not chrome.

**Capture → Apps** is where the removed onboarding picker now lives, and it is
the same component that screen used: a scrolling `NSTableView` of installed
apps, each row carrying the app icon at 28pt, its name in 13pt, its bundle
identifier in 11pt tertiary ink, and a switch. Everything defaults to on.

The list ends with a **Never observed** group — password managers, banking
apps, private browsing — whose switches render disabled in the off position
with a lock symbol and the caption "always off". Hovering the lock shows:
*"Nova never observes this category."*

That group is the reason this pane is worth designing carefully even though
few users will open it: it is where a skeptical user goes to verify the claim
onboarding made, and finding it exactly as promised is what converts a claim
into trust.

**Delete memories** (F5.3, Flow 6) is the one screen in Settings that needs
design care:

```
  Delete memories

  ○ A time range      [ Sep 1 ] to [ Sep 21 ]
  ○ One app           [ Slack ▾ ]
  ○ Everything

  ┌──────────────────────────────────────────────┐
  │ This removes 1,284 memories from Sep 1–21.   │  ← body-emphasis
  │ It cannot be undone.                         │  ← body, status-error text
  └──────────────────────────────────────────────┘

  [ Delete 1,284 memories ]     ← button-primary, but filled status-error
```

The count is computed live and named in the button label. For "Everything", the
button is disabled until the user types `DELETE` in a field (Flow 6 step 3).
On completion: a toast with the final count. This is the only place
`status-error` is used as a fill, and it is justified.

---

### Flow K — Error & recovery

Every failure has a visible consequence (shell spec §9). Design per case:

| Failure | Glyph | Panel | Recovery |
|---|---|---|---|
| Daemon not running | attention | Header: "Nova isn't running — restarting…" with an indeterminate progress hairline under the header | Automatic |
| Daemon crash-loop past cap | attention | Header in `status-error`, last stderr line in `caption` below it, [Restart] button | Manual |
| Permission revoked (Flow 8) | attention | "Screen reading is off — memory has a gap since 2:14 pm" + [Fix] | [Fix] deep-links the System Settings pane; Nova polls and auto-recovers |
| Socket timeout | attention | Same as not-running | Automatic reconnect |
| One loop undecryptable | unchanged | Row omitted; count reads "3, 1 unreadable" | Logged, rest served |
| Offline | capturing | Header: "Capturing offline · 14 queued" | Drains when the network returns |

**Design rule for all of them:** the message says what happened, when, and what
Nova is doing about it. The gap notice naming a time ("since 2:14 pm") is
better than "some memories may be missing" — a precise loss is trustworthy, a
vague one is alarming.

---

### Flow L — Empty & edge states

| State | Copy | Graphic |
|---|---|---|
| No open loops | "Nothing needs your attention right now" | The aperture at 32pt, `ink-quaternary`, centered above. Nothing else. |
| First day, no loops yet | "Nova is still learning your week. Loops usually appear after a day or two." | Same |
| Capture paused, loops exist | Loops still listed; header shows paused | — |
| All permissions denied | "Nova can't see anything yet" + [Set up] returning to Flow B | Aperture, closed |
| Loops exist but all snoozed | "3 loops snoozed until tomorrow" in `caption` below the empty message | — |

**No empty-state illustration, ever.** The aperture at low contrast is the only
graphic. Flow 5's rule — "zero open loops → no notification (silence is the
feature)" — extends to the visual: an empty Nova should feel like a clear desk,
not like an app waiting to be fed.

---

## 10. Open items

1. **Flow C is new but no longer blocking.** "How it works" is not in
   the original user-flow spec and should be added to it. It was originally
   specified as a live capture of the user's own screen; that was dropped
   (2026-09-22) because it needed synchronous extraction the daemon has never
   done and carried five failure states. The static version needs no new
   capability and no decision — only a line in the flows doc.
2. **the original user-flow spec Flow 1 lists Accessibility twice** and omits Screen
   Recording. This spec treats that as a doc bug and sequences Accessibility →
   Microphone → (Screen Recording deferred until an OCR exception is enabled).
   The flows doc should be corrected.
3. **The glyph animation needs a measured CPU number** before the breathing
   animation ships. §7.1 sets the budget at 0.1% and names the fallback.
4. **The aperture needs to be drawn properly**, once, by someone who can make
   six arcs look machined at 16pt. Every mockup until then uses a placeholder
   ring.
5. **Notification design (F4.3 digest).** Settled: the digest card is the
   notification. There is no separate macOS notification.

---

## Appendix A — Generation prompts

*One self-sufficient prompt per screen, written for **Claude Design**
(`mcp__claude-design__*`). Each prompt stands alone: it restates what Nova is,
what the screen does, where it sits, how it looks, how it moves, and what the
user should feel. You can paste any single prompt into a fresh Claude Design
project without this document and get a correct screen.*

### How to use these

1. **Create the project once** — `create_project`, then write `DESIGN.md` into
   it using this document's YAML front matter verbatim. Claude Design reads
   the bound design system before designing, so the tokens govern every screen
   without being restated in each prompt.
2. **Run A6 first.** The ⌃⌥ panel is the primary surface and establishes the
   summoned register — the gradient ground, the glow layering, and the rim
   light that onboarding then echoes. Everything else is easier once it exists.
   Then A1 onward in order.
3. **Every prompt produces both appearances.** Ask for light and dark as two
   frames in one `.dc.html` canvas file unless the prompt says otherwise.
4. **Deliverable format:** `.dc.html` per the Claude Design component format,
   one file per flow, with `data-screen-label` on each frame.
5. **Verify each one** through Claude Design's render/verify loop before moving
   to the next — a screen that looks right in description can clip at 720pt.

### The preamble

**Every prompt below assumes this preamble is prepended.** When pasting a
single prompt standalone, include it.

> **Product context — Nova.** Nova is a macOS app that watches what you do on
> your Mac and **keeps track of what you owe people**. You make dozens of small
> promises a day — "I'll send that Friday", "let me check and get back to you" —
> across email, chat, docs, and meetings. Nova notices them, tracks them as
> **open loops**, and closes them automatically when it sees you followed
> through. **Press ⌃⌥ from anywhere and a small dark panel appears showing
> what's still open.** That panel is the product.
>
> Underneath, Nova builds a private encrypted memory on the user's own Mac,
> which also lets it answer an AI assistant's questions about the user's work.
> That is a **secondary, optional** capability for power users. **Never lead
> with it.** The primary user is someone in Gmail, Sheets, and PowerPoint who
> has never heard of an API — no screen may assume otherwise, and the words
> *MCP*, *connector*, or *LLM* appear on exactly one screen in the whole
> product (the final, optional onboarding step).
>
> **Design direction — "instrument, not app", in two registers.** Nova runs two
> visual registers, and which applies depends entirely on whether the user
> asked to see the surface:
> - **Ambient** (the 16pt menu-bar glyph and its native menu): quiet, flat,
>   monochrome, **no glow, no gradient, no custom chrome**. Seen constantly, so
>   it must never demand attention.
> - **Summoned** (the ⌃⌥ panel, onboarding): expressive. Dark glass grounds,
>   violet gradients, real three-stop glow, depth. Seen on purpose, so it can
>   be beautiful.
>
> **Three owned signatures.** (1) **The aperture mark** — a six-blade
> camera-iris circle that opens when capturing and closes when paused; it glows
> in the summoned register and is flat monochrome in the ambient one. (2)
> **Ink-and-trace motion** — nothing slides, bounces, or springs; things
> *develop* (opacity + scale 0.96→1), *settle*, *trace*, *dissolve*, or *bloom*
> (glow rising then settling), all on one curve
> `cubic-bezier(0.32, 0.72, 0.28, 1.00)` at 140/240/420ms. (3) **The redaction
> aesthetic** — captured text in SF Mono 11pt with withheld spans as solid ink
> blocks, like a declassified document.
>
> **Color — one hue drives everything.** `--nova-hue: 296` (violet). Every
> accent, glow, gradient stop, wash, and hover derives from it by formula, in
> oklch:
> `accent` = `oklch(0.548 0.196 296)` light / `oklch(0.706 0.176 296)` dark ·
> `accent-wash` = `oklch(0.962 0.028 296)` / `oklch(0.288 0.072 296)` ·
> glow stops = `oklch(0.648 0.232 296 / 0.56 | 0.24 | 0.10)` ·
> gradients travel **only** `H−26°` → `H+26°`, i.e. `oklch(0.468 0.162 270)` →
> `oklch(0.388 0.166 322)` on dark.
> Neutrals carry 0.002–0.010 chroma at the same hue, so the grays are
> violet-tinted. **Never hardcode violet as a hex** — every value is derived, so
> the app can re-theme to any hue by changing one number. **Never use macOS
> system blue.**
>
> **Glow rules.** Always the accent hue, never gray/white/red/green. Always
> three layered stops (tight 8–12px, mid 24–32px, far 64–80px) — a single-stop
> glow looks like a cheap CSS shadow. Only in the summoned register. Only on
> things that are **live or focused**. Never behind body text.
>
> **Gradient rules.** Two stops max, a 52° hue arc (±26°), ≤0.06 lightness
> difference between stops — felt, not seen. Backgrounds only, never on a
> button, row, chip, or text. Always veiled where text sits. A purple-to-pink
> mesh gradient is the exact cliché these rules exist to prevent.
>
> **Hard rules.** **No gray drop shadows anywhere** — in the summoned register
> depth is glow and rim-light; in the ambient register it is 1px hairlines and
> surface steps. If you write `box-shadow: 0 4px 12px rgba(0,0,0,…)`, it is
> wrong. No illustrations, mascots, or 3D — the aperture is the only drawn
> mark. No emoji. No rounded corner above 14pt. Sentence case; UPPERCASE only
> for 10pt `+0.064em` section eyebrows. Never use the words *record*, *monitor*,
> *track*, *surveil*, *seamless*, *effortless*, *magic*. Status is never carried
> by color alone — always a 7px dot plus a text label. Status colors (green /
> amber / red) are the only colors that do **not** derive from the theme hue.
>
> **Typography.** System faces only: SF Pro Display ≥22pt, SF Pro Text below,
> SF Mono for captured content. No webfont. Scale: 34/600, 22/600, 15/600,
> 13/400, 13/600, 11/400, 10/600 `+0.064em` uppercase.
>
> **Appearance.** Design light and dark for everything — **except the ⌃⌥ panel,
> which is dark in both**, because a summoned overlay must read as a distinct
> object and violet glow needs a dark ground.
>
> **Tone.** Candid, precise, quiet. The user is looking for the catch. Plain
> facts beat reassuring adjectives. State what Nova *cannot* do as prominently
> as what it can.

### A1 — Welcome screen

**Flow:** A. **Surface:** Onboarding window, 720 × 560pt, fixed, not resizable.
**Sits:** The very first thing a user sees, before sign-in.
**User feels:** Curious and wary — they just installed something that watches
their screen, and they're looking for the catch.

Design a centered-narrow welcome screen.

**Composition, top to bottom, all centered, max content width 460pt:**
the aperture mark at 128pt with 6pt stroke in the **accent** color, sitting on
a three-stop glow (12px / 32px / 80px) with a very faint violet wash behind it
at no more than 8% opacity fading out by the headline — onboarding is the
summoned register, so this is one of only two places glow belongs — positioned
132pt from the top; a 34pt/600 headline at -0.021em tracking reading **"Nova
remembers what you said you'd do"**; a three-line 13pt body paragraph in
secondary ink at a 62-character measure: *"You make dozens of small promises a
day — in email, chat, docs, meetings. Nova notices them, keeps the list, and
checks them off when it sees you followed through."*; 32pt of space; a
320pt-wide 1px hairline; then three 11pt caption lines in tertiary ink, 6pt
apart: *"Everything stays on this Mac, encrypted"*, *"Nova takes no
screenshots"*, *"No account needed"*; 40pt of space; a primary
button reading **"Get started"** (accent fill, white text, 32pt tall, 5pt
radius); and below it a 11pt secondary text link **"Read the privacy details"**.

**The critical detail:** the headline names the primary feature — remembering
commitments — in words a non-technical person understands instantly. The words
"AI", "memory", "search", and "connector" must not appear on this screen. And
the three privacy claims must be the *smallest* type on the screen, sitting
where fine print normally goes. A welcome screen that
shouts its privacy claims reads as defensive; stating them quietly as plain
facts — and having them be good news — is the tonal move the whole product
depends on. Do not enlarge or emphasize them.

**The aperture:** six circular-arc blades, rotationally symmetric at 60°, in the
open position (opening ≈62% of outer diameter). It reads simultaneously as a
camera iris, an eye, and the letter O. Draw it cleanly with simple arcs — if a
clean six-blade iris isn't achievable, draw a precise ring with a single notch
and label it as a placeholder rather than producing a messy one.

**Animation (specify in the file; use CSS with `prefers-reduced-motion`
guards):** on load, the window fades in over 420ms; the aperture's blades
*trace* in sequence over 700ms, drawing along their own paths and settling into
the open position; 200ms later the headline fades and scales 0.96→1; then body,
hairline, and the three caption lines follow in 60ms increments; the button
last, 120ms after. Total ~1.6 seconds. This is the longest animation in the
entire product and is permitted only because it runs once. Under
`prefers-reduced-motion: reduce`, everything appears together with a 100ms fade.

**Deliver:** light and dark frames side by side in one canvas file.

---

### A2 — Permission ceremony: Accessibility

**Flow:** C1. **Surface:** Onboarding window, 720 × 560. **Step 1 of 3.**
**Sits:** After sign-in, before the microphone ask.
**User feels:** *Peak anxiety.* macOS is about to show a system dialog saying
this app can "control your computer". This is where most people quit. This
screen either earns the right to read someone's screen or loses them.

**This is the most important screen in the product. Give it the most care.**

Design a two-column split: explanation left (columns 1–5 of a 12-column grid,
56pt outer margin), live preview right (columns 7–12), both top-aligned 96pt
from the top.

**Left column:** an `accessibility` SF Symbol at 28pt in the accent color; a
22pt/600 title **"Let Nova read your screen"**; a 13pt body paragraph in
secondary ink at 62-char measure: *"Nova uses macOS Accessibility to read the
text in your frontmost window — the same way a screen reader does."*; then a
four-item contract list in 11pt with 6pt spacing, two positive and two
negative:
> ✓ Reads text and window titles
> ✓ Works with every app, no setup
> ✗ Takes no screenshots
> ✗ Cannot click, type, or control anything

Checks in `oklch(0.642 0.112 158)`, crosses in tertiary ink. Then a primary
button **"Grant access"** and a secondary **"Skip"**.

**The critical detail:** the two negative lines are the entire point of this
screen. "Cannot click, type, or control anything" directly disowns the scary
capability that macOS's own dialog is about to claim. Naming the user's fear
before the OS does, and refusing the power, is what converts this screen. Give
those lines equal visual weight to the positives — do not de-emphasize them.

**Right column — the live capture preview well:** a sunken-surface container,
8pt radius, 16pt padding, max 200pt tall. Design it in two states as two
frames:

*Before grant:* a 40pt aperture in its **closed** position, in the lightest ink,
centered, with 11pt tertiary text: *"The preview appears here once you grant
access."*

*After grant:* a header line in 11pt tertiary ink reading `Chrome ·
docs.google.com · 2s ago`, a hairline, then 5–6 lines of **redacted captured
text** in SF Mono 11pt — real-looking UI text with roughly 30% of the spans
replaced by solid ink blocks at x-height (11px tall, 3pt radius, 100% opacity
primary ink), sized to the words they replace. For example: `Pull request #11`
/ `████████ opened this 3 days ago` / `████████████ ██████` / `Merge when
ready`. Below the well, two lines of 11pt tertiary text: **"This is what Nova
just read from your screen. Nothing is saved yet."**

**The redaction blocks are Nova's signature visual** — they make it look like a
declassified document, which is a visual idiom everyone reads instantly as
"something was deliberately withheld". Solid ink, never blur (blur implies
recoverable), never asterisks, never red. Keep redaction under ~40% of the
preview or it reads as broken rather than private.

**Also design the scope disclosure**, which sits beneath the permission cards
above the footer, separated by a hairline — it replaces a capture-policy screen
that was cut from onboarding. A 10pt uppercase eyebrow **WHAT NOVA READS**,
then three lines: *"Every app you use, once you grant access above."* in 13pt
secondary ink; then with an 11pt lock symbol, *"Except password managers,
banking sites, and private browsing windows. Nova never reads those, and that
can't be turned on."* in 11pt tertiary ink; then *"You can turn off any other
app later in Settings."* in 11pt tertiary ink.

**The critical detail:** the clause *"and that can't be turned on"* is the
strongest trust sentence in the product — a limit the user cannot remove is a
far stronger claim than one they could switch off. Do not soften it to "is
disabled by default", and do not shorten it away.

**Also design the denied state as a frame:** a `oklch(0.682 0.132 62)` warning
symbol, the line **"Nova can't read your screen yet"**, body copy *"macOS needs
you to enable Nova in System Settings. We'll wait here."*, and two buttons:
**Open System Settings** and **Continue without this**. The tone must be calm —
denial is recoverable and the user must not feel they broke something.

**Animation:** on grant, the closed aperture in the well traces open over
420ms, then the captured lines type in at roughly 600 characters per second
with the redaction blocks appearing as part of their line, not separately.
Total about 1.8 seconds. Under reduced motion, lines appear complete.

**Deliver:** light and dark, each with before-grant, after-grant, and denied.

---

### A3 — Permission ceremony: Microphone

**Flow:** C2. **Surface:** Onboarding window. **Step 1 of 3, second card.**
**Sits:** After Accessibility. **User feels:** Less anxious than A3 — a mic
permission is familiar — but alert to whether Nova listens all the time.

Same split composition as A3, with these changes.

**Left column:** `mic` SF Symbol, 28pt, accent. Title **"Let Nova hear your
meetings"**. Body: *"When a meeting app takes over your microphone, Nova
captures the audio and turns it into notes and follow-ups."* Contract list:
> ✓ Captures both sides of a meeting
> ✓ Turns commitments into open loops
> ✗ Only records when a meeting app is using your mic
> ✗ Never listens in the background

**Right column — the preview is a live input-level meter, not a transcript.**
A row of 24 vertical bars, 2pt wide, 3pt apart, in the accent color, varying
from 4pt to 48pt tall in a waveform-like distribution, centered in the well.
Below it, 11pt tertiary text: **"Nova is not recording — this is just the
level."**

**The critical detail:** transcribing the user's room to prove the mic works
would be exactly the opposite of trustworthy. A level meter proves the
permission functions *and* demonstrates restraint in the same gesture. That
restraint is the design idea — do not replace the meter with sample transcript
text.

**Animation:** the bars respond to live input at 30fps, each bar's height
easing to its new value at 140ms. Under reduced motion, the meter renders a
static representative waveform.

**Deliver:** light and dark, before-grant and after-grant.

---

### A4 — How it works

**Flow:** C. **Surface:** Onboarding window, 720 × 560pt. **Step 2 of 3.**
**Sits:** Immediately after the permission ceremony, before the optional
connector step.
**User feels:** Committed but unproven — they just said yes to everything and
want to understand what they agreed to.

Design a single static screen that **explains, as an illustrated diagram, how a
commitment becomes a tracked loop**. This is not a screenshot, not a live
capture, and not a simulation of the user's own data.

**Centered-narrow composition.** A 22pt/600 title **"How Nova finds your
loops"**, then a single bordered diagram region — 1px hairline, 11pt radius,
sunken surface, about 480pt wide — headed by a 10pt uppercase eyebrow reading
**EXAMPLE** in tertiary ink.

**Inside the diagram, three stages stacked vertically, connected by two
downward arrows, with an 11pt caption beside each arrow:**

1. **A written message.** A small well in SF Mono 11pt containing the line
   `"I'll send the Q3 deck by Friday"`, introduced by 11pt tertiary text *"You
   write, in a message:"*.
   → caption on the arrow: *"Nova reads it and notices a commitment"*
2. **The extracted loop**, drawn **exactly as a row in Nova's panel**: a 10pt
   uppercase label **YOU SAID YOU WILL** in tertiary ink, the description
   *"send the Q3 deck"* in 13pt/600, and *"by Friday"* in 11pt tertiary
   beneath. Give it the panel's treatment — a 2pt accent bar on the leading
   edge and a faint violet glow — on a slightly raised surface.
   → caption on the arrow: *"When Nova sees you send it, the loop closes
   itself"*
3. That closing caption is the final stage; no third box is needed.

**Below the diagram:** a 13pt secondary line **"Press ⌃⌥ any time to see what's
still open."** Then two lines of 11pt tertiary caption at a 62-character
measure: *"Nova sends the text it reads to Google (Gemini) to do this. Nothing
is stored there. Everything else stays on this Mac."* Then a primary
**"Continue"**.

**Critical detail one — it must look illustrative, not real.** This audience is
skeptical, and a fake screenshot that looks genuine is the version that loses
them. So: no window chrome, no browser frame, no real app name, no timestamp
like "2 seconds ago", nothing implying this already happened to the user. It is
a labelled diagram with arrows, and it is honest about being one. An obviously
illustrative example costs nothing; a convincing fake costs trust.

**Critical detail two — stage 2 is the only real product element on the
screen.** Everything else is diagram. Render that loop row with the exact type,
label, accent bar, and glow it will have in the panel, because the user is
being taught to recognize a shape they will see for the rest of the product's
life, and this is the cheapest place to teach it. Give it the only glow on the
screen.

**Critical detail three — the second arrow's caption is the whole point.**
*"When Nova sees you send it, the loop closes itself"* is the capability users
would never guess. Extraction is plausible; automatic resolution is the
surprising part and the thing that separates Nova from a to-do list. It earns
its own stage in the diagram rather than being folded into a sentence.

**Animation:** on screen entry the three stages develop in sequence 180ms
apart, with the two arrows tracing between them, and the loop row's glow
blooming faintly as it arrives. About 900ms total, runs once. Under
`prefers-reduced-motion: reduce`, everything appears at once.

**There are no other states** — no loading, no error, no empty variant. The
screen renders identically every time.

**Deliver:** light and dark.

---

### A5 — Connect your AI

**Flow:** E. **Surface:** Onboarding window. **Step 3 of 3.** The last step,
and **the only optional one.**
**User feels:** Convinced, now impatient. Most users should be able to leave
without doing anything here and lose nothing.

#### This screen must be skippable and must look skippable

Nova is fully functional without it. The primary user — the person in Gmail and
Sheets who will never install Claude Desktop — must reach this screen, see that
it does not apply to them, and leave in three seconds feeling finished rather
than feeling they failed a step.

So the screen opens with a plain statement that it is optional, the footer's
primary action is **Finish** (not "Connect"), and **Skip** is not needed as a
separate control because Finish already is one. This is also the first and only
screen in the entire product permitted to use the words *MCP*, *connector*, or
the name of an AI assistant (§0).

Design a centered-narrow screen with a preamble and two tiers.

**Preamble**, above everything: a 22pt/600 title **"Connect an AI — optional"**
and a 13pt secondary line: *"If you use Claude or another AI assistant, Nova
can answer its questions about your work. If not, you're done — Nova already
works."*

**Tier one — already connected, zero configuration.** A raised-surface card,
11pt radius: a 7px `oklch(0.642 0.112 158)` dot with **"Connected to Nova
Cloud"** in 13pt/600; below it 11pt tertiary copy *"Your memory stays on this
Mac. The relay passes queries through without storing."*; and right-aligned in
the card, an 11pt secondary text button **"Use my own backend ▾"**.

**Tier two — the connector instructions.** Below a hairline: a 10pt uppercase
eyebrow **CLAUDE DESKTOP**, an 11pt instruction line *"Paste into
claude_desktop_config.json"*, then a sunken-surface code well in SF Mono 11pt
showing a short JSON config block, with a **Copy** button at its top-right that
confirms inline by swapping to "Copied" in green for 2 seconds. Above the well,
a row of four 11pt tabs: **Claude Desktop · Claude Code · Cursor · claude.ai
(web)**, first selected with a 2pt accent underline.

**Footer:** a secondary **"Test connection"** and a primary **"Finish"** —
always Finish, never "Connect", because leaving is the expected outcome rather
than the fallback. The
primary action is always Finish, never "Connect" — leaving is the expected
outcome, not the fallback.

**Design the expanded "use my own backend" state as a second frame.** It
expands **in place**, pushing content below it down — never a modal, never a new
screen, because the user must not lose their place in the final step. Expanded,
the card contains: two radio options, **"Nova Cloud (recommended)"** and **"My
own backend"** (second selected); a labeled text field containing
`https://nova.example.com`; a status line beneath it — a 7px green dot and
11pt **"Connected · API v2 · self-hosted"**; two lines of 11pt tertiary copy
*"Self-hosting uses your own Gemini and Deepgram keys. Billing is off;
everything is entitled."*; and a right-aligned 11pt link **"Set up guide →"**.

**The critical detail:** the self-hosted path is *exposed here, collapsed*,
rather than buried in Settings → Advanced. The users who want it are exactly
the ones scrutinizing Nova right now, and making them hunt for it after
onboarding wastes the moment it matters. But it stays collapsed by default so
it costs everyone else nothing against a 3-minute onboarding budget.

**Also design these status-line variants** as small frames: *validating*
(gray dot, "Checking…", spinner at the field's trailing edge); *version skew*
(amber dot, "Backend is API v1 — Nova will use v1 features only" — this is not
an error, Nova pins and continues); *unreachable* (red dot, "Can't reach that
host", red hairline on the field); *not a Nova backend* (red dot, "That host
isn't running Nova").

**Animation:** the expansion is a 240ms height transition with the revealed
content developing in 60ms behind it. The Copy confirmation is an instant swap,
held 2s, then a 140ms dissolve back.

**Deliver:** light and dark, collapsed and expanded, plus the four status
variants.

---

### A6 — The panel *(THE ONLY SURFACE — design this one first)*

**Flow:** F. **Surface:** A 440pt floating panel, centered horizontally, 32%
from the top of the screen, floating above all windows on every Space.
**Opened two ways** — by pressing ⌃⌥ from any app, or by clicking the menu-bar
icon. Both open the same panel in the same centered position; there is no
anchored popover anywhere in this product.
**Sits:** This is the product, and the only surface that lists loops. A user
opens it several times a day, reads it in two seconds, clears something, and
it's gone.
**User feels:** A quick check — "what am I still on the hook for?"

**This is the most important screen in Nova and the one place its visual
ambition belongs. Give it the most care of anything in this appendix.**

Design the panel at 440pt wide, content height (max 420pt then scrolls), 14pt
corner radius. **It is dark in both light and dark system appearances** — a
summoned overlay must read as a distinct object floating over arbitrary
content, and violet glow only works on a dark ground.

**The ground — three layers, back to front. Build all three:**

1. **Glass base** — a translucent dark layer over a heavily blurred backdrop.
   Whatever the user was looking at should be faintly present behind it; that
   is what makes it a heads-up display rather than a window. (In the real app
   this is `NSVisualEffectView` with the `.hudWindow` material; approximate it
   with `backdrop-filter: blur(40px)` over a dark translucent fill.)
2. **Gradient ground** — a two-stop linear gradient at 145°, from
   `oklch(0.468 0.162 270)` to `oklch(0.388 0.166 322)`, at about 34% opacity
   over the glass. That is a 52° hue arc around violet and nothing wider. The
   two stops are close in lightness on purpose: the gradient should be *felt*,
   not seen. If you can point to where it changes, it is too strong.
3. **Ambient glow** — a large soft radial bloom of
   `oklch(0.648 0.232 296 / 0.10)` behind the header's aperture, about 180pt
   across, bleeding downward. **This is the light source the entire panel
   appears lit by**, so every other glow in the panel must look consistent with
   light coming from up there.

**Rim light:** a 1px hairline of `oklch(0.72 0.08 296 / 0.18)` around the whole
panel — a bright edge catching the light. Without it, glass reads as a flat
translucent rectangle. **No gray drop shadow anywhere** — the panel separates
from its backdrop by glow and rim only.

**Contents, top to bottom:**

**Header, 52pt** (two lines): the aperture mark at 15pt in the accent color
with a tight three-stop glow; **OPEN LOOPS** as a 10pt uppercase eyebrow at
+0.064em tracking in tertiary ink; the count **3** right-aligned in 15pt/600.
Beneath, an 11pt status line in the faintest ink: `capturing · 12 today`, or
`paused · resumes in 47m` with a gray status dot, or `not running · restarting`
in amber. This is the readout the deleted popover used to carry.

**Rows, 56pt each, full-bleed:** each has the loop description in 13pt/600 near-
white — the thing the eye must hit first — and beneath it an 11pt tertiary
meta line, lowercase and dot-separated: `you said · Dana Reyes · 2d`. The
first token carries direction: `you said`, `owed to you`, `unanswered`,
`stalled`.

Use these three real examples: *merge PR #11* (`you said · Dana Reyes · 2d`);
*the scaffolding CLI update* (`owed to you · Dana Reyes · 2d`); *whether the
template setup was tested* (`unanswered · Dana Reyes · 1d`).

**Exactly one row is focused at all times**, starting with the first. The
focused row gets: a fill of `oklch(0.288 0.072 296)`, a 2pt accent bar on its
leading edge, and a soft `oklch(0.648 0.232 296 / 0.24)` bloom behind it.
**The focused row and the header aperture are the only glowing elements** —
glow means *live or focused*, so glowing anything else spends the signal.

**Footer, 34pt:** `↑↓ move   ⏎ done   S snooze   esc close` in 11pt, in the
lowest-contrast ink in the product. It is a persistent, ignorable legend —
present for the first dozen summons, invisible after that. It never changes and
is never hidden.

**The critical detail:** this is a keyboard surface first. The user summons it
with a chord, so their hands are already on the keys — the design must make
arrow-key navigation feel like the intended path and the mouse feel like the
alternative. That is why exactly one row always carries focus, and why the
footer teaches keys rather than showing buttons. **Do not add per-row action
buttons** — no `[done] [snooze] [dismiss]` chips. The keys are the interface.

**Also design these frames:**
- **Empty** — aperture at 32pt in the faintest ink, centered, above 13pt
  *"Nothing open. You're clear."* Panel shrinks to about 180pt tall. No footer
  legend. Still on the full gradient ground.
- **Paused** — an 11pt line under the header: `Nova is paused · resumes in 47m`
  with a gray status dot. Loops still listed.
- **Resolving** — the moment a loop is marked done: the focused row's glow
  flares to `oklch(0.648 0.232 296 / 0.56)` at 1.4× radius. Show this frame at
  the flare's peak.
- **Loading** — three skeleton rows at 40% opacity with no glow.

**Animation to specify:**
- **Summon**, 240ms: the panel fades in and scales 0.96→1.00 from its own
  center while its glow blooms from nothing to resting. No slide, no drop, no
  spring — it fades up in place, already lit. **The backdrop does not dim**;
  dimming the screen for a two-second check makes it feel modal, which it
  isn't.
- **Resolve**, the product's emotional center: the row's glow flares over 120ms,
  then the row dissolves over 240ms drifting 2pt up, rows below settle into the
  gap, the header count settles 3→2, and focus moves to the next row. **The
  flare is the one indulgence in the entire product** — no checkmark, no sound,
  no confetti. A brief brightening, then the thing is gone.
- **Dismiss**, 140ms: dissolve with the glow going out first, so the panel
  visibly stops being lit before it stops being visible.

**Deliver:** the default state large and in full detail, plus the empty,
paused, resolving-flare, and loading frames. Dark only — this panel has no
light variant. Render it over a realistic blurred desktop backdrop so the glass
reads correctly.

---

### A7 — First-run tour

**Flow:** F. **Surface:** A small overlay anchored near the menu-bar status
item, over the user's real desktop. **Sits:** Right after onboarding finishes.
**User feels:** Done. Do not detain them.

**The single most important thing this tour does is teach the ⌃⌥ chord.** A
user who leaves without it has no way to reach the product — they will find the
menu-bar glyph eventually and conclude Nova is just a status icon. So the tour
makes them *press* the chord rather than read about it.

**First, design the transition as a 3-frame storyboard:** the onboarding window
dissolves while the aperture mark detaches from its top-left corner and travels
along a gentle arc up into the macOS menu bar, shrinking 32pt → 16pt over
520ms, **its glow fading out as it goes** — the mark visibly leaves the
summoned register and enters the ambient one, which is a small piece of visual
teaching in itself. This animation answers the number-one confusion with
menu-bar apps ("where did it go?") physically rather than with a caption.

**Then the tour overlay:** 240pt wide, styled like the ⌃⌥ panel — dark glass,
violet rim light, 14pt radius — so the user already recognizes the surface when
they summon it for real. Design four beats:

| Beat | Copy | Treatment |
|---|---|---|
| 1 | "Nova lives here now. It's reading your screen." | Anchored to the glyph; a 3pt accent ring traces around it |
| 2 | **"Press ⌃⌥ to see what you owe people."** | The chord rendered large — two 28pt key caps, centered, softly glowing. **No Next button. The overlay waits.** |
| 3 | "That's it. From anywhere, any app." | The real ⌃⌥ panel has appeared in the center of the screen showing loops; the overlay copy sits beneath it |
| 4 | "Nova will be quiet unless something needs you." | No anchor; centered. A single [Done] button |

**The critical detail:** beat 2 does not auto-advance. It sits there with two
key caps on screen until the user actually presses the chord, because a hotkey
learned by pressing is retained and one learned by reading is not. Design a
small 11pt "Skip" link for anyone who refuses, and a hint line that appears
after 20 seconds: *"Hold Control and Option together."* This is the only place
in Nova that blocks on a user action, and it is worth it exactly once.

Beat 4's line is the product's entire philosophy and the last thing onboarding
says — it promises silence, which is why Nova has no tips, no what's-new
modals, and no re-engagement prompts anywhere.

**Deliver:** the 3-frame transition storyboard plus 4 beat frames, rendered
over a neutral desktop backdrop with a visible macOS menu bar.

---

### A8 — Loop actions

**Flow:** G. **Surface:** Inside the panel, per row.
**Sits:** The single interaction the daily product exists for.
**User feels:** Small satisfaction. This is the only moment Nova gives the user
something to feel.

Design the three action interactions as frame sequences.

**Done — 4 frames.** (1) Row at rest with actions visible on hover. (2) The
instant after tap: the row is dissolving — fading while drifting 2pt upward.
(3) The rows below settling up into the gap, and the section count animating
from **(3)** to **(2)**. (4) Settled.

**The critical detail:** there is no checkmark, no toast, no sound, no
confetti. The reflow *is* the reward. The satisfaction comes entirely from the
smoothness — rows must settle, not snap. This restraint is the product's
personality in miniature: a resolved obligation should feel like a weight
leaving, not like a game rewarding you. Do not add a success indicator.

**Snooze — 2 frames.** The `▾` opens a small native menu: **Tomorrow 9am**
(default) · This weekend · Next week · Pick a date…. After selection, the row
dissolves and a 32pt full-width toast appears at the bottom of the panel in
11pt on a sunken surface: **"Snoozed until Tuesday 9am · Undo"**, held 8
seconds. This is the only undo in the entire product.

**Dismiss — 3 frames.** Tap replaces the row's action bar **in place** with
11pt text reading **"Dismiss permanently? [yes] [cancel]"** — no modal, no
dialog, no sheet. Yes dissolves the row; cancel develops the actions back.

The word **"permanently"** must appear, because dismissing is genuinely
irreversible by design — the underlying record keeps its deduplication key so
the same commitment can never resurface. Hiding that would erode trust the
moment a user discovered it.

**Also design the failure frame:** an action that the daemon rejects brings the
row back with an inline 11pt line in `oklch(0.588 0.148 27)` reading **"already
resolved"**, held 4 seconds, then fading while the row stays.

**Deliver:** all three sequences, light mode is sufficient; note dark-mode ink
values in the file.

---

### A9 — The status glyph, all states

**Flow:** J. **Surface:** The macOS menu bar, 16 × 16pt.
**Sits:** This is 99% of what users see of Nova, forever.
**User feels:** Nothing, most of the time — which is correct. It should be
noticed only when looked at.

Design the aperture mark as a complete state set and animation study, presented
as a large-scale specification sheet (draw each state at 128pt for clarity,
with a 16pt actual-size row beneath for verification).

**Geometry:** six blades, each a circular-arc segment, rotationally symmetric at
60°. Outer diameter 16pt at true size; stroke 1.5pt. The aperture opening is
expressed as a percentage of outer diameter, and the blades rotate 30° between
fully open and fully closed — that rotation is what produces the mechanical-iris
feeling rather than a simple scale.

**Three states:**

| State | Form |
|---|---|
| **Capturing** | Opening at 62% |
| **Paused** | Opening at 0%, blades rotated 30° — fully closed |
| **Attention** | Opening at 30%, with a 3pt filled dot centered in the opening |

**Render every state as a monochrome template image** — macOS recolors template
images automatically for light menu bars, dark menu bars, and the highlighted
(clicked) state. The glyph is **never colored**. Status is carried by *form*
only, never hue, because a 16pt colored dot is illegible and because colorblind
users exist. Show each state on both a light and a dark menu-bar strip to prove
the template approach works.

**Animations to specify:**

- **Breathing (capturing):** the opening oscillates 62% ↔ 58% over 4.2 seconds,
  ease-in-out, infinite. The amplitude is deliberately near-subliminal — a user
  should notice it only if they look directly at it. Do not exaggerate it for
  the mockup; if anything, under-draw it.
- **Capturing → Paused:** blades rotate and close simultaneously over 420ms.
  This should read as a mechanical shutter closing. **This transition is the
  entire reason the mark is an aperture** — make it the centerpiece of the
  animation study.
- **Loop found:** one pulse, opening 62% → 68% → 62% over 700ms, exactly once.
  Never repeats, never queues — three loops found in a minute produce one pulse.
- **Reduced motion:** all animation stops; each state renders as its static
  form.
- **Battery:** the breathing runs at 30fps and stops entirely when the display
  sleeps, in fullscreen, or below 20% battery.

**Also design the right-click menu**, as a plain native macOS menu (standard
chrome, unstyled — Nova contributes only wording and grouping):

```
  Open Nova                    ⌃⌥
  ─────────────────────────────
  Pause capturing              ▸
  ─────────────────────────────
  Settings…                    ⌘,
  ─────────────────────────────
  Quit Nova                    ⌘Q
```

**"Open Nova" is listed first and shows the chord** — redundant with
left-clicking the icon, which is the point: a user who right-clicked while
looking for something is shown the shortcut exactly when they are looking for
it. Also design the paused variant, where the pause item becomes **"Resume
capturing"** with no submenu and a disabled item above it reads
`Paused · resumes in 47m`.

**The critical detail:** the menu-bar icon shows status and opens things. It
does not list loops, show a count, or hold a settings pane — those live in the
panel (A6) and in Settings. Do not design a rich popover here; a native menu is
instantly familiar, renders correctly in every appearance and accessibility
setting for free, and cannot drift out of sync with the panel because it holds
no loop data at all.

**Deliver:** a specification sheet with large-scale states, true-size
verification row, both menu-bar appearances, a frame-by-frame breakdown of the
capturing→paused shutter transition, and the two menu variants.

---

### A10 — Pause, settings & delete

**Flow:** I and J. **Surface:** A native `NSMenu` from the glyph, and a
standard macOS settings window.
**User feels:** Exercising control, and checking whether it's real.

Design three things.

**1. The right-click menu**, as a native macOS context menu:
> Pause capturing ▸ *(submenu: 30 minutes · 1 hour · Until tomorrow · Until I resume)*
> ───
> Open logs
> Launch at login ✓
> Show tour again
> ───
> Quit Nova

Standard AppKit menu styling, unmodified — Nova contributes the wording and the
grouping, not the chrome.

**2. The paused panel header:** closed aperture at 15pt, **OPEN LOOPS** eyebrow,
and a status line reading **"paused · resumes in 47m"** with a gray dot,
counting down. The glyph closing is the real feedback for pausing — do not add
a toast.

**3. The delete-memories screen** (a pane in a standard preferences window,
680pt wide). This is the one screen in Settings that needs real design care:

Title **"Delete memories"** at 15pt/600. Three radio options: **A time range**
(with two date fields, `Sep 1` to `Sep 21`), **One app** (with a dropdown),
**Everything**. Below them, a raised-surface card with an 11pt radius
containing two lines: **"This removes 1,284 memories from Sep 1–21."** in
13pt/600, and **"It cannot be undone."** in 13pt in
`oklch(0.588 0.148 27)`. Then the confirm button — primary button geometry but
filled with that same red — labeled **"Delete 1,284 memories"**.

**The critical detail:** the count is computed live and named *in the button
label itself*, so the user confirms a specific quantity rather than an abstract
action. This is the only place in Nova where red is used as a fill, and that
scarcity is what makes it register. For the **Everything** option, design a
second frame where the button is disabled until the user types `DELETE` into a
confirmation field.

**4. The Capture → Apps pane**, where the removed onboarding picker now lives.
A standard preferences window, 680pt wide, containing a scrolling list of
installed apps. Each row: the app icon at 28pt, the app name in 13pt primary
ink, the bundle identifier in 11pt tertiary ink beneath it, and a standard
macOS switch right-aligned. Rows are 52pt tall and bleed full width so hover
reads as a band. **Everything defaults to on.**

The list ends with a group headed by a 10pt uppercase eyebrow **NEVER
OBSERVED** — 1Password, Bank of America, Private browsing windows — whose
switches render **disabled in the off position**, each with an 11pt lock symbol
and the caption **"always off"** in tertiary ink.

**The critical detail:** that locked group is why this pane matters even though
few users open it. It is where a skeptical user goes to verify the claim
onboarding made — and finding it exactly as promised is what turns a claim into
trust. Design it as a feature, not as an apology; do not bury it, collapse it,
or place it above the editable apps.

**Deliver:** light and dark for all four.

---

### A11 — Error, recovery & empty states

**Flow:** K and L. **Surface:** The panel, plus the menu-bar glyph.
**User feels:** Either mildly alarmed (error) or calm (empty). Both must be
handled without drama.

Design a set of panel frames, one per condition. In every one, the message
says **what happened, when, and what Nova is doing about it.**

| Condition | Header / body |
|---|---|
| **Daemon not running** | Attention glyph. Header: *"Nova isn't running — restarting…"* with an indeterminate 2pt progress hairline directly beneath the header |
| **Crash loop** | Attention glyph. Header in red, the last error line in 11pt tertiary beneath it, and a **Restart** button |
| **Permission revoked** | Attention glyph. *"Screen reading is off — memory has a gap since 2:14 pm"* plus a **Fix** button |
| **Offline** | Capturing glyph (unchanged). Header: *"Capturing offline · 14 queued"* |
| **One loop undecryptable** | Normal, except the section eyebrow reads **OPEN LOOPS (3, 1 unreadable)** |

**The critical detail:** the permission-revoked message names an exact time. A
precise loss ("a gap since 2:14 pm") is trustworthy; a vague one ("some
memories may be missing") is alarming. Always prefer the specific number, even
when the news is worse.

**Empty states — four frames.** Each shows a 32pt aperture in the lightest ink,
centered, with a single 13pt line beneath. Nothing else — **no illustration,
ever.**

- No open loops: *"Nothing needs your attention right now"*
- First day: *"Nova is still learning your week. Loops usually appear after a day or two."*
- All permissions denied: *"Nova can't see anything yet"* + a **Set up** button
- All snoozed: the no-loops message, plus an 11pt tertiary line *"3 loops snoozed until tomorrow"*

**The critical detail:** an empty Nova should feel like a clear desk, not like
an app waiting to be fed. Do not add encouragement, a call to action, a
progress meter, or a cheerful graphic. "Nothing needs your attention right now"
is a complete and finished screen. Silence is the feature.

**Deliver:** light and dark for every frame.

---
