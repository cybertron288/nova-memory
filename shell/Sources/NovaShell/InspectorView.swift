// Your Space (F5.5, placed by D22): what Nova read from the screen, and what
// left the machine.
//
// Everything here reports sizes, never content. The window is the surface a
// suspicious user opens, so it has to be the one place that cannot itself
// become a second copy of what it is reassuring them about. The captured text
// stays in the panel's Memory tab, which is a deliberate click away and shows
// one page at a time.
//
// Ported from the Claude Design file "Your Space - Activity" (YourSpaceWindow).
import SwiftUI

struct InspectorView: View {
    @ObservedObject var model: InspectorModel
    /// One wash shape shared by every sidebar row, so selecting traces it to
    /// the new row rather than fading one out and another in (motion spec §02).
    @Namespace private var washNS

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Rectangle().fill(Nova.rule).frame(width: 1)
            VStack(spacing: 0) {
                header
                Rectangle().fill(Nova.rule).frame(height: 1)
                // Motion spec §01. Only the incoming pane is in layout — the
                // outgoing one leaves by fading in place, never moving — so
                // the window height cannot change mid-transition. A true
                // crossfade stacks both for the length of the transition,
                // which makes the height rise to their sum and fall back: the
                // window visibly shakes.
                ZStack(alignment: .top) {
                    pane
                        .id(model.pane)
                        .transition(.asymmetric(
                            insertion: .opacity
                                .combined(with: .offset(y: Nova.offsetPane * model.paneDirection))
                                .animation(.nova(Nova.base).delay(Nova.paneLead)),
                            removal: .opacity.animation(.nova(Nova.quick)),
                        ))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(minWidth: 720, minHeight: 460)
        // The same glass as the panel and the digest card, at the panel's own
        // veil. 0.65 is a floor, not a preference: the panel measured that
        // glass alone takes its brightness from what is behind it, and over a
        // white page it washes to mid-grey with light ink unreadable. The
        // window gets its glassiness from the sidebar and headers instead,
        // where a thinner wash does not fight the text.
        .background(NovaGround())
        .ignoresSafeArea()
        .environment(\.colorScheme, .dark)
    }

    // MARK: Sidebar

    /// A sidebar rather than a tab strip: the list grows as the rest of F5 is
    /// built, and tabs stop fitting. The top 52 points hold the window's
    /// traffic lights, which sit over it.
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear.frame(height: 52)
            Text("YOUR SPACE")
                .font(Nova.label)
                .tracking(Nova.labelTracking)
                .foregroundStyle(Nova.inkTertiary)
                .padding(.horizontal, Nova.space6)
                .padding(.top, 4)
                .padding(.bottom, Nova.space4)
            VStack(alignment: .leading, spacing: 2) {
                ForEach(InspectorModel.Pane.shown, id: \.self) { item in
                    SidebarItem(
                        item: item,
                        selected: item == model.pane,
                        namespace: washNS,
                    ) { model.select(item) }
                }
            }
            .padding(.horizontal, Nova.space4)
            Spacer(minLength: 0)
        }
        .frame(width: 184, alignment: .leading)
        .frame(maxHeight: .infinity)
        // A wash over the glass rather than a solid fill: the sidebar reads
        // as recessed and the desktop still shows through the window.
        .background(Nova.surfaceSunken.opacity(0.28))
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: Nova.space5) {
            Text(model.pane.title)
                .font(Nova.heading)
                .foregroundStyle(Nova.inkPrimary)
                // Fades without moving (motion spec §01): the header holds
                // the hairline under it, and a title that slid would drag the
                // rule's apparent position with it.
                .contentTransition(.opacity)
                .animation(.nova(Nova.base), value: model.pane)
            Spacer(minLength: 0)
            if model.pane == .activity || model.pane == .data, let status {
                StatusDot(status: status.0, label: status.1)
            }
            if model.pane == .blockedApps {
                // In the header, not in the list. At 720x460 the four
                // always-off checks fill most of the first screen, so an add
                // control inside "Your list" would sit below the fold.
                Button("Add app or site") { model.openAdd() }
                    .buttonStyle(NovaButtonStyle(variant: .secondary))
                    .disabled(model.connection == .unreachable)
            }
        }
        .padding(.horizontal, Nova.space8)
        .frame(height: 52)
    }

    /// The one piece of reassurance that is not a row: a user who opens this
    /// window wants to know it is current, not guess from the ages.
    private var status: (NovaStatus, String)? {
        switch model.connection {
        case .loading: return nil
        case .live: return (.live, "Updated \(clock(model.lastAnswer))")
        case .stale: return (.attention, "Can't reach Nova · last updated \(clock(model.lastAnswer))")
        case .unreachable: return (.error, "Can't reach Nova")
        }
    }

    // MARK: Panes

    @ViewBuilder
    private var pane: some View {
        if !model.pane.built {
            VStack(alignment: .leading, spacing: Nova.space4) {
                Text("NOT BUILT YET")
                    .font(Nova.label)
                    .tracking(Nova.labelTracking)
                    .foregroundStyle(Nova.inkTertiary)
                Text(model.pane.promise)
                    .font(Nova.body)
                    .foregroundStyle(Nova.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 420, alignment: .leading)
            }
            .padding(Nova.space8)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else if model.pane == .blockedApps {
            // Never gated on the connection: the four checks ship inside Nova
            // and apply whenever it runs, so they show even when the daemon
            // is unreachable. Only their counts are unknown.
            BlockedAppsView(model: model)
        } else if model.pane == .data {
            // Never gated on the connection, like Blocked apps: the pane says
            // what it can't count rather than going blank.
            YourDataView(model: model)
        } else {
            switch model.connection {
            case .loading:
                ProgressView()
                    .controlSize(.small)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .unreachable:
                cold
            case .live, .stale:
                VStack(spacing: 0) {
                    if model.connection == .stale { staleBanner }
                    if !model.parked.isEmpty { parkedBanner }
                    tabs
                    lists
                }
            }
        }
    }

    /// Nova has never answered this window. No list is drawn, and both
    /// sections are counted as unknown rather than zero: an empty list here
    /// would claim nothing was captured and nothing sent, which is the one
    /// lie this window exists to prevent.
    private var cold: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: Nova.space5) {
                    ApertureMark(state: .paused, size: 28, color: Nova.inkTertiary)
                    Text("Nova isn't answering")
                        .font(Nova.heading)
                        .foregroundStyle(Nova.inkPrimary)
                    Text(coldBody)
                        .font(Nova.body)
                        .foregroundStyle(Nova.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: Nova.space4) {
                        Button("Try again") { model.refresh() }
                            .buttonStyle(NovaButtonStyle(variant: .primary))
                        Button("Restart Nova") { model.restart() }
                            .buttonStyle(NovaButtonStyle(variant: .secondary))
                    }
                    .padding(.top, 4)
                    Text(retryLine)
                        .font(Nova.caption)
                        .tracking(Nova.captionTracking)
                        .foregroundStyle(Nova.inkTertiary)
                }
                .frame(maxWidth: 440, alignment: .leading)
                .padding(.horizontal, Nova.space8)
                .padding(.top, Nova.space9)
                .padding(.bottom, Nova.space8)

                unknownRow("READ FROM YOUR SCREEN")
                unknownRow("SENT TO YOUR PROVIDER")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var coldBody: String {
        let since = model.lastAnswer.map { ", which hasn't responded since \(clock($0))" } ?? ", which isn't responding"
        return "This window gets its lists from Nova's background process\(since). "
            + "Until it does, this window can't say what was captured or sent, including whether nothing was"
    }

    private var retryLine: String {
        let every = "Retrying every \(Int(InspectorModel.retryInterval)) seconds"
        guard let last = model.lastAnswer else { return every }
        return "\(every) · last answer at \(clock(last))"
    }

    private func unknownRow(_ title: String) -> some View {
        HStack {
            Text(title)
                .font(Nova.label)
                .tracking(Nova.labelTracking)
                .foregroundStyle(Nova.inkSecondary)
            Spacer()
            Text("unknown")
                .font(Nova.caption)
                .foregroundStyle(Nova.inkTertiary)
        }
        .padding(.horizontal, Nova.space8)
        .padding(.vertical, Nova.space5)
        .overlay(alignment: .top) { Rectangle().fill(Nova.rule).frame(height: 1) }
    }

    /// Nova answered earlier and has stopped. The lists stay, and say where
    /// they end, rather than being cleared into an apparent "nothing".
    private var staleBanner: some View {
        HStack(spacing: Nova.space5) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Nova stopped answering at \(clock(model.lastAnswer))")
                    .font(Nova.body)
                    .foregroundStyle(Nova.inkPrimary)
                Text("These lists end there. Anything captured or sent since then isn't shown")
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Button("Try again") { model.refresh() }
                .buttonStyle(NovaButtonStyle(variant: .secondary))
        }
        .padding(.horizontal, Nova.space8)
        .padding(.vertical, 10)
        .background(Nova.surfaceSunken.opacity(0.5))
        .overlay(alignment: .bottom) { Rectangle().fill(Nova.rule).frame(height: 1) }
    }

    /// Captures Nova gave up on after every attempt. They are not lost — the
    /// queue keeps them — and this is the one place to send them again.
    private var parkedBanner: some View {
        let n = model.parked.count
        return HStack(spacing: Nova.space5) {
            VStack(alignment: .leading, spacing: 2) {
                Text(n == 1 ? "1 capture wasn't processed" : "\(n) captures weren't processed")
                    .font(Nova.body)
                    .foregroundStyle(Nova.inkPrimary)
                Text(parkedDetail)
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkSecondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Button(model.retrying ? "Retrying…" : "Retry") { model.retryParked() }
                .buttonStyle(NovaButtonStyle(variant: .secondary))
                .disabled(model.retrying || model.connection != .live)
        }
        .padding(.horizontal, Nova.space8)
        .padding(.vertical, 10)
        .background(Nova.surfaceSunken.opacity(0.5))
        .overlay(alignment: .bottom) { Rectangle().fill(Nova.rule).frame(height: 1) }
    }

    private var parkedDetail: String {
        if model.retryFailed { return "Nova could not queue them again. Try again in a moment" }
        let base = "Nova stopped trying after repeated failures. They stay queued until they succeed"
        guard let error = model.parked.first?.error else { return base }
        return "\(base) · last error: \(error)"
    }

    // MARK: Tabs

    private var tabs: some View {
        HStack(spacing: Nova.space8) {
            tab(.read, "Read from your screen", model.capturesToday)
            tab(.sent, "Sent to your provider", model.callsToday)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Nova.space8)
        .frame(height: 40)
        .overlay(alignment: .bottom) { Rectangle().fill(Nova.rule).frame(height: 1) }
    }

    private func tab(_ which: InspectorModel.Tab, _ name: String, _ count: Int) -> some View {
        let on = model.tab == which
        return Button {
            model.tab = which
        } label: {
            HStack(spacing: Nova.space4) {
                Text(name)
                    .font(Nova.bodyEmphasis)
                    .foregroundStyle(on ? Nova.inkPrimary : Nova.inkTertiary)
                Text(count.formatted())
                    .font(Nova.figure)
                    .foregroundStyle(Nova.inkTertiary)
            }
            .frame(maxHeight: .infinity)
            .overlay(alignment: .bottom) {
                Rectangle().fill(on ? Nova.accent : .clear).frame(height: 2)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .animation(Nova.motionQuick, value: on)
    }

    // MARK: Lists

    /// What the counts are scoped to. Once Nova stops answering, "today"
    /// would keep claiming currency the lists no longer have.
    private var scope: String {
        model.connection == .stale ? "as of \(clock(model.lastAnswer))" : "today"
    }

    private var lists: some View {
        ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                switch model.tab {
                case .read:
                    Section { captureRows } header: {
                        SectionHead(
                            title: "READ FROM YOUR SCREEN",
                            count: "\(model.capturesToday.formatted()) \(scope)",
                            claim: "Each capture lists its title, app, address and word count. "
                                + "What the window said stays in your encrypted memory and never appears here",
                            totals: nil,
                        )
                    }
                case .sent:
                    Section { callRows } header: {
                        SectionHead(
                            title: "SENT TO YOUR PROVIDER",
                            count: "\(model.callsToday.formatted()) \(scope)",
                            claim: "Each request lists its source, size and timing. "
                                + "The text sent and the reply never appear here",
                            totals: totalsLine,
                        )
                    }
                }
            }
            .padding(.bottom, Nova.space6)
        }
        .scrollIndicators(.automatic)
    }

    private var totalsLine: String {
        var line = "\(model.callsToday.formatted()) call\(model.callsToday == 1 ? "" : "s") · "
            + "\(model.charsToday.formatted()) characters sent \(scope)"
        if model.failedToday > 0 { line += " · \(model.failedToday) failed" }
        return line
    }

    private var stale: Bool { model.connection == .stale }

    @ViewBuilder
    private var captureRows: some View {
        let all = model.captures
        let shown = model.showAllCaptures ? all : Array(all.prefix(InspectorModel.captureFold))
        let linked = model.linked
        // No container around the ForEach: wrapping rows in an eager VStack
        // inside the LazyVStack defeats its laziness, so every row off screen
        // was still being built and laid out on each rebuild — which is what
        // made scrolling stutter (2026-10-07). Rows go straight into the lazy
        // stack, and the 6pt the VStack used to carry is a spacer row, which
        // costs one view rather than one container around every row.
        Color.clear.frame(height: 6)
        Group {
            if model.capturesToday == 0 {
                EmptyNote(
                    title: "Nothing captured today",
                    detail: (model.paused ? "Capture is paused from the menu bar · " : "")
                        + "confirmed by Nova at \(clock(model.lastAnswer))",
                )
            }
        }
        ForEach(shown) { c in
                ActivityRow(
                    age: age(c.at),
                    title: c.label,
                    titleTail: "",
                    subLead: c.app,
                    sub: c.url ?? "",
                    error: nil,
                    figure: c.words.formatted(),
                    unit: "words",
                    tone: tone(.capture(c.id), linked: linked.contains(c.id)),
                    titleKeep: 18,
            ) { model.toggle(.capture(c.id)) }
        }
        if all.count > InspectorModel.captureFold {
            MoreLink(label: model.showAllCaptures
                ? "Show fewer"
                : "Show \(all.count - InspectorModel.captureFold) earlier captures") {
                model.showAllCaptures.toggle()
            }
        }
        Color.clear.frame(height: 6)
    }

    @ViewBuilder
    private var callRows: some View {
        let all = model.calls
        let shown = model.showAllCalls ? all : Array(all.prefix(InspectorModel.callFold))
        let linked = model.linked
        Color.clear.frame(height: 6)
        Group {
            if model.callsToday == 0 {
                EmptyNote(title: "Nothing sent today",
                          detail: "Confirmed by Nova at \(clock(model.lastAnswer))")
            }
        }
        ForEach(shown) { s in
                // `model.capture(_:)` is a linear search of the captures
                // array, so this is O(captures x calls) if it runs for every
                // row. Lazily emitted now, so it runs for the rows on screen.
                let caps = s.captures.compactMap(model.capture)
                ActivityRow(
                    age: age(s.at),
                    title: callTitle(s, caps),
                    titleTail: (caps.count > 1 ? "\u{00a0}+ \(caps.count - 1) more" : "")
                        + (s.failed ? "\u{00a0}— failed" : ""),
                    subLead: "",
                    sub: callSubtitle(s, caps),
                    error: s.failed ? callError(s) : nil,
                    figure: s.inputChars.formatted(),
                    unit: "chars · \(s.ms.formatted()) ms",
                    tone: tone(.call(s.id), linked: linked.contains(s.id)),
                    titleKeep: 0,
            ) { model.toggle(.call(s.id)) }
            .help("\(s.provider) · \(s.model)")
        }
        if all.count > InspectorModel.callFold {
            MoreLink(label: model.showAllCalls
                ? "Show fewer"
                : "Show \(all.count - InspectorModel.callFold) earlier requests") {
                model.showAllCalls.toggle()
            }
        }
        Color.clear.frame(height: 6)
    }

    // MARK: Row text

    /// A request is named by the capture it carried. One with no capture, or
    /// whose capture has scrolled out of the loaded page, is named by why it
    /// was made, so no row reads as an unexplained send.
    private func callTitle(_ s: ProviderCall, _ caps: [RecentCapture]) -> String {
        if let first = caps.first { return first.label }
        return purpose(s)
    }

    private func callSubtitle(_ s: ProviderCall, _ caps: [RecentCapture]) -> String {
        guard !caps.isEmpty else { return s.provider }
        let apps = caps.map(\.app).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        let lead = caps.count > 1 ? "\(caps.count) captures · " : ""
        return "\(purpose(s)) · \(lead)\(apps.joined(separator: ", "))"
    }

    private func purpose(_ s: ProviderCall) -> String {
        switch (s.purpose, s.kind) {
        case ("memories", "embed"): return "Fact indexing"
        case ("memories", _): return "Fact extraction"
        case ("loops", "embed"): return "Open-loop matching"
        case ("loops", _): return "Open-loop check"
        case ("digest", _): return "Morning briefing"
        case ("probe", _): return "Quota check"
        case ("search", _): return "Search query"
        case (_, "embed"): return "Embedding"
        default: return "Extraction"
        }
    }

    /// The failure in a few characters: "embed 429", or the daemon's own
    /// already-summarised reason.
    private func callError(_ s: ProviderCall) -> String {
        if let status = s.status { return "\(s.kind) \(status)" }
        return s.detail ?? "failed"
    }

    private func tone(_ s: InspectorModel.Selection, linked: Bool) -> RowTone {
        if model.selection == s { return .selected }
        return linked ? .linked : .plain
    }

    /// Relative while live. Once stale, clock times: "4m ago" would keep
    /// drifting while nothing on screen updates.
    private func age(_ at: Int64) -> String {
        guard stale else { return relativeAge(at) }
        let date = Date(timeIntervalSince1970: Double(at) / 1000)
        return Calendar.current.isDateInToday(date) ? clock(date) : "yesterday"
    }
}

