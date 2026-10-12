# Nova — motion spec

**Version:** 1.0 · **Date:** 2026-10-07
**Source:** Claude Design project `Flow A window choreography`
(`715c9363-e092-4ae6-b4cc-b6e802d19241`), file `Your Space - Blocked apps.dc.html`,
against design system `nova-design-system-d4e9eba3`.

This is the single authority on how Nova moves. It governs the Your Space
window, the loop panel, and the briefing card. Values are transcribed from the
design, not re-derived — if a number changes there, change it here, and do not
"improve" one locally.

The rule that governs everything below: **one curve, three durations, and
nothing else.** Every value added since is an offset or a hold, never a new
curve and never a new transition duration. Motion carries information or it
does not ship.

---

## 1. The primitives

```
--ease:              cubic-bezier(0.32, 0.72, 0.28, 1.00)   the only curve
--motion-quick:      140ms
--motion-base:       240ms
--motion-considered: 420ms
```

Fast out, long settle, **no overshoot**. The fast start is what makes 140ms
feel immediate: at this curve a 140ms move covers most of its distance in the
first 60ms, which is why selection can fire on mouse-down and still land
inside the 100ms a click wants to feel acknowledged.

In Swift:

```swift
extension Animation {
    /// The product's only curve. `d` is one of Nova.quick/base/considered.
    static func nova(_ d: Double) -> Animation {
        .timingCurve(0.32, 0.72, 0.28, 1.0, duration: d)
    }
}
```

`DesignSystem.swift` already carries these as `Nova.ease(_:)`,
`Nova.motionQuick`, `Nova.motionBase`, `Nova.motionConsidered`.

### The four verbs

The design system names four, and every animation in the app is one of them:

| Verb | What it is | Where |
|---|---|---|
| **Develop** | Appearing: opacity 0→1 with a small rise | rows, panes, new content |
| **Settle** | Arriving at rest: a held accent fading to its resting ink | after an add, after a count changes |
| **Trace** | A shape moving to a new position | the sidebar selection wash |
| **Dissolve** | Leaving: opacity 1→0 with a 2px rise | removed rows, outgoing panes |

Develop uses a **rise**, not the system's 0.96 scale, for anything full-width:
scaling a 600px row moves its edges by 10px, which reads as a lurch rather
than an arrival. Scale is reserved for small, centred things.

### New values — offsets and holds only

```
--stagger-step:  24ms     6 rows x 24 = 120ms spread; reads as one arrival, not a queue
--stagger-cap:   6        rows past the 6th share its start, so a 200-row list
                          costs the same as 6
--ack-hold:      1200ms   how long new or changed things keep accent before settling
--pane-lead:     60ms     incoming pane waits for the outgoing to be mostly gone
--offset-pane:   8px
--offset-row:    4px
--offset-count:  6px
--offset-dissolve: 2px
```

None of these is a duration. A hold is a wait; an offset is a distance. Adding
either does not add a second feel to the product, which a fourth duration or a
second curve would.

---

## 2. The nine behaviours

Each is numbered as in the design. The Swift is the design's own, adjusted only
where Nova's existing types differ.

### 01 — Pane transitions

Selecting lower in the sidebar brings content **up from below**; selecting
higher brings it **down**. Direction encodes where you went, so the window
feels navigated rather than reloaded.

The outgoing pane **fades in place and never moves**. Only the incoming pane is
in layout; the outgoing one is an overlay, so the window height cannot change
mid-transition. The pane title fades without moving, so the header hairline
stays still.

```
out    opacity 1→0              140ms   +0ms
head   opacity 0→1              240ms   +60ms
body   opacity 0→1, y ±8→0      240ms   +60ms
total                           300ms
```

```swift
ZStack(alignment: .top) {
    pane(selection).id(selection)
        .transition(.asymmetric(
            insertion: .opacity.combined(with: .offset(y: 8 * dir))
                .animation(.nova(0.24).delay(0.06)),
            removal: .opacity.animation(.nova(0.14))))
}
.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
```

**No crossfade.** Two half-opaque layouts read as a ghost, and stacking both in
a `VStack` for the length of a true crossfade makes the height rise to their
sum and fall back — the panel visibly shakes. This is why the outgoing pane
clears in 140ms and the incoming starts at 60ms.

### 02 — Sidebar selection

Selection fires on **mouse-down**, like a native source list. One wash shape
*traces* to the new row in 140ms rather than fading out and in, so the
selection reads as a thing that moved.

