// Your Space → Your data (F5.3 delete, F5.4 retention).
//
// Built to the Claude Design file "Your Space - Your data" (YourDataPane);
// every timing is a motion-spec token. The counts in every confirm are
// Nova's own (count_for_delete), never estimated here, and a delete is
// reported only after Nova says it is done.
import SwiftUI
import AppKit

struct YourDataView: View {
    @ObservedObject var model: InspectorModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var shown = false
    /// Which time chip owns the open confirm. Nil for app and everything.
    @State private var chip: TimeChip?
    @State private var rangeFrom = YourDataView.defaultFrom
    @State private var rangeTo = Calendar.current.startOfDay(for: Date())
    /// The Keep values at the first change this window session, so a
    /// shortening can say what it will remove.
    @State private var keepBaseline: Retention?
    /// Set 300ms after loading starts; until then nothing says so.
    @State private var slowEnough = false

    enum TimeChip: CaseIterable {
        case hour, today, week, custom

        var title: String {
            switch self {
            case .hour: return "Last hour"
            case .today: return "Today"
            case .week: return "Last 7 days"
            case .custom: return "Custom range…"
            }
        }
    }

    private static let confirmID = "your-data-confirm"

    var body: some View {
        ZStack(alignment: .bottom) {
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if model.connection == .unreachable { coldNotice }
                        holds
                        byTime
                        byApp
                        everything
                        keep
                    }
                    .padding(.bottom, Nova.space8)
                }
                .scrollIndicators(.automatic)
                // Scroll only as far as needed to show the whole well, and
                // only once it has opened (motion spec §10).
                .onChange(of: model.dataConfirm?.scope) { _, scope in
                    guard scope != nil else { chip = nil; return }
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(250))
                        withAnimation(reduceMotion ? nil : .nova(Nova.considered)) {
                            proxy.scrollTo(Self.confirmID)
                        }
                    }
                }
            }

            if let toast = model.toast {
                ToastView(message: toast) { model.clearToast() }
                    .padding(.bottom, Nova.space6)
                    .allowsHitTesting(false)
            }
        }
        .onExitCommand { model.cancelDelete() }
        .onAppear {
            guard !shown else { return }
            DispatchQueue.main.async { shown = true }
        }
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            slowEnough = true
        }
    }

    // MARK: State

    private var live: Bool { model.connection != .unreachable && model.dataSummary != nil }
    private var unreachable: Bool { model.connection == .unreachable }
    private var summary: DataSummary? { unreachable ? nil : model.dataSummary }
    private var deleting: Bool { model.dataConfirm?.deleting == true }
    private var asking: String { slowEnough ? "Asking Nova" : " " }

    // MARK: Cold

    private var coldNotice: some View {
        VStack(alignment: .leading, spacing: Nova.space5) {
            ApertureMark(state: .paused, size: 28, color: Nova.inkTertiary)
            Text("Nova isn't answering")
                .font(Nova.heading)
                .foregroundStyle(Nova.inkPrimary)
            Text("This window gets its counts from Nova's background process, which "
                + "hasn't responded\(since). Nothing can be counted or deleted until it "
                + "answers, so every delete below is off. Your memory is untouched.")
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
            .padding(.top, Nova.space2)
            Text(retryLine)
                .font(Nova.caption)
                .tracking(Nova.captionTracking)
                .foregroundStyle(Nova.inkTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Nova.space8)
        .padding(.top, Nova.space8)
        .padding(.bottom, 20)
    }

    private var since: String {
        model.lastAnswer.map { " since \(Self.clock($0))" } ?? ""
    }

    private var retryLine: String {
        let every = "Retrying every \(Int(InspectorModel.retryInterval)) seconds"
        guard let last = model.lastAnswer else { return every }
        return "\(every) · last answer at \(Self.clock(last))"
    }

    // MARK: What Nova holds

    private var holds: some View {
        VStack(alignment: .leading, spacing: 0) {
            DataSectionHeader(title: "WHAT NOVA HOLDS", trailing: holdsTrailing,
                              topRule: unreachable)
            HStack(alignment: .top, spacing: Nova.space6) {
                stat(summary?.captures, "capture", "captures", index: 0)
                stat(summary?.memories, "memory", "memories", index: 1)
                stat(summary?.loops, "loop", "loops", index: 2)
                sizeStat.entry(index: 3, shown: shown, reduce: reduceMotion)
            }
            .padding(.horizontal, Nova.space8)
            .padding(.top, 14)
            .padding(.bottom, Nova.space3)

            VStack(alignment: .leading, spacing: Nova.space1) {
                caption(oldestLine, Nova.inkSecondary)
                if let s = summary, s.rawRemoved > 0 {
                    HStack(spacing: 0) {
                        Text("Text removed from ").font(Nova.caption)
                        RollingFigure(value: s.rawRemoved, font: Nova.caption, ink: Nova.inkSecondary)
                        Text(" of these by your Keep setting").font(Nova.caption)
                    }
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkSecondary)
                }
            }
            .padding(.horizontal, Nova.space8)
            .padding(.top, Nova.space3)
            .padding(.bottom, Nova.space6)
        }
    }

    private var holdsTrailing: String {
        if unreachable { return "unknown" }
        guard let s = model.dataSummary else { return slowEnough ? "Asking Nova" : "" }
        return s.asOf.map { "as of \(Self.clock(Self.date($0)))" } ?? ""
    }

    private func stat(_ value: Int?, _ one: String, _ many: String, index: Int) -> some View {
        VStack(alignment: .leading, spacing: Nova.space1) {
            Group {
                if let value {
                    RollingFigure(value: value, font: Nova.title, ink: Nova.inkPrimary)
                } else {
                    Text(unreachable ? "—" : " ")
                        .font(Nova.title)
                        .foregroundStyle(Nova.inkTertiary)
                }
            }
            caption(value == 1 ? one : many, Nova.inkTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .entry(index: index, shown: shown, reduce: reduceMotion)
    }

    private var sizeStat: some View {
        VStack(alignment: .leading, spacing: Nova.space1) {
            Text(summary.map { $0.bytes.map(Self.size) ?? "unknown" } ?? (unreachable ? "—" : " "))
                .font(Nova.title)
                .monospacedDigit()
                .foregroundStyle(summary == nil ? Nova.inkTertiary : Nova.inkPrimary)
                .contentTransition(.opacity)
                .animation(.nova(Nova.base), value: summary?.bytes)
            caption("on this Mac", Nova.inkTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var oldestLine: String {
        if unreachable { return "Counts can't be shown until Nova answers" }
        guard let s = model.dataSummary else { return " " }
        guard let oldest = s.oldest else { return "Nova holds no captures right now" }
        return "Oldest capture \(Self.day(Self.date(oldest)))"
    }

    // MARK: Delete by time

    private var byTime: some View {
        VStack(alignment: .leading, spacing: 0) {
            DataSectionHeader(
                title: "DELETE BY TIME",
                note: unreachable
                    ? "Nova has to answer before anything can be counted or deleted"
                    : "Captures from that time, and the memories formed from them",
                topRule: true)
            FlowRow(spacing: Nova.space4) {
                ForEach(TimeChip.allCases, id: \.self) { c in
                    Chip(title: c.title, selected: chip == c && model.dataConfirm != nil,
                         enabled: live && !deleting) { open(c) }
                }
            }
            .padding(.horizontal, Nova.space8)
            .padding(.top, Nova.space5)
            .padding(.bottom, Nova.space2)

            if chip == .custom, model.dataConfirm != nil { customRange }

            if chip != nil, let confirm = model.dataConfirm, confirm.scope.isRange {
                ConfirmWell(model: model, confirm: confirm, everything: false)
                    .id(Self.confirmID)
                    .padding(.horizontal, Nova.space8)
                    .padding(.top, Nova.space4)
                    .padding(.bottom, Nova.space2)
                    .transition(wellTransition)
            }
            Color.clear.frame(height: Nova.space5)
        }
        .animation(.nova(Nova.base), value: model.dataConfirm?.scope)
    }

    private var customRange: some View {
        HStack(spacing: Nova.space4) {
            caption("From", Nova.inkSecondary)
            DatePicker("", selection: $rangeFrom, in: ...rangeTo, displayedComponents: .date)
                .labelsHidden()
                .datePickerStyle(.field)
            caption("to", Nova.inkSecondary)
            DatePicker("", selection: $rangeTo, in: rangeFrom...Date(), displayedComponents: .date)
                .labelsHidden()
                .datePickerStyle(.field)
            caption(rangeNote, Nova.inkTertiary)
        }
        .disabled(deleting)
        .padding(.horizontal, Nova.space8)
        .padding(.top, Nova.space4)
        .onChange(of: rangeFrom) { _, _ in open(.custom) }
        .onChange(of: rangeTo) { _, _ in open(.custom) }
    }

    private var rangeNote: String {
        let days = (Calendar.current.dateComponents([.day], from: rangeFrom, to: rangeTo).day ?? 0) + 1
        guard days >= 1 else { return "Pick a start before the end" }
        return "\(days) day\(days == 1 ? "" : "s"), both included"
    }

    private func open(_ c: TimeChip) {
        guard live, !deleting else { return }
        let now = Date()
        let cal = Calendar.current
        let from: Date, to: Date, label: String
        switch c {
        case .hour:
            (from, to, label) = (now.addingTimeInterval(-3600), now, "from the last hour")
        case .today:
            (from, to, label) = (cal.startOfDay(for: now), now, "from today")
        case .week:
            (from, to, label) = (now.addingTimeInterval(-7 * 86_400), now, "from the last 7 days")
        case .custom:
            let start = cal.startOfDay(for: rangeFrom)
            let end = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: rangeTo)) ?? now
            let same = cal.isDate(rangeFrom, inSameDayAs: rangeTo)
            (from, to, label) = (start, min(end, now),
                                 same ? "from \(Self.day(rangeFrom))"
                                      : "from \(Self.day(rangeFrom)) to \(Self.day(rangeTo))")
        }
        guard from < to else { return }
        chip = c
        model.askDelete(.range(from: Self.ms(from), to: Self.ms(to)), label: label)
    }

    // MARK: Delete by app

    private var byApp: some View {
        VStack(alignment: .leading, spacing: 0) {
            DataSectionHeader(
                title: "DELETE BY APP",
                note: "Every capture from that app, and the memories formed from them",
                trailing: appsTrailing,
                topRule: true)

            if unreachable {
                twoLines("Your apps can't be shown until Nova answers",
                         "This window can't see them right now, which isn't the same as there being none")
            } else if let s = model.dataSummary {
                if s.apps.isEmpty {
                    twoLines("Nova holds no captures", "Apps appear here once Nova captures from them")
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(s.apps.enumerated()), id: \.element.id) { i, app in
                            AppRow(app: app, model: model, enabled: !deleting)
                                .entry(index: i, shown: shown, reduce: reduceMotion)
                                .transition(.asymmetric(
                                    insertion: .opacity,
                                    removal: .opacity.combined(with: .offset(y: -Nova.offsetDissolve))
                                        .animation(.nova(Nova.quick))))
                        }
                    }
                    .padding(.vertical, Nova.space3)
                    .animation(.nova(Nova.base).delay(Nova.quick), value: s.apps.map(\.id))
                }
            } else {
                caption(asking, Nova.inkTertiary)
                    .padding(.horizontal, Nova.space8)
                    .padding(.vertical, Nova.space5)
                    .animation(.nova(Nova.quick), value: slowEnough)
            }
        }
    }

    private var appsTrailing: String {
        if unreachable { return "unknown" }
        guard let s = model.dataSummary else { return slowEnough ? "Asking Nova" : "" }
        return "\(s.apps.count) app\(s.apps.count == 1 ? "" : "s")"
    }

    // MARK: Delete everything

    private var everything: some View {
        let open = model.dataConfirm?.scope == .all
        let empty = (model.dataSummary?.captures ?? 0) == 0 && (model.dataSummary?.loops ?? 0) == 0
        return VStack(alignment: .leading, spacing: 0) {
            DataSectionHeader(title: "DELETE EVERYTHING", topRule: true)
            VStack(alignment: .leading, spacing: 10) {
                caption("Every capture, memory and loop, and Nova's log on this Mac. "
                    + "Your Keep settings and blocked apps stay", Nova.inkSecondary)
                if !open {
                    Button("Delete everything…") {
                        chip = nil
                        model.askDelete(.all, label: "")
                    }
                    .buttonStyle(NovaButtonStyle(variant: .secondary))
                    .disabled(!live || empty || deleting)
                    if !live || empty {
                        caption(unreachable || model.dataSummary == nil ? "Off until Nova answers" : "Nothing to delete",
                                Nova.inkTertiary)
                    }
                }
            }
            .padding(.horizontal, Nova.space8)
            .padding(.top, Nova.space5)
            .padding(.bottom, Nova.space2)

            if open, let confirm = model.dataConfirm {
                ConfirmWell(model: model, confirm: confirm, everything: true)
                    .id(Self.confirmID)
                    .padding(.horizontal, Nova.space8)
                    .padding(.top, Nova.space2)
                    .padding(.bottom, Nova.space2)
                    .transition(wellTransition)
            }
            Color.clear.frame(height: Nova.space6)
        }
        .animation(.nova(Nova.base), value: open)
    }

    // MARK: Keep

    private var keep: some View {
        VStack(alignment: .leading, spacing: 0) {
            DataSectionHeader(title: "KEEP", topRule: true)
            VStack(alignment: .leading, spacing: 0) {
                keepRow(
                    name: "Captured text", sub: "The words Nova read from each window",
                    field: .raw, choices: Retention.rawChoices,
                    current: summary?.retention.rawDays, note: rawNote)
                    .entry(index: 0, shown: shown, reduce: reduceMotion)
                keepRow(
                    name: "Memories", sub: "What Nova formed from captured text",
                    field: .memory, choices: Retention.memoryChoices,
                    current: summary?.retention.memoryDays, note: memoryNote)
                    .entry(index: 1, shown: shown, reduce: reduceMotion)
            }
            .padding(.top, Nova.space3)

            VStack(alignment: .leading, spacing: Nova.space2) {
                caption("Memories stay after the text they came from is removed", Nova.inkSecondary)
                caption(sweepLine, Nova.inkTertiary)
                    .contentTransition(.opacity)
                    .animation(.nova(Nova.quick), value: sweepLine)
            }
            .padding(.horizontal, Nova.space8)
            .padding(.top, Nova.space4)
        }
    }

    private func keepRow(name: String, sub: String, field: InspectorModel.RetentionField,
                         choices: [Int?], current: Int??, note: String?) -> some View {
        HStack(alignment: .top, spacing: Nova.space5) {
            VStack(alignment: .leading, spacing: Nova.space1) {
                Text(name).font(Nova.body).foregroundStyle(Nova.inkPrimary)
                caption(sub, Nova.inkTertiary)
                if let note {
                    caption(note, Nova.inkSecondary).transition(.opacity.animation(.nova(Nova.quick)))
                }
            }
            Spacer(minLength: Nova.space5)
            if let current, let s = summary {
                Picker("", selection: Binding(
                    get: { current },
                    set: { new in changeKeep(field, to: new, from: s.retention) },
                )) {
                    ForEach(choices, id: \.self) { d in
                        Text(InspectorModel.daysName(d)).tag(d)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .fixedSize()
                .disabled(deleting || model.savingRetention == field)
            } else {
                Picker("", selection: .constant(0)) {
                    Text(unreachable ? "unknown" : asking).tag(0)
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .fixedSize()
                .disabled(true)
            }
        }
        .padding(.horizontal, Nova.space8)
        .padding(.vertical, Nova.space4)
    }

    private func changeKeep(_ field: InspectorModel.RetentionField, to new: Int?, from old: Retention) {
        if keepBaseline == nil { keepBaseline = old }
        var r = old
        switch field {
        case .raw: r.rawDays = new
        case .memory: r.memoryDays = new
        }
        model.setRetention(r, changed: field)
    }

    /// Shown once a value is shorter than it was at the first change this
    /// session: that is the change that removes something at the next sweep.
    private var rawNote: String? {
        guard let base = keepBaseline, let now = summary?.retention.rawDays,
              Self.shorter(now, than: base.rawDays) else { return nil }
        return "Text older than \(InspectorModel.daysName(now)) goes at the next clean-up, within a day"
    }

    private var memoryNote: String? {
        guard let base = keepBaseline, let now = summary?.retention.memoryDays,
              Self.shorter(now, than: base.memoryDays) else { return nil }
        return "Memories older than \(InspectorModel.daysName(now)) go at the next clean-up, with their captures"
    }

    private static func shorter(_ new: Int, than old: Int?) -> Bool {
        guard let old else { return true }
        return new < old
    }

    private var sweepLine: String {
        if unreachable { return "Last clean-up unknown" }
        guard let s = model.dataSummary else { return " " }
        guard let sweep = s.lastSweep else { return "No clean-up has run yet" }
        var parts = ["Last cleaned up \(Self.clock(Self.date(sweep.at)))"]
        if sweep.rawRemoved > 0 {
            parts.append("removed text from \(sweep.rawRemoved.formatted()) capture\(sweep.rawRemoved == 1 ? "" : "s")")
        }
        let d = sweep.deleted
        if d.captures + d.memories + d.loops > 0 {
            parts.append("deleted \(InspectorModel.countsLine(d))")
        }
        if parts.count == 1 { parts.append("nothing was old enough") }
        return parts.joined(separator: " · ")
    }

    // MARK: Pieces

    private var wellTransition: AnyTransition {
        reduceMotion
            ? .opacity.animation(.linear(duration: 0.1))
            : .opacity.animation(.nova(Nova.base))
    }

    private func caption(_ s: String, _ ink: Color) -> some View {
        Text(s)
            .font(Nova.caption)
            .tracking(Nova.captionTracking)
            .foregroundStyle(ink)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 460, alignment: .leading)
    }

    private func twoLines(_ a: String, _ b: String) -> some View {
        VStack(alignment: .leading, spacing: Nova.space1) {
            Text(a).font(Nova.body).foregroundStyle(Nova.inkPrimary)
            caption(b, Nova.inkTertiary)
        }
        .frame(maxWidth: 460, alignment: .leading)
        .padding(.horizontal, Nova.space8)
        .padding(.vertical, Nova.space5)
    }

    // MARK: Formatting

    private static var defaultFrom: Date {
        Calendar.current.date(byAdding: .day, value: -4, to: Calendar.current.startOfDay(for: Date())) ?? Date()
    }

    static func ms(_ d: Date) -> Int64 { Int64(d.timeIntervalSince1970 * 1000) }
    static func date(_ ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

    /// "3:10 PM"
    static func clock(_ d: Date) -> String { d.formatted(date: .omitted, time: .shortened) }

    /// "Jul 14"
    static func day(_ d: Date) -> String { d.formatted(.dateTime.month(.abbreviated).day()) }

    /// Decimal units, like Finder: "1.2 GB", "214 MB", "640 KB".
    static func size(_ bytes: Int64) -> String {
        let b = Double(bytes)
        if b >= 1e9 { return String(format: "%.1f GB", b / 1e9) }
        if b >= 1e6 { return "\(Int((b / 1e6).rounded())) MB" }
        if b >= 1e3 { return "\(Int((b / 1e3).rounded())) KB" }
        return "\(bytes) bytes"
    }

    /// "2m ago", "2h ago", "yesterday", "Oct 3"
    static func lastCaptured(_ ms: Int64) -> String {
        let d = date(ms)
        let cal = Calendar.current
        let minutes = Int(Date().timeIntervalSince(d) / 60)
        if minutes < 60 { return "\(max(minutes, 0))m ago" }
        if cal.isDateInToday(d) { return "\(minutes / 60)h ago" }
        if cal.isDateInYesterday(d) { return "yesterday" }
        return day(d)
    }
}

// MARK: - Confirm

/// One confirm, three placements (time, app row, everything). The title and
/// the red button name the exact counts, so it can't be clicked past by
/// reflex.
private struct ConfirmWell: View {
    @ObservedObject var model: InspectorModel
    let confirm: InspectorModel.DataConfirm
    let everything: Bool

    @State private var slowEnough = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: Nova.space3) {
                Text(title)
                    .font(Nova.bodyEmphasis)
                    .foregroundStyle(Nova.inkPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                lines
            }
            if everything, confirm.counts.map(isEmpty) == false { checkbox }
            buttons
        }
        .padding(Nova.space5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Nova.radiusMD, style: .continuous).fill(Nova.surfaceSunken))
        .animation(.nova(Nova.base), value: confirm.counts)
        .task(id: confirm.scope) {
            slowEnough = false
            try? await Task.sleep(for: .milliseconds(300))
            slowEnough = true
        }
    }

    private func isEmpty(_ c: DeleteCounts) -> Bool { c.captures + c.memories + c.loops == 0 }

    private var title: String {
        guard let c = confirm.counts else {
            return everything ? "Delete everything Nova holds" : "Delete what Nova holds \(confirm.label)"
        }
        if isEmpty(c) { return everything ? "Nova holds nothing" : "Nova holds nothing \(confirm.label)" }
        let phrase = InspectorModel.countsLine(c)
        return everything ? "Delete everything: \(phrase)" : "Delete \(phrase) \(confirm.label)"
    }

    @ViewBuilder
    private var lines: some View {
        if confirm.failed {
            line("Nova couldn't count that. Try again in a moment", Nova.inkTertiary)
        } else if let c = confirm.counts {
            if isEmpty(c) {
                line("Pick another time, or close this", Nova.inkTertiary)
            } else {
                VStack(alignment: .leading, spacing: Nova.space1) {
                    StatusDot(status: .attention, label: "This can't be undone")
                    line("Anything Nova already shared with your AI app stays there", Nova.inkSecondary)
                        .padding(.leading, 13)
                }
            }
        } else {
            line(slowEnough ? "Asking Nova" : " ", Nova.inkTertiary)
                .animation(.nova(Nova.quick), value: slowEnough)
        }
    }

    private var checkbox: some View {
        Toggle(isOn: $model.clearCallLog) {
            VStack(alignment: .leading, spacing: Nova.space1) {
                Text("Also clear the Sent to your provider list in Activity")
                    .font(Nova.body)
                    .foregroundStyle(Nova.inkPrimary)
                line("It shows when Nova sent, how much and where, never what was captured. "
                    + "That's why Nova keeps it unless you ask", Nova.inkSecondary)
            }
        }
        .toggleStyle(.checkbox)
        .tint(Nova.accent)
        .disabled(confirm.deleting)
    }

    private var buttons: some View {
        HStack(spacing: Nova.space4) {
            Spacer(minLength: 0)
            let zero = confirm.counts.map(isEmpty) ?? false
            Button(zero ? "Close" : "Cancel") { model.cancelDelete() }
                .buttonStyle(NovaButtonStyle(variant: .secondary))
                .keyboardShortcut(.cancelAction)
                .disabled(confirm.deleting)
            if !zero {
                Button { model.confirmDelete() } label: {
                    HStack(spacing: Nova.space3) {
                        if confirm.deleting { ProgressView().controlSize(.small).tint(.white) }
                        Text(primaryLabel)
                    }
                }
                // Red for every delete: each one is irreversible, whatever its size.
                .buttonStyle(NovaButtonStyle(variant: .danger))
                .disabled(confirm.counts == nil || confirm.deleting || confirm.failed)
            }
        }
    }

    /// "Delete 1,402 captures", "Delete all 18,406 captures", "Deleting …"
    private var primaryLabel: String {
        guard let c = confirm.counts else { return "Delete" }
        let (n, one, many) = c.captures > 0 ? (c.captures, "capture", "captures")
            : c.memories > 0 ? (c.memories, "memory", "memories")
            : (c.loops, "loop", "loops")
        let what = "\(n.formatted()) \(n == 1 ? one : many)"
        if confirm.deleting { return "Deleting \(what)" }
        return everything ? "Delete all \(what)" : "Delete \(what)"
    }

    private func line(_ s: String, _ ink: Color) -> some View {
        Text(s)
            .font(Nova.caption)
            .tracking(Nova.captionTracking)
            .foregroundStyle(ink)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 460, alignment: .leading)
    }
}