/// "4:12 PM".
private func clock(_ date: Date?) -> String {
    (date ?? Date()).formatted(date: .omitted, time: .shortened)
}

// MARK: - Pieces

private struct SidebarItem: View {
    let item: InspectorModel.Pane
    let selected: Bool
    let namespace: Namespace.ID
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Text(item.title)
            .font(Nova.body)
            .foregroundStyle(ink)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Nova.space4)
            .frame(height: 28)
            .background(washAndHover)
            .contentShape(Rectangle())
            // Mouse-DOWN, like a native source list (motion spec §02). A
            // Button fires on mouse-up, which puts the whole press between
            // the click and anything happening — the selection reads as
            // laggy however fast the animation is.
            .gesture(DragGesture(minimumDistance: 0).onChanged { _ in
                guard !selected else { return }
                withAnimation(.nova(Nova.quick)) { action() }
            })
            .onHover { hover = $0 }
            .animation(.nova(Nova.quick), value: hover)
            .help(item.built ? "" : "Not built yet")
    }

    /// The selected row carries the shared wash; unselected rows carry their
    /// own hover band. The selected row has no hover state — it has nothing
    /// left to do.
    @ViewBuilder
    private var washAndHover: some View {
        if selected {
            RoundedRectangle(cornerRadius: Nova.radiusSM, style: .continuous)
                .fill(Nova.accentWash)
                .matchedGeometryEffect(id: "sidebarWash", in: namespace)
        } else {
            RoundedRectangle(cornerRadius: Nova.radiusSM, style: .continuous)
                .fill(hover ? Nova.surfaceSunken : .clear)
        }
    }

    /// An unbuilt pane is dimmed but still selectable: it says what it will
    /// hold, which is the honest answer to a user looking around.
    private var ink: Color {
        if item.built { return Nova.inkPrimary }
        return selected ? Nova.inkSecondary : Nova.inkTertiary
    }
}

