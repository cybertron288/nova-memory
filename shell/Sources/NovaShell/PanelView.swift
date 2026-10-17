/// The panel (design spec §9.F, ported from `Flow F - The panel.dc.html`).
///
/// One surface, opened by ⌃⌥ or by clicking the status item. Dark in both
/// system appearances, because a summoned overlay must read as a distinct
/// object floating over arbitrary content. The ground is dark glass with a
/// faint violet gradient over it — no glow.
///
/// Keyboard-first by construction: the user arrives from a chord, so their
/// hands are already on the keys. Exactly one row holds focus at all times and
/// the footer teaches keys rather than showing buttons. Snooze and dismiss are
/// *inline row modes*, not menus — the row's meta line is replaced in place,
/// which keeps the panel a single unmoving surface.
import AppKit
import SwiftUI

struct PanelView: View {
    @ObservedObject var model: PanelModel

    var body: some View {
        VStack(spacing: 0) {
            header

            // The outgoing tab leaves at once and the incoming one fades in
            // while the height animates. A true crossfade stacked both tabs in
            // the VStack for the length of the transition, so the height rose
            // to their sum and fell back — the panel visibly shook.
            Group {
                if model.blockedOnPermission {
                    permissionState
                } else {
                    switch model.tab {
                    case .loops:
                        if model.showSkeleton {
                            skeleton
                        } else if model.daemonDown {
                            downState
                        } else if model.rows.isEmpty {
                            emptyState
                        } else {
                            list
                        }
                    case .memory:
                        memoryList
                    }
                }
            }
            .transition(.asymmetric(insertion: .opacity, removal: .identity))

            footer
        }
        .frame(width: Nova.panelWidth)
        // The panel's own ideal height — lists at most `listMaxHeight`, never
        // stretched to fill the (fixed, taller) window.
        .fixedSize(horizontal: false, vertical: true)
        .background(ground)
        .clipShape(RoundedRectangle(cornerRadius: Nova.radiusXL, style: .continuous))
        .overlay(
            // The rim: `box-shadow: inset 0 0 0 1px var(--rule)` in the design.
            // A bright edge catching the ambient light — without it, the panel
            // reads as a flat rectangle rather than a lit object.
            RoundedRectangle(cornerRadius: Nova.radiusXL, style: .continuous)
                .strokeBorder(Nova.rule, lineWidth: 1)
        )
        // A plain window shadow, as any macOS window has — not a coloured glow.
        .shadow(color: .black.opacity(0.35), radius: 20, y: 10)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
            model.panelHeight = height
        }
        // The window is a fixed, transparent stage and never resizes; the
        // panel sits at its top and SwiftUI animates the panel's height in the
        // same transaction as the content change. Animating the window frame
        // instead made AppKit and SwiftUI each move the content per frame, and
        // the two disagreed by a pixel — the panel vibrated.
        .padding(Nova.panelMargin)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .environment(\.colorScheme, .dark)
        .preferredColorScheme(.dark)
    }

    // MARK: - The ground
    //
    // Dark glass, a dark veil, then a faint gradient tint. The veil is what
    // keeps the panel dark over a white page: glass alone takes its brightness
    // from whatever is behind it, and over white it washed out to mid-grey
    // with the light ink unreadable. Apple's always-dark HUDs hold their tone
    // the same way. Two-thirds opacity keeps the desktop visible through it.

    private var ground: some View { NovaGround() }

    // MARK: - Header
    //
    // 52pt, two lines: the eyebrow, and the status line the deleted popover
    // used to carry. This panel is Nova's only surface, so "is it working?"
    // lives here.

    private var header: some View {
        HStack(spacing: Nova.space5) {
            ApertureMark(
                state: model.apertureState,
                size: 16,
                color: model.needsAttention ? Nova.statusAttention : Nova.inkPrimary,
                breathe: model.isOpen && model.apertureState == .capturing
            )

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Nova.space5) {
                    ForEach(PanelModel.Tab.allCases, id: \.self) { tab in
                        HStack(spacing: 4) {
                            Text(tab.title)
                                .font(Nova.label)
                                .tracking(Nova.labelTracking)
                            // The count sits with the tab it counts, so it
                            // stays readable from the Memory tab too.
                            if tab == .loops && model.showCount {
                                Text("\(model.loopsTotal)")
                                    .font(Nova.label)
                                    .monospacedDigit()
                                    .contentTransition(.numericText())
                                    .opacity(0.7)
                            }
                        }
                        // The unselected tab is dimmed rather than hidden:
                        // a second view nobody can see is a second view
                        // nobody uses.
                        .foregroundStyle(model.tab == tab ? Nova.inkPrimary : Nova.inkQuaternary)
                        .contentShape(Rectangle())
                        .onTapGesture { model.select(tab) }
                    }
                }
                Text(model.statusLine)
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(model.statusInk)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, Nova.space6)
        .frame(height: Nova.headerHeight)
    }

    // MARK: - Rows

    private var list: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(Array(model.rows.enumerated()), id: \.element.id) { index, row in
                        if row.loop.isWaitingOn,
                           index == 0 || !model.rows[index - 1].loop.isWaitingOn {
                            waitingHeader
                        }
                        LoopRowView(row: row, model: model)
                            .id(row.loop.id)
                    }
                    if model.hasMoreLoops {
                        loadingRow.onAppear { model.loadMoreLoops() }
                    }
                }
            }
            .scrollIndicators(.hidden)
            .frame(maxHeight: Nova.listMaxHeight)
            .mask { if model.overflowing { edgeFadeMask } else { Rectangle() } }
            .overlay(alignment: .top) { Rectangle().fill(Nova.rule).frame(height: 1) }
            .onChange(of: model.scrollRequest) {
                guard let id = model.rows[safe: model.focusIndex]?.loop.id else { return }
                withAnimation(Nova.motionQuick) { proxy.scrollTo(id, anchor: .center) }
            }
        }
    }

    /// The end of a list that has more: one skeleton row, which loads the next
    /// page as it scrolls into view.
    private var loadingRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            bar(0.55)
            bar(0.35)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Nova.space6)
        .frame(height: Nova.rowHeight)
        .opacity(0.4)
    }

    /// Divides the user's own loops from the ones they wait on. Rows are
    /// ordered so every "owed to you" loop sits below it.
    private var waitingHeader: some View {
        Text("WAITING ON")
            .font(Nova.label)
            .tracking(Nova.labelTracking)
            .foregroundStyle(Nova.inkQuaternary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Nova.space6)
            .padding(.top, Nova.space5)
            .padding(.bottom, 2)
    }

    /// The design masks the list's edges at 24px when it overflows, so rows
    /// fade out rather than being cut by a hard edge. A mask, not a painted
    /// gradient: over a translucent ground a painted fade shows as a band.
    private var edgeFadeMask: some View {
        VStack(spacing: 0) {
            LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
                .frame(height: 24)
            Rectangle()
            LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                .frame(height: 24)
        }
    }

    // MARK: - Memory
    //
    // What Nova has actually read, newest first. Read-only by design: this is
    // the evidence behind the loops, not a second place to act.

    private var memoryList: some View {
        Group {
            if model.daemonDown {
                downState
            } else if !model.memoriesLoaded {
                skeleton
            } else if model.memories.isEmpty {
                VStack(spacing: Nova.space5) {
                    ApertureMark(state: .capturing, size: 32, color: Nova.inkQuaternary)
                    Text("Nothing captured yet.")
                        .font(Nova.body)
                        .foregroundStyle(Nova.inkSecondary)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 128)
            } else {
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(model.memories) { memory in
                            MemoryRowView(memory: memory)
                        }
                        if model.hasMoreMemories {
                            loadingRow.onAppear { model.loadMoreMemories() }
                        }
                    }
                }
                .scrollIndicators(.hidden)
                .frame(maxHeight: Nova.listMaxHeight)
                .overlay(alignment: .top) { Rectangle().fill(Nova.rule).frame(height: 1) }
            }
        }
    }

    // MARK: - Non-row states

    private var skeleton: some View {
        VStack(spacing: 0) {
            ForEach([0.38, 0.62, 0.70], id: \.self) { width in
                VStack(alignment: .leading, spacing: 8) {
                    bar(width)
                    bar(width * 0.8)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Nova.space6)
                .frame(height: Nova.rowHeight)
            }
        }
        .opacity(0.4)
        .overlay(alignment: .top) { Rectangle().fill(Nova.rule).frame(height: 1) }
    }

    private func bar(_ fraction: Double) -> some View {
        GeometryReader { geo in
            RoundedRectangle(cornerRadius: 3)
                .fill(Nova.inkQuaternary)
                .frame(width: geo.size.width * fraction, height: 10)
        }
        .frame(height: 10)
    }

    /// "A clear desk, not an app waiting to be fed" — no illustration, no
    /// encouragement, no call to action. Silence is the feature.
    private var emptyState: some View {
        VStack(spacing: Nova.space5) {
            ApertureMark(state: .capturing, size: 32, color: Nova.inkQuaternary)
            Text(model.emptyMessage)
                .font(Nova.body)
                .foregroundStyle(Nova.inkSecondary)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 128)
        .transition(.opacity)
    }

    /// Replaces both tabs while Nova cannot read the screen. Nothing else in
    /// the panel is worth acting on then: loops and memories stop growing, and
    /// a list that looks normal would say otherwise. The fix is one switch in
    /// one Settings pane, so the panel offers exactly that.
    private var permissionState: some View {
        VStack(spacing: Nova.space5) {
            ApertureMark(state: .attention, size: 32, color: Nova.statusAttention)
            VStack(spacing: 6) {
                Text("Nova can't read your screen")
                    .font(Nova.heading)
                    .foregroundStyle(Nova.inkPrimary)
                Text("Turn on Nova in Privacy & Security → Accessibility.\nNothing is captured until you do.")
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkSecondary)
                    .multilineTextAlignment(.center)
            }
            ChoiceChip(text: "Open Settings", tint: Nova.accent) {
                AccessibilityPermission.openSettings()
            }
            .font(Nova.bodyEmphasis)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Nova.space6 * 2)
        .overlay(alignment: .top) { Rectangle().fill(Nova.rule).frame(height: 1) }
        .transition(.opacity)
    }

    private var downState: some View {
        VStack(spacing: 8) {
            Text("Nova isn't running")
                .font(Nova.body)
                .foregroundStyle(Nova.inkPrimary)
            Text(model.downDetail)
                .font(Nova.caption)
                .tracking(Nova.captionTracking)
                .foregroundStyle(Nova.inkTertiary)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 128)
        .overlay(alignment: .top) { Rectangle().fill(Nova.rule).frame(height: 1) }
    }

    // MARK: - Footer
    //
    // The lowest-contrast text in the product, on purpose: present for the
    // first dozen summons, invisible thereafter. A persistent, ignorable legend.

    private var showsLoopKeys: Bool {
        !model.blockedOnPermission && model.tab == .loops && !model.rows.isEmpty
    }

    private var footer: some View {
        HStack(spacing: Nova.space6) {
            if model.blockedOnPermission {
                Text("⏎ open settings")
            } else if showsLoopKeys {
                // ↑↓ is left out: moving through a list with the arrows is
                // what everyone expects, and the footer is short on room.
                Text("⏎ done")
                Text("S snooze")
            }
            if !model.blockedOnPermission { Text("⌥←→ tabs") }
            Text("esc close")
            Spacer(minLength: 0)
            // Rating judges Nova rather than handling the loop, so it sits
            // apart from the loop actions.
            if showsLoopKeys { Text("Y/N real?") }
        }
        .font(Nova.caption)
        .tracking(Nova.captionTracking)
        .foregroundStyle(Nova.inkQuaternary)
        .padding(.horizontal, Nova.space6)
        .frame(height: Nova.footerHeight)
        .overlay(alignment: .top) { Rectangle().fill(Nova.rule).frame(height: 1) }
    }
}