// MARK: - Rows

private struct AppRow: View {
    let app: DataSummary.App
    @ObservedObject var model: InspectorModel
    let enabled: Bool

    @State private var hover = false
    @FocusState private var focused: Bool

    private var confirming: Bool { model.dataConfirm?.scope == .app(app.app) }

    var body: some View {
        Group {
            if confirming, let confirm = model.dataConfirm {
                ConfirmWell(model: model, confirm: confirm, everything: false)
                    .id("your-data-confirm")
                    .padding(.horizontal, Nova.space8)
                    .padding(.vertical, Nova.space1)
            } else {
                normal
            }
        }
        .background(confirming || hover ? Nova.surfaceSunken : .clear)
        .onHover { h in withAnimation(.nova(Nova.quick)) { hover = h } }
        .animation(.nova(Nova.base), value: confirming)
    }

    private var normal: some View {
        HStack(alignment: .center, spacing: Nova.space5) {
            VStack(alignment: .leading, spacing: 2) {
                Text(app.app)
                    .font(Nova.body)
                    .foregroundStyle(Nova.inkPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(height: 19, alignment: .leading)
                Text("last captured \(YourDataView.lastCaptured(app.last))")
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkTertiary)
                    .lineLimit(1)
            }
            Spacer(minLength: Nova.space4)
            Button("Delete") { model.askDelete(.app(app.app), label: "from \(app.app)") }
                .buttonStyle(RowActionStyle())
                .focused($focused)
                .opacity(hover || focused ? 1 : 0)
                .disabled(!enabled)
                .animation(.nova(Nova.quick), value: hover)
            VStack(alignment: .trailing, spacing: 0) {
                RollingFigure(value: app.captures, font: Nova.capture, ink: Nova.inkPrimary)
                Text("captures")
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkTertiary)
            }
            .frame(width: 96, alignment: .trailing)
        }
        .padding(.horizontal, Nova.space8)
        .padding(.vertical, Nova.space4)
    }
}