/// The section's name, its count, and the claim it makes about itself. Pinned
/// while the rows scroll, so the claim stays above the rows it describes.
private struct SectionHead: View {
    let title: String
    let count: String
    let claim: String
    let totals: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: Nova.space5) {
                Text(title)
                    .font(Nova.label)
                    .tracking(Nova.labelTracking)
                    .foregroundStyle(Nova.inkSecondary)
                Spacer(minLength: 0)
                Text(count)
                    .font(Nova.figure)
                    .foregroundStyle(Nova.inkTertiary)
                    .lineLimit(1)
            }
            Text(claim)
                .font(Nova.caption)
                .tracking(Nova.captionTracking)
                .foregroundStyle(Nova.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 440, alignment: .leading)
            if let totals {
                Text(totals)
                    .font(Nova.figure)
                    .foregroundStyle(Nova.inkPrimary)
            }
        }
        .padding(.horizontal, Nova.space8)
        .padding(.top, Nova.space6)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        // A plain fill, not a blur. A pinned header is on screen for every
        // frame of every scroll, and an NSVisualEffectView at .withinWindow
        // re-composites a live blur of the rows moving underneath it on each
        // one — which is what made Activity's scrolling stutter (2026-10-07).
        // The window's glass comes from its ground and its sidebar, where
        // nothing moves behind it.
        .background(Nova.surfaceRaised.opacity(0.97))
        .overlay(alignment: .bottom) { Rectangle().fill(Nova.rule).frame(height: 1) }
    }
}

