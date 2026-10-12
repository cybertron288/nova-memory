/// The panel's state, and the only place the shell decides what to show.
///
/// Two rules from the shell spec shape everything here:
///
/// - **The daemon owns state.** Nothing survives a failed refresh. A socket
///   error clears the loops and says so, rather than leaving the last good list
///   on screen beside a stale "capturing". A menu-bar app that lies about
///   whether it is capturing is the worst failure this product can have.
/// - **Actions are optimistic.** The row leaves immediately and the op is sent
///   after; a refusal restores it with the daemon's own wording. The round trip
///   is ~1 ms, but the tap has to feel instant.
import AppKit
import SwiftUI

@MainActor
final class PanelModel: ObservableObject {

    // MARK: - Row

    /// A loop plus the transient view state the resolve choreography needs.
    /// Kept here rather than in the view so the animation survives the
    /// re-render that removing a row causes.
    struct Row: Identifiable {
        var loop: OpenLoop
        var mode: Mode = .plain
        var focused = false
        /// Expanded rows show the full description and a button row. Long
        /// descriptions are common — the daemon writes whole paragraphs — so a
        /// truncated single line is unreadable without this.
        var expanded = false
        /// The 120ms brightening at the moment of resolution.
        var flaring = false
        /// Dissolving: opacity to 0, drifting 2pt up.
        var leaving = false
        /// Height to 0, so the rows below settle into the gap.
        var collapsed = false

        var id: String { loop.id }

        enum Mode { case plain, snooze, confirm, notReal }

        var showsBar: Bool { focused || flaring }

        var background: Color {
            if flaring { return Nova.accentMuted }
            if focused { return Nova.accentWash }
            return .clear
        }
    }

    enum SnoozeChoice {
        case hour, tomorrow, nextWeek

        /// Epoch milliseconds. The daemon clamps anything in the past, but
        /// computing it here keeps the wall-clock intent (tomorrow means
        /// tomorrow morning, not 24 hours from now).
        var until: Int64 {
            let cal = Calendar.current
            let now = Date()
            let date: Date
            switch self {
            case .hour:
                date = now.addingTimeInterval(3600)
            case .tomorrow:
                let nine = cal.date(bySettingHour: 9, minute: 0, second: 0, of: now) ?? now
                date = nine > now ? nine : (cal.date(byAdding: .day, value: 1, to: nine) ?? now)
            case .nextWeek:
                let base = cal.date(byAdding: .day, value: 7, to: now) ?? now
                date = cal.date(bySettingHour: 9, minute: 0, second: 0, of: base) ?? base
            }
            return Int64(date.timeIntervalSince1970 * 1000)
        }
    }

    /// The panel's two views. Loops is the product; memory is the evidence
    /// behind it — what Nova has actually read — and exists so the user can
    /// see the memory rather than take it on trust.
    ///
    /// Transparency (F5.5) is deliberately not here: the panel is read in
    /// about two seconds and an audited surface wants minutes. It lives in
    /// the Inspector window instead (D22).
    enum Tab: CaseIterable {
        case loops, memory
        var title: String {
            switch self {
            case .loops: return "LOOPS"
            case .memory: return "MEMORY"
            }
        }
    }

    // MARK: - Published state

    @Published var tab: Tab = .loops
    /// The window is hidden, not destroyed, on close, and its SwiftUI
    /// animations keep ticking while hidden — so anything that repeats (the
    /// header's breathing) must stop on this.
    @Published private(set) var isOpen = false
    @Published private(set) var memories: [Memory] = []
    @Published private(set) var memoriesLoaded = false

    // Infinite scroll. Each list loads a page of `pageSize`; reaching its end
    // loads the next. A refresh reloads as many as are already loaded, so the
    // 5 s poll never snaps a scrolled list back to its first page.
    static let pageSize = 30
    /// Every open loop, from the daemon — the tab's count, whatever is loaded.
    @Published private(set) var loopsTotal = 0
    @Published private(set) var hasMoreLoops = false
    @Published private(set) var hasMoreMemories = false
    private var loopsNext: String?
    private var memoriesNext: String?
    private var loadingMoreLoops = false
    private var loadingMoreMemories = false

    @Published private(set) var rows: [Row] = []
    @Published private(set) var status: DaemonStatus?
    @Published private(set) var failure: String?
    @Published private(set) var loaded = false
    @Published var focusIndex = 0

    /// Set when the panel should close itself — after the last loop is cleared.
    var onRequestClose: (() -> Void)?
    /// The panel's laid-out height. The window never resizes, so the
    /// controller needs this to tell a click on the panel from a click on the
    /// transparent space below it.
    var panelHeight: CGFloat = 200