// MARK: - Loop row

private struct LoopRowView: View {
    let row: PanelModel.Row
    @ObservedObject var model: PanelModel

    /// `Slack · Dana Reyes · today 3:42 PM`, with the person in the accent when they
    /// owe the user. Without a cue every row read as the user's own task —
    /// "send doc…" looked like theirs when Dana had offered it (measured
    /// 2026-09-24). The section header says who owes whom; the name says who.
    private var metaLine: Text {
        let parts = row.loop.metaParts
        var line = Text("")
        for (i, part) in parts.enumerated() {
            if i > 0 { line = line + Text(" · ").foregroundColor(Nova.inkTertiary) }
            let ink = part.isPerson && row.loop.isWaitingOn ? Nova.accent : Nova.inkTertiary
            line = line + Text(part.text).foregroundColor(ink)
        }
        // Rated real (Y). Not-real loops leave the list, so only ✓ is shown.
        if row.loop.feedback == 1 {
            line = line + Text(" · ✓").foregroundColor(Nova.statusLive)
        }
        return line
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(row.loop.description)
                .font(Nova.bodyEmphasis)
                .foregroundStyle(Nova.inkPrimary)
                // Expanded rows wrap; collapsed rows stay one line so the list
                // still scans. The daemon writes whole paragraphs, so without
                // the expanded case a long loop is simply unreadable.
                .lineLimit(row.expanded ? nil : 1)
                .truncationMode(.tail)
                .fixedSize(horizontal: false, vertical: row.expanded)
                .textSelection(.enabled)

            switch row.mode {
            case .plain:
                metaLine
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .lineLimit(1)

            case .snooze:
                HStack(spacing: Nova.space5) {
                    Text("snooze until").foregroundStyle(Nova.inkTertiary)
                    choice("1 in an hour") { model.snoozeFocused(.hour) }
                    choice("2 tomorrow") { model.snoozeFocused(.tomorrow) }
                    choice("3 next week") { model.snoozeFocused(.nextWeek) }
                    Text("esc back").foregroundStyle(Nova.inkQuaternary)
                }
                .font(Nova.caption)
                .tracking(Nova.captionTracking)
                .foregroundStyle(Nova.inkSecondary)

            case .confirm:
                HStack(spacing: Nova.space5) {
                    // "permanently" is stated because it is true — the row
                    // keeps its dedup key, so the same commitment can never
                    // resurface. Hiding that would erode trust on discovery.
                    Text("Dismiss permanently?").foregroundStyle(Nova.inkTertiary)
                    choice("⏎ yes", tint: Nova.accent) { model.confirmDismiss() }
                    Text("esc cancel").foregroundStyle(Nova.inkQuaternary)
                }
                .font(Nova.caption)
                .tracking(Nova.captionTracking)
                .foregroundStyle(Nova.inkSecondary)

            case .notReal:
                HStack(spacing: Nova.space5) {
                    // Hiding is permanent, like dismiss: the same false loop
                    // is never raised again. Said plainly for the same reason.
                    Text("Not a real loop?").foregroundStyle(Nova.inkTertiary)
                    choice("⏎ hide", tint: Nova.accent) { model.confirmNotReal() }
                    Text("esc back").foregroundStyle(Nova.inkQuaternary)
                }
                .font(Nova.caption)
                .tracking(Nova.captionTracking)
                .foregroundStyle(Nova.inkSecondary)
            }

            // Buttons live only in the expanded row. The collapsed list stays
            // keyboard-first and uncluttered; a user who opened a row has
            // already said they want to deal with it, and that is where the
            // mouse deserves real targets.
            if row.expanded && row.mode == .plain {
                HStack(spacing: Nova.space4) {
                    actionButton("Done", tint: Nova.accent) { model.done() }
                    actionButton("Snooze") { model.beginSnooze() }
                    actionButton("Dismiss") { model.beginDismiss() }
                }
                .padding(.top, 5)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Nova.space6)
        .padding(.vertical, row.expanded ? 12 : 0)
        .frame(minHeight: row.expanded ? 0 : Nova.rowHeight, alignment: .leading)
        .background(row.background)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(row.showsBar ? Nova.accent : .clear)
                .frame(width: 2)
        }
        .opacity(row.leaving ? 0 : 1)
        .offset(y: row.leaving ? -2 : 0)
        .frame(maxHeight: row.collapsed ? 0 : .infinity)
        .clipped()
        .contentShape(Rectangle())
        // Continuous, so the first real mouse move after keyboard use takes
        // the row already under the pointer without leaving it first.
        .onContinuousHover { if case .active = $0 { model.hover(row) } }
        .onTapGesture { model.click(row) }
        .animation(row.flaring ? Nova.ease(0.12) : Nova.motionBase, value: row.background)
        .animation(Nova.motionBase, value: row.leaving)
        .animation(Nova.motionBase, value: row.collapsed)
        .animation(Nova.motionBase, value: row.expanded)
    }

    private func actionButton(_ title: String, tint: Color = Nova.inkSecondary,
                              action: @escaping () -> Void) -> some View {
        ChoiceChip(text: title, tint: tint, action: action)
            .font(Nova.caption)
    }

    private func choice(_ text: String, tint: Color = Nova.inkSecondary, action: @escaping () -> Void) -> some View {
        ChoiceChip(text: text, tint: tint, action: action)
    }
}