Hover on unselected rows is a sunken band. **The selected row has no hover
state** — it has nothing left to do.

```
wash   translateY        140ms   on mouseDown
hover  band              140ms
```

```swift
RoundedRectangle(cornerRadius: 3).fill(Nova.accentWash)
    .matchedGeometryEffect(id: "wash", in: ns)

// on the row
.gesture(DragGesture(minimumDistance: 0)
    .onChanged { _ in
        if sel != item { withAnimation(.nova(0.14)) { sel = item } }
    })
```

### 03 — List entry

**Only on the first open of a pane per window session, and only for rows in
view.** Rows rise 4px and fade in, 24ms apart, capped at 6; everything past the
sixth arrives with it. Longest possible entry is 360ms whatever the list length.

```
row i   opacity 0→1, y 4→0   240ms   delay min(i, 5) × 24ms
max                          360ms
```

```swift
.opacity(shown ? 1 : 0)
.offset(y: shown ? 0 : 4)
.animation(.nova(0.24).delay(Double(min(i, 5)) * 0.024), value: shown)
// set `shown` once per session, in onAppear
```

**Revisits get no stagger.** Staggering on every pane switch is the thing that
gets old by the fiftieth viewing; the pane transition alone is enough.

### 04 — Add → appear

The primary button shows its loading state while Nova applies the rule. On
reply the form settles closed **while the new row opens in the same place**, so
the eye does not travel.

The row holds accent wash for 1.2s, then settles. Its subline reads
"deleting 14 captures" until Nova confirms, then changes to "14 captures
deleted" with a 140ms fade. **The deletion is reported as done only once it is
done.**

```
form     height h→0, opacity→0           240ms
row      height 0→h                      240ms
content  opacity 0→1, y 4→0              240ms   +80ms
wash     accent-wash hold 1200 → clear   420ms
subline  text swap on confirm            140ms
```

```swift
withAnimation(.nova(0.24)) { formOpen = false; rules.insert(new, at: 0) }
// on the row
.transition(.opacity.combined(with: .offset(y: 4)))
.background(Nova.accentWash.opacity(fresh ? 1 : 0))
.task {
    try? await Task.sleep(for: .seconds(1.2))
    withAnimation(.nova(0.42)) { fresh = false }
}
Text(sub).contentTransition(.opacity)
```

### 05 — Remove → disappear

Remove appears on row hover or keyboard focus, **in a reserved column so
nothing shifts** when it appears. It swaps the row for an inline confirm that
states the consequence. On confirm the content dissolves up 2px, then the empty
row closes and the rows below settle up. A toast names which rule went.

```
confirm swap   opacity             140ms
content        opacity→0, y→-2     140ms
row            height h→0          240ms   +140ms
toast          develops, dissolves after 4s
```

```swift
.transition(.asymmetric(
    insertion: .identity,
    removal: .opacity.combined(with: .offset(y: -2)).animation(.nova(0.14))))
withAnimation(.nova(0.24).delay(0.14)) { rules.remove(id) }
```

**No undo.** The confirm states the consequence ("Nova reads it again") and
re-adding is one step, which is a better guarantee than a window of regret.

### 06 — Count incrementing

The old value rises 6px and fades; the new value rises into place. The number
then holds accent for 1.2s and settles to its ink. The section total rolls the
same way.

```
old   opacity→0, y 0→-6               140ms
new   opacity 0→1, y 6→0              240ms
ink   accent hold 1200 → settle 420ms   (≤ 1 per row per 10s)
```

```swift
Text(count, format: .number).monospacedDigit()
    .contentTransition(.numericText(value: Double(count)))
    .foregroundStyle(acked ? Nova.accent : Nova.inkPrimary)
    .animation(.nova(0.24), value: count)
```

**The colour hold is rate-limited to once per row per 10s.** During a meeting
the screen-sharing count can climb every few seconds, and an accent hold on
each one is a flicker. The roll always runs; the colour hold does not.
Changes that happened while the window was hidden are applied **without
motion** — nobody was there to see them arrive.

### 07 — Live data

The pane polls. Rows are **never reordered by count**, and counts update in
place, which never changes height.

A rule that arrives from elsewhere (the menu bar, another device) is inserted
silently if it lands above the reading line, and the scroll offset is moved by
its height so **nothing visible moves**. If it arrives in view it enters like
an add, with a shorter 600ms hold. Nothing animates while the window is not
key.

```
above view   no motion, scrollTop += h
in view      as 04, wash hold 600ms
```