    private let client: ControlClient
    private var poll: Timer?
    /// Rows mid-choreography. Their ops have been sent; the refresh must not
    /// resurrect them while the animation plays.
    private var settling: Set<String> = []

    init(client: ControlClient = ControlClient()) {
        self.client = client
    }

    // MARK: - Derived view state

    var daemonDown: Bool { failure != nil }
    /// Set on every refresh. A revoked grant leaves the daemon answering and
    /// "capturing" while capture reads nothing, so this is checked here rather
    /// than trusted from the daemon's status.
    var accessibilityDenied = false
    /// The daemon is down, or up but unable to read the screen.
    var needsAttention: Bool { daemonDown || accessibilityDenied }
    /// The panel shows only the fix. A down daemon takes precedence: its
    /// state is the more fundamental one, and it restarts on its own.
    var blockedOnPermission: Bool { accessibilityDenied && !daemonDown }
    var showSkeleton: Bool { !loaded && failure == nil }
    var showCount: Bool { !daemonDown && !accessibilityDenied && loaded }
    var showFooter: Bool { !rows.isEmpty }
    var overflowing: Bool { rows.count > 6 }

    var apertureState: ApertureState {
        if needsAttention { return .attention }
        if status?.paused == true { return .paused }
        return .capturing
    }

    var statusLine: String {
        if let failure { return failure }
        if accessibilityDenied { return "Accessibility permission needed" }
        guard let status else { return "connecting…" }
        if status.paused { return "Nova is paused" }
        var line = "capturing"
        if status.queued > 0 { line += " · \(status.queued) queued" }
        return line
    }

    var statusInk: Color {
        if needsAttention { return Nova.statusAttention }
        if status?.paused == true { return Nova.statusPaused }
        return Nova.inkTertiary
    }

    var emptyMessage: String { "Nothing open. You're clear." }
    var downDetail: String { "Restarting…" }

    // MARK: - Lifecycle

    func panelDidOpen() {
        isOpen = true
        focusIndex = 0
        refresh()
        poll?.invalidate()
        // 5s while visible. Loops change on a 15s extraction tick, so polling a
        // visible panel is cheap and avoids a subscription channel v1 does not
        // need.
        poll = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func panelDidClose() {
        isOpen = false
        poll?.invalidate()
        poll = nil
        // Clear transient row modes so the next summon opens clean.
        for index in rows.indices { rows[index].mode = .plain }
    }

    // MARK: - Refresh

    func refresh() {
        let client = self.client
        let wantMemories = tab == .memory
        let loopLimit = min(max(Self.pageSize, rows.count), 200)
        let memoryLimit = min(max(Self.pageSize, memories.count), 200)
        Task.detached(priority: .userInitiated) {
            let outcome: Result<(DaemonStatus, ControlClient.Page<OpenLoop>), Error>
            do {
                outcome = .success((try client.status(), try client.listLoopsPage(limit: loopLimit)))
            } catch {
                outcome = .failure(error)
            }
            // Only fetched for the visible tab: it decrypts up to 40 rows in
            // the daemon, and polling it every 5s while nobody is looking is
            // work nobody asked for.
            // A `let` bound once: capturing a `var` across the concurrency
            // boundary is an error under Swift 6.
            let fetched: ControlClient.Page<Memory>? = {
                guard wantMemories else { return nil }
                do { return try client.listMemoriesPage(limit: memoryLimit) }
                catch {
                    // Silent here on purpose: a failed fetch leaves the tab on
                    // its skeleton, which is already visible feedback.
                    return nil
                }
            }()
            await MainActor.run {
                self.accessibilityDenied = !AccessibilityPermission.granted
                self.apply(outcome)
                if let fetched {
                    // Animated, so the skeleton-to-list swap grows the panel
                    // smoothly instead of snapping to the new height.
                    withAnimation(Nova.motionBase) {
                        self.memories = fetched.items
                        self.memoriesLoaded = true
                    }
                    self.memoriesNext = fetched.next
                    self.hasMoreMemories = fetched.next != nil
                }
            }
        }
    }

    func select(_ next: Tab) {
        guard next != tab else { return }
        // motionBase, not motionQuick: this carries a height change as well as
        // a crossfade, and 140 ms is too short for the eye to follow the panel
        // resizing — it reads as a jump.
        withAnimation(Nova.motionBase) { tab = next }
        if next == .memory && !memoriesLoaded { refresh() }
    }

    func cycleTab(by delta: Int) {
        let all = Tab.allCases
        guard let i = all.firstIndex(of: tab) else { return }
        select(all[(i + delta + all.count) % all.count])
    }

    private func apply(_ outcome: Result<(DaemonStatus, ControlClient.Page<OpenLoop>), Error>) {
        switch outcome {
        case .success(let (status, page)):
            let loops = page.items
            loopsNext = page.next
            hasMoreLoops = page.next != nil
            loopsTotal = page.total ?? loops.count
            self.status = status
            self.failure = nil
            self.loaded = true

            let incoming = loops.filter { !settling.contains($0.id) }
            withAnimation(Nova.motionBase) {
                // Preserve mode on rows that survive, so a refresh landing
                // while the snooze affordance is open does not close it.
                let existing = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0) })
                // The user's own loops first, then what others owe them, each
                // group in the daemon's order. The panel draws a header at the
                // boundary, so direction is read from position, not per row.
                let ordered = incoming.filter { !$0.isWaitingOn } + incoming.filter(\.isWaitingOn)
                rows = ordered.map { loop in
                    var row = Row(loop: loop)
                    if let previous = existing[loop.id] { row.mode = previous.mode }
                    return row
                }
            }
            clampFocus()