/// `NSVisualEffectView` at the HUD material, pinned dark, with its own blur
/// left alone. The view does not inherit SwiftUI's colour scheme, so the
/// appearance is set on it directly; without that it follows the system and
/// turns light in Light mode under light ink.
struct VisualEffectBackground: NSViewRepresentable {
    /// `.behindWindow` samples the desktop and needs a non-opaque window;
    /// `.withinWindow` samples only what is behind it inside the window. The
    /// panel is a transparent `NSPanel`, so it takes the first.
    var blending: NSVisualEffectView.BlendingMode = .behindWindow

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .hudWindow
        view.blendingMode = blending
        view.state = .active
        view.appearance = NSAppearance(named: .darkAqua)
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {
        view.blendingMode = blending
    }
}

/// One captured fact. Two lines: the fact, then where and when it came from.
private struct MemoryRowView: View {
    let memory: Memory

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            redactedText
            Text([memory.sourceApp, memory.age].compactMap { $0 }.joined(separator: " · "))
                .font(Nova.caption)
                .tracking(Nova.captionTracking)
                .foregroundStyle(Nova.inkQuaternary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Nova.space6)
        .padding(.vertical, 10)
    }

    /// Withheld spans render as solid ink blocks sized to the text they
    /// replace (design spec §1.3). Ink, never blur: blur implies recoverable.
    private var redactedText: some View {
        let runs = Redaction.runs(in: memory.text)
        return runs.reduce(Text("")) { acc, run in
            acc + (run.redacted
                ? Text(String(repeating: "█", count: max(run.text.count, 2)))
                    .foregroundColor(Nova.inkSecondary)
                : Text(run.text).foregroundColor(Nova.inkPrimary))
        }
        .font(Nova.body)
        .lineLimit(3)
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct ChoiceChip: View {
    let text: String
    let tint: Color
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Text(text)
            .foregroundStyle(hovering ? Nova.inkPrimary : tint)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: Nova.radiusXS, style: .continuous)
                    .fill(hovering ? Nova.accentWash : .clear)
            )
            .contentShape(Rectangle())
            .onHover { inside in
                hovering = inside
                // The cursor is the clearest possible statement that something
                // is clickable, and it costs nothing.
                if inside { NSCursor.pointingHand.push() } else { NSCursor.pop() }
            }
            .onTapGesture(perform: action)
            .animation(Nova.motionQuick, value: hovering)
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

/// Nova's glass: HUD material, a dark veil that keeps it dark over white
/// pages, and a faint gradient tint. Shared by the panel, the digest card and
/// Your Space.
///
/// The veil is what makes the material safe to use under light ink: HUD glass
/// over a white page lightens far enough to lose the text, and 0.65 of the
/// raised surface holds it dark without making it opaque.
struct NovaGround: View {
    /// 0.65 is a floor rather than a default. Below it, HUD glass over a
    /// white page washes out to mid-grey and the light ink stops being
    /// readable — measured on the panel. Raise it for a surface that wants
    /// less desktop showing through; do not lower it.
    var veil: Double = 0.65
    var blending: NSVisualEffectView.BlendingMode = .behindWindow

    var body: some View {
        ZStack {
            VisualEffectBackground(blending: blending)
            Nova.surfaceRaised.opacity(veil)
            LinearGradient(colors: [Nova.gradFrom, Nova.gradTo],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
                .opacity(0.10)
        }
    }
}