/// The row's 22pt action: secondary ink at rest, then a raised band and
/// primary ink under the pointer, so it reads as pressable on a sunken row.
private struct RowActionStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { Face(configuration: configuration) }

    private struct Face: View {
        let configuration: ButtonStyleConfiguration
        @State private var hover = false

        var body: some View {
            configuration.label
                .font(Nova.caption)
                .foregroundStyle(hover ? Nova.inkPrimary : Nova.inkSecondary)
                .padding(.horizontal, Nova.space4)
                .frame(height: 22)
                .background(
                    RoundedRectangle(cornerRadius: Nova.radiusXS, style: .continuous)
                        .fill(hover ? Nova.surfaceRaised : .clear),
                )
                .opacity(configuration.isPressed ? 0.7 : 1)
                .contentShape(Rectangle())
                .onHover { h in withAnimation(.nova(Nova.quick)) { hover = h } }
        }
    }
}

/// A figure that rolls when it changes and holds accent so the eye can find
/// it (motion spec §12). Not rate-limited: on this pane the user caused it.
private struct RollingFigure: View {
    let value: Int
    let font: Font
    let ink: Color

    @State private var acked = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(value, format: .number)
            .font(font)
            .monospacedDigit()
            .foregroundStyle(acked ? Nova.accent : ink)
            .contentTransition(.numericText(value: Double(value)))
            .animation(reduceMotion ? .linear(duration: 0.1) : .nova(Nova.base), value: value)
            .onChange(of: value) { old, new in
                guard old != new, NSApp.keyWindow != nil else { return }
                acked = true
                Task { @MainActor in
                    try? await Task.sleep(for: .seconds(Nova.ackHold))
                    withAnimation(reduceMotion ? .linear(duration: 0.1) : .nova(Nova.considered)) {
                        acked = false
                    }
                }
            }
    }
}