enum RowTone { case plain, linked, selected }

/// One row: when · what · how much. Age in a left gutter, the source in the
/// middle, and one number on the right with its unit under it as a qualifier.
private struct ActivityRow: View {
    let age: String
    let title: String
    /// Text that must survive truncation, after the title ("— failed").
    let titleTail: String
    /// The emphasised start of the subtitle (the app); may be empty.
    let subLead: String
    let sub: String
    let error: String?
    let figure: String
    let unit: String
    let tone: RowTone
    /// How many trailing title characters to keep when it truncates; 0 for a
    /// plain tail truncation.
    let titleKeep: Int
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: Nova.space5) {
                Text(age)
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkTertiary)
                    .lineLimit(1)
                    .frame(width: 64, height: 19, alignment: .leading)

                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 0) {
                        MiddleTruncated(text: title, keep: titleKeep)
                            .font(Nova.body)
                            .foregroundStyle(Nova.inkPrimary)
                        if !titleTail.isEmpty {
                            Text(titleTail)
                                .font(Nova.body)
                                .foregroundStyle(Nova.inkPrimary)
                                .fixedSize()
                        }
                    }
                    HStack(spacing: 0) {
                        if !subLead.isEmpty {
                            Text(subLead)
                                .foregroundStyle(Nova.inkSecondary)
                                .fixedSize()
                            if !sub.isEmpty {
                                Text("·").padding(.horizontal, 6).fixedSize()
                            }
                        }
                        if !sub.isEmpty {
                            MiddleTruncated(text: sub, keep: subLead.isEmpty ? 0 : 16)
                                .foregroundStyle(subLead.isEmpty ? Nova.inkSecondary : Nova.inkTertiary)
                        }
                        if let error {
                            Text("·").padding(.horizontal, 6).fixedSize()
                            StatusDot(status: .error, label: error).fixedSize()
                        }
                    }
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.inkTertiary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .trailing, spacing: 0) {
                    Text(figure)
                        .font(Nova.figure)
                        .monospacedDigit()
                        .foregroundStyle(Nova.inkPrimary)
                        .frame(height: 19)
                    Text(unit)
                        .font(Nova.caption)
                        .tracking(Nova.captionTracking)
                        .foregroundStyle(Nova.inkTertiary)
                }
                .lineLimit(1)
                .frame(width: 96, alignment: .trailing)
            }
            .padding(.horizontal, Nova.space8)
            .padding(.vertical, 6)
            .background(background)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .animation(Nova.motionQuick, value: hover)
        .animation(Nova.motionQuick, value: tone)
    }

    private var background: Color {
        switch tone {
        case .selected: return Nova.accentWash
        case .linked: return Nova.accentWashSoft
        case .plain: return hover ? Nova.surfaceSunken : .clear
        }
    }
}

