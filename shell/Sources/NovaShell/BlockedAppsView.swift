// Your Space → Blocked apps (F5.5, D21's list made visible).
//
// Built to the Claude Design file "Your Space - Blocked apps"; the motion is
// docs/design/motion-spec.md, and every timing here is a token from §1 rather than a
// number chosen locally.
//
// The pane's one hard design problem, and its answer: the always-off rows must
// read as reassurance, not as disabled controls. So nothing on them looks
// switchable — no toggle, no lock, no grey. Full-ink text, no hover state, and
// Nova's own closed aperture in accent beside each one: the shut eye, in the
// colour that means Nova is working. Each row carries a live count, which is
// what turns a guarantee into evidence.
import SwiftUI
import AppKit

struct BlockedAppsView: View {
    @ObservedObject var model: InspectorModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Set once per window session, so list entry staggers on the first open
    /// and never on a revisit (motion spec §03).
    @State private var shown = false
    /// Set 300ms after the list starts loading; until then nothing says so.
    @State private var slowEnough = false

    var body: some View {
        ZStack(alignment: .bottom) {
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if model.connection == .unreachable { coldNotice }
                    alwaysOff
                    yourList
                }
                .padding(.bottom, Nova.space8)
            }
            .scrollIndicators(.automatic)

            if let toast = model.toast {
                ToastView(message: toast) { model.clearToast() }
                    .padding(.bottom, Nova.space6)
            }
        }
        .onAppear {
            guard !shown else { return }
            withAnimation(nil) { shown = false }
            DispatchQueue.main.async { shown = true }
        }
    }

    // MARK: Always off

    private var alwaysOff: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(
                title: "ALWAYS OFF",
                note: "Built into Nova and checked before any window is read. "
                    + "No setting, update or request can switch these on",
                trailing: hardTotal,
            )

            VStack(alignment: .leading, spacing: 0) {
                if model.hard.isEmpty {
                    // The rows are named by the daemon, so with no answer the
                    // pane says the checks are running rather than listing
                    // four it would have to keep its own copy of.
                    Text(model.connection == .unreachable
                        ? "The checks are running inside Nova. This window can't list "
                            + "them until Nova answers."
                        : " ")
                        .font(Nova.caption)
                        .tracking(Nova.captionTracking)
                        .foregroundStyle(Nova.inkTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 440, alignment: .leading)
                        .padding(.horizontal, Nova.space8)
                        .padding(.vertical, Nova.space4)
                } else {
                    ForEach(Array(model.hard.enumerated()), id: \.element.id) { i, rule in
                        HardRow(rule: rule, count: model.skipped?[rule.id])
                            .entry(index: i, shown: shown, reduce: reduceMotion)
                    }
                }
            }
            .padding(.vertical, 6)
        }
    }

    /// The header's own total. Unknown rather than zero when Nova has not
    /// answered: the checks still ran, this window just cannot say how often.
    private var hardTotal: String {
        guard let skipped = model.skipped else { return "unknown" }
        let n = model.hard.reduce(0) { $0 + (skipped[$1.id] ?? 0) }
        return "\(n.formatted()) skipped"
    }

    // MARK: Your list

    private var yourList: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(
                title: "YOUR LIST",
                note: "Apps and sites you've added. Nova skips them the same way, "
                    + "before reading anything",
                trailing: mineTotal,
            )

            if model.addOpen { AddRuleForm(model: model) }

            if model.connection == .unreachable {
                twoLines(
                    "Your list can't be shown until Nova answers",
                    "This window can't see it right now, which isn't the same as it being empty",
                )
            } else if !model.blockedLoaded {
                // Nothing reads as loading for the first 300ms, so a fast
                // reply never flashes this (motion spec §09). The row keeps
                // its height either way, so the list does not jump when the
                // text appears.
                Text(slowEnough ? "Asking Nova for your list" : " ")
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkTertiary)
                    .padding(.horizontal, Nova.space8)
                    .padding(.vertical, Nova.space5)
                    .animation(.nova(Nova.quick), value: slowEnough)
                    .task {
                        try? await Task.sleep(for: .milliseconds(300))
                        slowEnough = true
                    }
            } else if model.rules.isEmpty {
                emptyList
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(model.rules.enumerated()), id: \.element.id) { i, rule in
                        RuleRow(
                            rule: rule,
                            count: model.skipped?[rule.id],
                            deleted: model.deleted[rule.id],
                            fresh: model.fresh.contains(rule.id),
                            confirming: model.confirming == rule.id,
                            model: model,
                        )
                        .entry(index: i, shown: shown, reduce: reduceMotion)
                    }
                }
                .padding(.vertical, 6)
            }
        }
    }

    private var mineTotal: String {
        if model.connection == .unreachable { return "unknown" }
        let n = model.rules.count
        return "\(n) rule\(n == 1 ? "" : "s")"
    }

    /// Empty must not read as unprotected: the four checks above are stated
    /// first, because they are already running.
    private var emptyList: some View {
        VStack(alignment: .leading, spacing: Nova.space2) {
            Text("You haven't added anything")
                .font(Nova.body)
                .foregroundStyle(Nova.inkPrimary)
            Text("The four checks above still run on every window. "
                + "Add an app or site to keep Nova out of it as well")
                .font(Nova.caption)
                .tracking(Nova.captionTracking)
                .foregroundStyle(Nova.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 440, alignment: .leading)
            Button("Add an app or site") { model.openAdd() }
                .buttonStyle(.plain)
                .font(Nova.body)
                .foregroundStyle(Nova.accent)
                .padding(.top, Nova.space1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Nova.space8)
        .padding(.top, Nova.space5)
        .padding(.bottom, Nova.space4)
    }

    private var coldNotice: some View {
        VStack(alignment: .leading, spacing: Nova.space5) {
            ApertureMark(state: .paused, size: 28, color: Nova.inkTertiary)
            Text("Nova isn't answering")
                .font(Nova.heading)
                .foregroundStyle(Nova.inkPrimary)
            Text("This window gets its lists from Nova's background process, which "
                + "hasn't responded. Nova's built-in checks — password managers, "
                + "banking, private browsing and screen sharing — apply whenever it "
                + "runs, whatever this window can see. Their wording and counts, and "
                + "your own list, can't be shown until it answers.")
                .font(Nova.body)
                .foregroundStyle(Nova.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 460, alignment: .leading)
            HStack(spacing: Nova.space4) {
                Button("Try again") { model.refresh() }
                    .buttonStyle(NovaButtonStyle(variant: .primary))
                Button("Restart Nova") { model.restart() }
                    .buttonStyle(NovaButtonStyle(variant: .secondary))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Nova.space8)
        .padding(.top, Nova.space6)
        .padding(.bottom, Nova.space5)
    }

    private func twoLines(_ a: String, _ b: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(a).font(Nova.body).foregroundStyle(Nova.inkPrimary)
            Text(b)
                .font(Nova.caption)
                .tracking(Nova.captionTracking)
                .foregroundStyle(Nova.inkTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: 460, alignment: .leading)
        .padding(.horizontal, Nova.space8)
        .padding(.vertical, Nova.space5)
    }
}

// MARK: - Rows

/// A sticky section header. The note states what the section is, where it is
/// checkable, rather than leaving it to documentation.
private struct SectionHeader: View {
    let title: String
    let note: String
    let trailing: String

    var body: some View {
        VStack(alignment: .leading, spacing: Nova.space1) {
            HStack(alignment: .firstTextBaseline, spacing: Nova.space5) {
                Text(title)
                    .font(Nova.label)
                    .tracking(Nova.labelTracking)
                    .foregroundStyle(Nova.inkSecondary)
                Spacer(minLength: 0)
                Text(trailing)
                    .font(Nova.capture)
                    .foregroundStyle(Nova.inkTertiary)
                    .monospacedDigit()
                    // A formatted string rather than a number, so it crossfades
                    // rather than rolling per digit; the rows carry the roll.
                    .contentTransition(.opacity)
                    .animation(.nova(Nova.base), value: trailing)
            }
            Text(note)
                .font(Nova.caption)
                .tracking(Nova.captionTracking)
                .foregroundStyle(Nova.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 460, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Nova.space8)
        .padding(.top, Nova.space6)
        .padding(.bottom, Nova.space3)
        // A plain fill: see SectionHead in InspectorView. A live blur under a
        // pinned header costs a re-composite every scroll frame.
        .background(Nova.surfaceRaised.opacity(0.97))
        .overlay(alignment: .bottom) { Rectangle().fill(Nova.rule).frame(height: 1) }
    }
}

/// One non-overridable category. Deliberately inert: no hover, no control, no
/// grey. A greyed row with a lock says "you can't have this"; this says "this
/// is already handled".
private struct HardRow: View {
    let rule: HardExclusion
    let count: Int?

    var body: some View {
        HStack(alignment: .top, spacing: Nova.space5) {
            ApertureMark(state: .paused, size: 14, color: Nova.accent)
                .frame(height: 19)
            VStack(alignment: .leading, spacing: 2) {
                Text(rule.title)
                    .font(Nova.body)
                    .foregroundStyle(Nova.inkPrimary)
                Text(rule.detail)
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 440, alignment: .leading)
            }
            Spacer(minLength: Nova.space5)
            SkipCount(count: count)
        }
        .padding(.horizontal, Nova.space8)
        .padding(.vertical, Nova.space4)
    }
}

/// One of the user's own rules. Remove sits in a reserved column, so its
/// appearing on hover shifts nothing (motion spec §05).
private struct RuleRow: View {
    let rule: Exclusion
    let count: Int?
    let deleted: Int?
    let fresh: Bool
    let confirming: Bool
    @ObservedObject var model: InspectorModel

    @State private var hover = false

    var body: some View {
        Group {
            if confirming { confirm } else { normal }
        }
        .background(fresh ? Nova.accentWash : (hover ? Nova.surfaceSunken : .clear))
        .onHover { h in withAnimation(.nova(Nova.quick)) { hover = h } }
        .animation(.nova(Nova.considered), value: fresh)
    }

    private var normal: some View {
        HStack(alignment: .top, spacing: Nova.space5) {
            KindBadge(kind: rule.kind)
            VStack(alignment: .leading, spacing: 2) {
                Text(rule.title)
                    .font(Nova.body)
                    .foregroundStyle(Nova.inkPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let sub = subline {
                    Text(sub)
                        .font(Nova.caption)
                        .tracking(Nova.captionTracking)
                        .foregroundStyle(Nova.inkTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .contentTransition(.opacity)
                }
            }
            Spacer(minLength: Nova.space4)
            Button("Remove") { model.askRemove(rule.id) }
                .buttonStyle(.plain)
                .font(Nova.caption)
                .foregroundStyle(hover ? Nova.inkPrimary : Nova.inkSecondary)
                .padding(.horizontal, Nova.space4)
                .frame(height: 22)
                .opacity(hover ? 1 : 0)
                .animation(.nova(Nova.quick), value: hover)
            SkipCount(count: count)
        }
        .padding(.horizontal, Nova.space8)
        .padding(.vertical, Nova.space4)
    }

    /// The bundle id, or what an add just deleted. The deletion is reported
    /// as done because the daemon has already done it by the time it replies.
    private var subline: String? {
        if let deleted, fresh {
            return deleted == 0
                ? "Nothing was captured from it"
                : "\(deleted) capture\(deleted == 1 ? "" : "s") deleted"
        }
        return rule.subtitle
    }

    /// Inline, and it states the consequence. No undo: re-adding is one step,
    /// which is a better guarantee than a window of regret.
    private var confirm: some View {
        HStack(spacing: Nova.space4) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Remove \(rule.title)? Nova reads it again from now on")
                    .font(Nova.body)
                    .foregroundStyle(Nova.inkPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Captures already deleted stay deleted")
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkSecondary)
            }
            Spacer(minLength: Nova.space4)
            Button("Cancel") { model.cancelRemove() }
                .buttonStyle(NovaButtonStyle(variant: .secondary))
            Button("Remove") { model.remove(rule.id) }
                .buttonStyle(NovaButtonStyle(variant: .primary))
        }
        .padding(.horizontal, Nova.space8)
        .padding(.vertical, Nova.space4)
        .frame(minHeight: 34)
    }
}

private struct KindBadge: View {
    let kind: String

    var body: some View {
        Text(kind.uppercased())
            .font(Nova.label)
            .tracking(Nova.labelTracking)
            .foregroundStyle(Nova.inkSecondary)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .overlay(
                RoundedRectangle(cornerRadius: Nova.radiusXS, style: .continuous)
                    .strokeBorder(Nova.ruleStrong, lineWidth: 1),
            )
            .frame(width: 56, alignment: .leading)
            .padding(.top, 2)
    }
}

/// A skip count, which rolls when it changes and holds accent briefly so the
/// eye can find it (motion spec §06). `nil` is "unknown", never zero.
private struct SkipCount: View {
    let count: Int?

    /// The last value this row showed, so a change can be told from a first
    /// render. nil until the row has rendered once.
    @State private var previous: Int?
    /// True while the row holds accent after a change.
    @State private var acked = false
    /// When the colour last held, for the rate limit.
    @State private var lastAck = Date.distantPast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            if let count {
                Text(count, format: .number)
                    .font(Nova.capture)
                    .foregroundStyle(acked ? Nova.accent : Nova.inkPrimary)
                    .monospacedDigit()
                    .contentTransition(.numericText(value: Double(count)))
                    .animation(.nova(Nova.base), value: count)
                Text("skipped")
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkTertiary)
            } else {
                Text("unknown")
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkTertiary)
            }
        }
        .frame(width: 96, alignment: .trailing)
        .onChange(of: count) { old, new in acknowledge(from: old, to: new) }
        .onAppear { previous = count }
    }

    /// Holds accent for `ackHold`, then settles (motion spec §06).
    ///
    /// Rate-limited to once per row per 10s: during a meeting the
    /// screen-sharing count climbs every few seconds, and an accent hold on
    /// each one is a flicker rather than a signal. The number always rolls;
    /// only the colour is limited.
    private func acknowledge(from old: Int?, to new: Int?) {
        defer { previous = new }
        guard let new, let old, new != old else { return }
        // A first render is not a change, and neither is the list arriving.
        guard previous != nil else { return }
        // Nobody saw it arrive, so nothing announces it.
        guard NSApp.keyWindow != nil else { return }
        guard Date().timeIntervalSince(lastAck) >= Nova.ackRateLimit else { return }

        lastAck = Date()
        acked = true
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(Nova.ackHold))
            // The hold itself survives reduced motion — it carries
            // information rather than movement, and the accent is how the
            // user finds the number that changed. Only its fade shortens.
            withAnimation(reduceMotion ? .linear(duration: 0.1) : .nova(Nova.considered)) {
                acked = false
            }
        }
    }
}

// MARK: - List entry

extension View {
    /// Rows rise 4px and fade in, 24ms apart, capped so a long list costs the
    /// same as six rows (motion spec §03). A rise rather than a scale: scaling
    /// a full-width row moves its edges by 10px, which reads as a lurch.
    func entry(index: Int, shown: Bool, reduce: Bool) -> some View {
        opacity(shown ? 1 : 0)
            .offset(y: shown || reduce ? 0 : Nova.offsetRow)
            .animation(
                reduce
                    ? .linear(duration: 0.1)
                    : .nova(Nova.base).delay(Double(min(index, Nova.staggerCap - 1)) * Nova.staggerStep),
                value: shown,
            )
    }
}