private struct Chip: View {
    let title: String
    let selected: Bool
    let enabled: Bool
    let action: () -> Void

    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Nova.body)
                .foregroundStyle(enabled ? Nova.inkPrimary : Nova.inkQuaternary)
                .padding(.horizontal, Nova.space5)
                .frame(height: 28)
                .background(
                    RoundedRectangle(cornerRadius: Nova.radiusSM, style: .continuous)
                        .fill(selected ? Nova.accentWash : (hover && enabled ? Nova.surfaceSunken : .clear)),
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Nova.radiusSM, style: .continuous)
                        .strokeBorder(selected ? .clear : Nova.ruleStrong, lineWidth: 1),
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .onHover { h in withAnimation(.nova(Nova.quick)) { hover = h } }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Section header for this pane. Like Blocked apps', but the note and the
/// trailing text are optional, and sections after the first carry a top rule.
private struct DataSectionHeader: View {
    let title: String
    var note: String?
    var trailing: String = ""
    var topRule = false

    var body: some View {
        VStack(alignment: .leading, spacing: Nova.space2) {
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
                    .contentTransition(.opacity)
                    .animation(.nova(Nova.base), value: trailing)
            }
            if let note {
                Text(note)
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 460, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Nova.space8)
        .padding(.top, Nova.space6)
        .padding(.bottom, 10)
        .background(Nova.surfaceRaised.opacity(0.97))
        .overlay(alignment: .bottom) { Rectangle().fill(Nova.rule).frame(height: 1) }
        .overlay(alignment: .top) { if topRule { Rectangle().fill(Nova.rule).frame(height: 1) } }
    }
}

/// Lays children out left to right and wraps, for the time chips.
private struct FlowRow: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += line + spacing; line = 0 }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += line + spacing; line = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

private extension DeleteScope {
    var isRange: Bool { if case .range = self { return true } else { return false } }
}