        case .failure(let error):
            self.status = nil
            self.loaded = true
            self.failure = (error as? ControlError)?.errorDescription ?? "\(error)"
            // Clearing the list matters: yesterday's loops shown beside
            // "isn't running" is the stale-green failure in another costume.
            withAnimation(Nova.motionBase) { rows = [] }
        }
    }

    // MARK: - Focus

    func moveFocus(by delta: Int) {
        guard !rows.isEmpty else { return }
        // ↓ on the last loaded row loads the next page instead of wrapping to
        // the top, which would jump past loops the user has not seen yet.
        if delta > 0, focusIndex == rows.count - 1, hasMoreLoops {
            loadMoreLoops()
            return
        }
        // Wrapping otherwise — a list this short has no edges worth enforcing.
        focusIndex = (focusIndex + delta + rows.count) % rows.count
        syncFocus()
    }

    /// The next page of loops, appended. Called when the list's end scrolls
    /// into view or ↓ reaches it; one request at a time.
    func loadMoreLoops() {
        guard hasMoreLoops, !loadingMoreLoops, let after = loopsNext else { return }
        loadingMoreLoops = true
        let client = self.client
        let size = Self.pageSize
        Task.detached(priority: .userInitiated) {
            let page = try? client.listLoopsPage(after: after, limit: size)
            await MainActor.run {
                self.loadingMoreLoops = false
                guard let page else { return }
                let have = Set(self.rows.map(\.id))
                let fresh = page.items.filter { !have.contains($0.id) && !self.settling.contains($0.id) }
                withAnimation(Nova.motionBase) { self.rows += fresh.map { Row(loop: $0) } }
                self.loopsNext = page.next
                self.hasMoreLoops = page.next != nil
                if let total = page.total { self.loopsTotal = total }
            }
        }
    }

    /// The next page of memories, appended.
    func loadMoreMemories() {
        guard hasMoreMemories, !loadingMoreMemories, let after = memoriesNext else { return }
        loadingMoreMemories = true
        let client = self.client
        let size = Self.pageSize
        Task.detached(priority: .userInitiated) {
            let page = try? client.listMemoriesPage(after: after, limit: size)
            await MainActor.run {
                self.loadingMoreMemories = false
                guard let page else { return }
                let have = Set(self.memories.map(\.id))
                withAnimation(Nova.motionBase) { self.memories += page.items.filter { !have.contains($0.id) } }
                self.memoriesNext = page.next
                self.hasMoreMemories = page.next != nil
            }
        }
    }

    func focus(_ index: Int) {
        guard rows.indices.contains(index) else { return }
        focusIndex = index
        syncFocus()
    }

    func hover(_ row: Row) {
        // Hover moves focus only in plain mode: stealing it mid-confirm would
        // let a stray mouse move dismiss the wrong loop.
        guard currentMode == .plain, let index = rows.firstIndex(where: { $0.id == row.id }) else { return }
        focus(index)
    }

    /// A click focuses a row and toggles its detail. It does not resolve it.
    ///
    /// This once called `done()` as well, mirroring the mockup's click-to-demo
    /// handler — and closed a real loop on a stray click, with no confirmation
    /// and no undo. Resolving is destructive and the panel offers no way back,
    /// so it stays behind a deliberate act: a key press, or a button in the
    /// expanded row. A bare click only ever reveals.
    func click(_ row: Row) {
        guard currentMode == .plain, let index = rows.firstIndex(where: { $0.id == row.id }) else { return }
        focus(index)
        withAnimation(Nova.motionBase) {
            let wasExpanded = rows[index].expanded
            // One at a time: two expanded paragraphs in a 440pt panel is not a
            // list any more.
            for i in rows.indices { rows[i].expanded = false }
            rows[index].expanded = !wasExpanded
        }
    }

    /// Space toggles the focused row's detail from the keyboard.
    func toggleExpanded() {
        guard rows.indices.contains(focusIndex) else { return }
        withAnimation(Nova.motionBase) {
            let wasExpanded = rows[focusIndex].expanded
            for i in rows.indices { rows[i].expanded = false }
            rows[focusIndex].expanded = !wasExpanded
        }
    }

    private func clampFocus() {
        focusIndex = min(focusIndex, max(rows.count - 1, 0))
        syncFocus()
    }

    private func syncFocus() {
        for index in rows.indices {
            rows[index].focused = (index == focusIndex)
            if index != focusIndex {
                rows[index].mode = .plain
                rows[index].expanded = false
            }
        }
    }

    private var currentMode: Row.Mode { rows[safe: focusIndex]?.mode ?? .plain }

    // MARK: - Keys
    //
    // The whole interaction surface. Returns true when the key was consumed,
    // so the window can pass anything else through.

    func handleKey(_ key: KeyPress) -> Bool {
        // Blocked: Return opens the fix, Escape closes, and every other key is
        // swallowed rather than acting on a list that is not on screen.
        if blockedOnPermission {
            switch key {
            case .enter: AccessibilityPermission.openSettings()
            case .escape: onRequestClose?()
            default: break
            }
            return true
        }

        switch key {
        case .prevTab: cycleTab(by: -1); return true
        case .nextTab: cycleTab(by: 1); return true
        default: break
        }

        // Memory is a read-only view: nothing there can be resolved, snoozed
        // or dismissed, so the loop keys would act on an invisible list.
        if tab == .memory {
            if case .escape = key { onRequestClose?(); return true }
            return false
        }

        switch key {
        case .escape:
            if currentMode != .plain {
                setMode(.plain)          // back out of the affordance, not the panel
            } else if rows[safe: focusIndex]?.expanded == true {
                toggleExpanded()         // then out of the detail
            } else {
                onRequestClose?()
            }
            return true

        case .down: moveFocus(by: 1); return true
        case .up: moveFocus(by: -1); return true

        case .enter:
            switch currentMode {
            case .plain: done()
            case .confirm: confirmDismiss()
            case .notReal: confirmNotReal()
            case .snooze: snoozeFocused(.tomorrow)
            }
            return true

        // F4.5. Y marks the loop real, and again clears it. N hides it as not
        // real, which is as permanent as dismiss, so it asks first as ⌫ does.
        case .yes:
            if currentMode == .plain { toggleReal() }
            return true

        case .no:
            if currentMode == .plain { setMode(.notReal) }
            return true

        case .space:
            if currentMode == .plain { toggleExpanded() }
            return true

        case .snooze:
            if currentMode == .plain { setMode(.snooze) }
            return true

        case .delete:
            if currentMode == .plain { setMode(.confirm) }
            return true

        case .digit(let n):
            if currentMode == .snooze {
                switch n {
                case 1: snoozeFocused(.hour)
                case 2: snoozeFocused(.tomorrow)
                case 3: snoozeFocused(.nextWeek)
                default: break
                }
            } else if currentMode == .plain {
                focus(n - 1)
            }
            return true

        case .prevTab, .nextTab:
            return true          // handled above, before the tab guard
        }
    }

    enum KeyPress {
        case up, down, enter, escape, snooze, delete, space, digit(Int), yes, no
        case prevTab, nextTab
    }

    /// Opens the snooze affordance on the focused row — the button equivalent
    /// of pressing S.
    func beginSnooze() { setMode(.snooze) }

    /// Opens the dismiss confirmation — the button equivalent of ⌫. Dismiss is
    /// permanent, so the button asks the same question the key does rather
    /// than acting directly.
    func beginDismiss() { setMode(.confirm) }

    private func setMode(_ mode: Row.Mode) {
        guard rows.indices.contains(focusIndex) else { return }
        withAnimation(Nova.motionQuick) { rows[focusIndex].mode = mode }
    }

    // MARK: - Actions

    func done() {
        guard let row = rows[safe: focusIndex] else { return }
        resolve(row, action: .done, until: nil, flare: true)
    }

    func snoozeFocused(_ choice: SnoozeChoice) {
        guard let row = rows[safe: focusIndex] else { return }
        resolve(row, action: .snooze, until: choice.until, flare: false)
    }

    func confirmDismiss() {
        guard let row = rows[safe: focusIndex] else { return }
        resolve(row, action: .dismiss, until: nil, flare: false)
    }

    /// Opens the not-real confirmation — the button equivalent of N.
    func beginNotReal() { setMode(.notReal) }

    func confirmNotReal() {
        guard let row = rows[safe: focusIndex] else { return }
        resolve(row, flare: false) { client, id in try client.rate(loopID: id, rating: -1) }
    }

    /// Marks the focused loop real, or clears the mark. Shown at once and sent
    /// behind it; a refused rating puts the old value back.
    func toggleReal() {
        guard rows.indices.contains(focusIndex) else { return }
        let id = rows[focusIndex].loop.id
        let previous = rows[focusIndex].loop.feedback
        let next: Int? = previous == 1 ? nil : 1
        withAnimation(Nova.motionQuick) { rows[focusIndex].loop.feedback = next }
        let client = self.client
        Task.detached(priority: .userInitiated) {
            do {
                try client.rate(loopID: id, rating: next)
            } catch {
                await MainActor.run {
                    if let i = self.rows.firstIndex(where: { $0.loop.id == id }) {
                        self.rows[i].loop.feedback = previous
                    }
                    self.failure = (error as? ControlError)?.errorDescription ?? "\(error)"
                    self.refresh()
                }
            }
        }
    }

    /// The resolve choreography — the product's emotional centre, and the one
    /// indulgence in it. Flare for 120ms, dissolve over 240ms, collapse so the
    /// rows below settle into the gap. No checkmark, no sound, no confetti:
    /// the reflow is the reward.
    private func resolve(_ row: Row, action: LoopAction, until: Int64?, flare: Bool) {
        resolve(row, flare: flare) { client, id in _ = try client.act(loopID: id, action: action, until: until) }
    }

    private func resolve(
        _ row: Row, flare: Bool,
        send: @escaping @Sendable (ControlClient, String) throws -> Void
    ) {
        guard let index = rows.firstIndex(where: { $0.id == row.id }) else { return }
        let id = row.loop.id
        settling.insert(id)

        // Send immediately; the animation is independent of the round trip.
        let client = self.client
        Task.detached(priority: .userInitiated) {
            do {
                try send(client, id)
                await MainActor.run { self.settling.remove(id); self.refresh() }
            } catch {
                await MainActor.run { self.restore(id, error: error) }
            }
        }

        rows[index].mode = .plain

        if flare {
            withAnimation(Nova.ease(0.12)) { rows[index].flaring = true }
        }

        let flareDelay = flare ? 0.12 : 0.0
        after(flareDelay) {
            guard let i = self.rows.firstIndex(where: { $0.id == id }) else { return }
            withAnimation(Nova.motionBase) { self.rows[i].leaving = true }
        }
        after(flareDelay + Nova.base) {
            guard let i = self.rows.firstIndex(where: { $0.id == id }) else { return }
            withAnimation(Nova.motionBase) { self.rows[i].collapsed = true }
        }
        after(flareDelay + Nova.base * 2) {
            withAnimation(Nova.motionBase) { self.rows.removeAll { $0.id == id } }
            self.clampFocus()
            // Clearing the list should end with the window getting out of the
            // way, after a beat with the empty state visible.
            if self.rows.isEmpty {
                self.after(0.4) { if self.rows.isEmpty { self.onRequestClose?() } }
            }
        }
    }

    /// A refused action puts the row back with the daemon's own wording — it
    /// already phrases these for humans ("loop X is dismissed").
    private func restore(_ id: String, error: Error) {
        settling.remove(id)
        if let index = rows.firstIndex(where: { $0.id == id }) {
            withAnimation(Nova.motionBase) {
                rows[index].flaring = false
                rows[index].leaving = false
                rows[index].collapsed = false
            }
        }
        failure = (error as? ControlError)?.errorDescription ?? "\(error)"
        // Clear the message on the next successful poll rather than on a timer:
        // the state it describes is the daemon's, so the daemon ends it.
        refresh()
    }

    func togglePause() {
        let client = self.client
        let paused = status?.paused ?? false
        Task.detached(priority: .userInitiated) {
            _ = try? paused ? client.resume() : client.pause()
            await MainActor.run { self.refresh() }
        }
    }

    private func after(_ delay: TimeInterval, _ work: @escaping @MainActor () -> Void) {
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(delay))
            work()
        }
    }
}
