/// The morning digest card (spec §2, §5.2): Nova's own window, not a system
/// notification. Drops down from the glyph, stays until acted on, and keeps
/// nothing once closed.
import AppKit
import SwiftUI

final class DigestWindow: NSPanel {
    init() {
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        isFloatingPanel = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        hidesOnDeactivate = false
        animationBehavior = .none
    }
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class DigestCardController {
    private var window: DigestWindow?
    private var keyMonitor: Any?
    private let openLoops: () -> Void

    init(openLoops: @escaping () -> Void) { self.openLoops = openLoops }

    func show(_ digest: MorningDigest, under glyph: NSRect?) {
        close()   // never two cards (review I4)
        let time = Date()
        let actions: (open: () -> Void, close: () -> Void, focus: () -> Void) = (
            { [weak self] in self?.open() }, { [weak self] in self?.close() }, { [weak self] in self?.focus() })
        let screen = NSScreen.screens.first { $0.frame.contains(glyph?.origin ?? .zero) } ?? NSScreen.main
        let visible = screen?.visibleFrame ?? .zero
        let limit = visible.height - 16

        // Measure at natural height; if it does not fit, build it again at the
        // limit so the blocks scroll between a fixed header and footer.
        let natural = NSHostingView(rootView: DigestCardView(
            digest: digest, time: time, height: nil,
            onOpen: actions.open, onClose: actions.close, onFocus: actions.focus)).fittingSize
        let height = min(natural.height, limit)
        let host = NSHostingView(rootView: DigestCardView(
            digest: digest, time: time, height: natural.height > limit ? limit : nil,
            onOpen: actions.open, onClose: actions.close, onFocus: actions.focus))
        // The window is sized here, never by content (as PanelWindow does).
        host.sizingOptions = []
        let w = DigestWindow()
        w.contentView = host
        let width = natural.width
        // Top right, where macOS shows notification banners and where the
        // menu-bar icons (Nova's among them) live: 12 pt in from the screen's
        // right edge and 8 pt below the menu bar.
        let x = visible.maxX - width - 12
        w.setFrame(NSRect(x: x, y: visible.maxY - height - 8, width: width, height: height), display: true)
        // Full opacity at once. A fade-in from 0 on a non-activating borderless
        // panel can stay at 0 (PanelWindow.animateIn), and a card nobody sees
        // on the one morning it shows is the worst outcome (review C1).
        w.alphaValue = 1
        w.orderFrontRegardless()
        window = w
        digestLog.notice("card shown: frame=\(NSStringFromRect(w.frame), privacy: .public) glyph=\(glyph.map { NSStringFromRect($0) } ?? "nil", privacy: .public) visible=\(w.isVisible, privacy: .public) screen=\(NSStringFromRect(visible), privacy: .public)")

        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] e in
            guard let self, e.window === self.window else { return e }
            switch Int(e.keyCode) {
            case 36, 76: self.open(); return nil      // Return, keypad Enter
            case 53: self.close(); return nil         // Escape
            default: return e
            }
        }
    }

    private func open() { close(); openLoops() }

    /// A click on the card's body takes the keyboard, so ⏎ and esc then work.
    /// It never takes it on its own: a card appearing mid-sentence must not
    /// swallow the Return the user was typing (review I1).
    private func focus() { window?.makeKey() }

    func close() {
        if window != nil { digestLog.notice("card closed") }
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        keyMonitor = nil
        guard let w = window else { return }
        window = nil
        NSAnimationContext.runAnimationGroup { $0.duration = Nova.quick; w.animator().alphaValue = 0 }
            completionHandler: { w.orderOut(nil) }
    }
}

/// "Good morning" before noon, "Good afternoon" until five, then "Good
/// evening": the card shows at the first chance of the day, not only mornings.
enum DigestGreeting {
    static func text(_ date: Date, calendar: Calendar = .current) -> String {
        switch calendar.component(.hour, from: date) {
        case ..<12: return "Good morning"
        case ..<17: return "Good afternoon"
        default: return "Good evening"
        }
    }
}

/// The Briefing layout: greeting and date, a one-line tally, one row per
/// person with an initials badge, yesterday set off below, and the actions.
private struct DigestCardView: View {
    let digest: MorningDigest
    let time: Date
    /// nil: natural height. Set: the card is capped and the rows scroll.
    let height: CGFloat?
    let onOpen: () -> Void
    let onClose: () -> Void
    let onFocus: () -> Void

    private var greeting: String {
        let hello = DigestGreeting.text(time)
        return digest.user.map { "\(hello), \($0)" } ?? hello
    }