```swift
ScrollView { … }
    .scrollPosition(id: $anchor, anchor: .top)
// keep `anchor` on the first fully visible row id before applying a poll diff
```

### 08 — Hover

```
rows                     transparent → sunken band      140ms
secondary / row buttons  sunken (raised on a sunken row) 140ms
primary                  accent-hover                    140ms
```

```swift
.onHover { h in withAnimation(.nova(0.14)) { hovering = h } }
```

**Always-off rows have no hover state**, because they have nothing to do. **No
cursor change anywhere** — this is a Mac window, not a web page.

### 09 — Loading and error

Loading: whatever ships inside the app bundle renders at once; only what comes
from the daemon waits. **Nothing is shown as loading for the first 300ms**, so
a fast reply never flashes a spinner. After that the status reads "Asking
Nova".

Error: **no list is drawn.** What is built into the app still shows, with every
count marked `unknown`, and the list that cannot be seen says exactly that.
Arrival after either state uses list entry (03).

```
loading text   after 300ms, opacity   140ms
state swap     pane body opacity      240ms
```

```swift
switch state {
case .loading:     ChecksList(counts: nil)          // never []
case .unreachable: ErrorBlock(); ChecksList(counts: nil)
case .ready(let d): ChecksList(counts: d.hard); YourList(d.rules)
}
```

**`counts: nil`, never `[]`.** An empty list claims "nothing was captured and
nothing was sent", which is the one lie the transparency window exists to
prevent (D22). Unknown and zero are different facts and must look different.

---

## 3. Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  /* every motion becomes a 100ms opacity change:
     no offsets, no stagger, no height animation, no scroll animation. */
}
```

**Colour holds stay.** They carry information rather than movement — the accent
on a changed count is how the user finds it, and removing it would remove the
fact, not the animation. The design system already collapses all three
durations to 100ms under this query.

In SwiftUI: `@Environment(\.accessibilityReduceMotion)`, and gate the offset
and delay rather than the opacity.

---

## 4. What this spec refuses

Recorded so it is not re-proposed:

- **No second curve and no fourth duration.** One feel per product. Anything
  that seems to need another is an offset or a hold.
- **No spring, no bounce, no overshoot.** The curve settles long; a bounce
  reads as a toy, and this app reads someone's screen.
- **No scale-up-from-zero** on anything full-width (see Develop, §1).
- **No crossfade between panes** (§01).
- **No stagger on revisits** (§03).
- **No cursor changes** (§08).
- **No animation while the window is not key** (§07).
- **No motion on data that arrived unseen** (§06).

---

## 5. What is implemented

As of 2026-10-07, in the Your Space window:

| § | Behaviour | State |
|---|---|---|
| 01 | Pane transitions | **done** — direction from the sidebar's order, outgoing overlaid so the height cannot change, title fades without moving |
| 02 | Sidebar selection | **done** — one traced wash via `matchedGeometryEffect`, fired on mouse-down |
| 03 | List entry | **done** — once per window session, capped at 6 |
| 04 | Add → appear | **done** — form settles closed as the row opens, 1.2s hold, deletion reported after it happened |
| 05 | Remove → disappear | **done** — reserved column, inline confirm, toast |
| 06 | Count incrementing | **done** — rolls, holds accent, rate-limited per row, silent while the window is not key |
| 07 | Live data | **partial** — counts update in place and rows are never reordered; the scroll-offset compensation for a rule inserted above the reading line is not built |
| 08 | Hover | **done** |
| 09 | Loading and error | **done** — 300ms before anything reads as loading, `nil` counts never shown as zero |

The one gap, §07's scroll compensation, needs a rule to arrive from outside
the window while it is open and scrolled — which only happens from the menu
bar or another device. It is listed rather than quietly skipped.

---

## 6. Design pushback, accepted

The design argued against four things in the original brief. All four are
adopted above, and recorded here with their reasons:

1. **One scroll is right, but Add cannot live in it.** At 720×460 the four
   always-off checks fill most of the first screen, so an add control inside
   "Your list" sits below the fold. Add belongs in the pane header and opens in
   place.
2. **Stagger once per window open, not per pane switch.** Per-switch stagger is
   what gets old by the fiftieth viewing.
3. **Count acknowledgement needs a rate limit.** Otherwise a meeting turns the
   screen-sharing row into a flicker.
4. **Remove confirms inline, then a toast — no undo.** The confirm states the
   consequence, and re-adding is one step.