/// Truncates in the middle, keeping the start and the last `keep` characters:
/// the end of a title or address is usually what tells two rows apart (the
/// file name, the PR number), and `.truncationMode(.middle)` would split it
/// evenly and lose it. Short strings are left whole.
private struct MiddleTruncated: View {
    let text: String
    let keep: Int

    var body: some View {
        if keep == 0 || text.count <= keep + 14 {
            Text(text).lineLimit(1).truncationMode(keep == 0 ? .tail : .middle)
        } else {
            HStack(spacing: 0) {
                Text(String(text.dropLast(keep))).lineLimit(1).truncationMode(.tail)
                Text(String(text.suffix(keep))).lineLimit(1).fixedSize()
            }
        }
    }
}

/// A confirmed "nothing", with when Nova confirmed it. Shown only after Nova
/// answered: an unreachable daemon gets "unknown", never this.
private struct EmptyNote: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(Nova.body)
                .foregroundStyle(Nova.inkPrimary)
            Text(detail.prefix(1).uppercased() + detail.dropFirst())
                .font(Nova.caption)
                .tracking(Nova.captionTracking)
                .foregroundStyle(Nova.inkTertiary)
        }
        .padding(.leading, 100)
        .padding(.trailing, Nova.space8)
        .padding(.vertical, Nova.space4)
    }
}

private struct MoreLink: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(Nova.body)
                .foregroundStyle(Nova.accent)
        }
        .buttonStyle(.plain)
        .padding(.leading, 100)
        .padding(.vertical, Nova.space4)
    }
}