    private var tally: String {
        let owe = digest.owe.reduce(0) { $0 + ($1.loops ?? 1) }
        let waiting = digest.waitingOn.reduce(0) { $0 + ($1.loops ?? 1) }
        var parts = ["\(digest.count) open"]
        if owe > 0 { parts.append("\(owe) you owe") }
        if waiting > 0 { parts.append("\(waiting) waiting") }
        return parts.joined(separator: "  ·  ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(greeting).font(Nova.title).foregroundStyle(Nova.inkPrimary)
                    Text(time.formatted(.dateTime.weekday(.wide).day().month(.wide)))
                        .font(Nova.caption).tracking(Nova.captionTracking)
                        .foregroundStyle(Nova.inkTertiary)
                }
                Spacer()
                Text("✕").font(Nova.caption).foregroundStyle(Nova.inkTertiary)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle()).onTapGesture(perform: onClose)
            }

            Text(tally)
                .font(Nova.bodyEmphasis).monospacedDigit()
                .foregroundStyle(Nova.inkSecondary)
                .padding(.top, Nova.space5)
                .padding(.bottom, Nova.space5)

            rule

            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: Nova.space5) {
                    ForEach(Array(digest.owe.enumerated()), id: \.offset) { _, b in
                        person(b, waiting: false)
                    }
                    ForEach(Array(digest.waitingOn.enumerated()), id: \.offset) { _, b in
                        person(b, waiting: true)
                    }
                    if let y = digest.yesterday {
                        rule
                        VStack(alignment: .leading, spacing: 6) {
                            Text("YESTERDAY").font(Nova.label).tracking(Nova.labelTracking)
                                .foregroundStyle(Nova.inkQuaternary)
                            HStack(alignment: .top, spacing: Nova.space5) {
                                Rectangle().fill(Nova.accentMuted).frame(width: 2)
                                Text(y).font(Nova.body).foregroundStyle(Nova.inkSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding(.vertical, Nova.space5)
            }
            .scrollIndicators(.hidden)

            HStack {
                Text("Open loops  ⏎")
                    .font(Nova.bodyEmphasis).foregroundStyle(Nova.inkPrimary)
                    .padding(.horizontal, Nova.space5).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: Nova.radiusXS, style: .continuous)
                        .fill(Nova.accentWash))
                    .contentShape(Rectangle()).onTapGesture(perform: onOpen)
                Spacer()
                Text("later  esc").font(Nova.caption).foregroundStyle(Nova.inkQuaternary)
                    .contentShape(Rectangle()).onTapGesture(perform: onClose)
            }
            .padding(.top, Nova.space5)
        }
        .padding(Nova.space6)
        .frame(width: Nova.panelWidth)
        .frame(height: height)
        .fixedSize(horizontal: false, vertical: height == nil)
        .background(NovaGround())
        .clipShape(RoundedRectangle(cornerRadius: Nova.radiusXL, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nova.radiusXL, style: .continuous)
            .strokeBorder(Nova.rule, lineWidth: 1))
        .contentShape(Rectangle())
        .onTapGesture(perform: onFocus)
        .environment(\.colorScheme, .dark)
    }

    private var rule: some View { Rectangle().fill(Nova.rule).frame(height: 1) }

    /// One person: an initials badge, the name, and the AI's sentence for them.
    /// Someone the user waits on has their name in the accent and a hollow
    /// marker, as in the panel's WAITING ON section.
    private func person(_ b: MorningDigest.Block, waiting: Bool) -> some View {
        HStack(alignment: .top, spacing: Nova.space5) {
            badge(b.person, waiting: waiting)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(b.person ?? (waiting ? "Someone" : "Yourself"))
                        .font(Nova.bodyEmphasis)
                        .foregroundStyle(waiting ? Nova.accent : Nova.inkPrimary)
                    Spacer()
                    if waiting {
                        Text("waiting on  ◌").font(Nova.caption).foregroundStyle(Nova.inkTertiary)
                    }
                }
                Text(b.text).font(Nova.body).foregroundStyle(Nova.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func badge(_ person: String?, waiting: Bool) -> some View {
        let initials = (person ?? "·").split(separator: " ").prefix(2)
            .compactMap(\.first).map(String.init).joined().uppercased()
        return Text(initials)
            .font(Nova.label).tracking(Nova.labelTracking)
            .foregroundStyle(waiting ? Nova.accent : Nova.inkSecondary)
            .frame(width: 28, height: 28)
            .background(Circle().fill(waiting ? Nova.accentWash : Nova.surfaceRaised))
            .overlay(Circle().strokeBorder(waiting ? Nova.accent.opacity(0.5) : Nova.rule, lineWidth: 1))
    }
}

