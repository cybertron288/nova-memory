// The state of Your Space (F5.5, placed by D22).
//
// Separate from PanelModel on purpose. The panel is summoned, read in about
// two seconds and closed; this window is opened when a user wants to audit
// what Nova has been doing, and then read for minutes. They poll at different
// rates, hold different data and fail differently — a shared model would have
// to serve both and would end up optimised for neither.
import SwiftUI

@MainActor
final class InspectorModel: ObservableObject {
    /// The panes of Your Space.
    ///
    /// An unbuilt pane says so in a line. That is the opposite of D19's ruling
    /// against placeholders, and deliberately so: D19 was about a surface read
    /// in two seconds, where an empty heading spends attention the user did
    /// not offer. This window is opened on purpose to look around, and
    /// hiding the roadmap from someone auditing the app reads as evasion.
    enum Pane: CaseIterable {
        case activity, blockedApps, permissions, profile, data

        var title: String {
            switch self {
            case .activity: return "Activity"
            case .blockedApps: return "Blocked apps"
            case .permissions: return "Permissions"
            case .profile: return "Profile"
            case .data: return "Your data"
            }
        }

        var built: Bool { true }

        /// The sidebar lists only built panes.
        static var shown: [Pane] { allCases.filter(\.built) }

        /// What the pane will hold, shown while it is unbuilt.
        var promise: String {
            switch self {
            case .activity:
                return ""
            case .blockedApps:
                return "Apps and sites Nova will never read, and a count of the windows it skipped because of them"
            case .permissions:
                return "Each macOS permission Nova uses, whether it is on, and what it is for"
            case .profile:
                return "Your name and the handles people use for you, which Nova uses to tell what you owe from what others owe you"
            case .data:
                return "Everything in your memory, with ways to export or erase it"
            }
        }
    }

    enum Tab { case read, sent }

    /// Whether the lists on screen are current. Failure never empties them
    /// into a claim: with no answer yet the window says it cannot know, and
    /// with an earlier answer it keeps that one and says when it ended.
    enum Connection: Equatable {
        case loading
        case live
        /// Nova answered before but not since `lastAnswer`.
        case stale
        /// Nova has not answered since this window opened.
        case unreachable
    }

    /// A clicked row. A capture lights the requests that carried it; a
    /// request lights the captures it contained.
    enum Selection: Equatable {
        case capture(String)
        case call(String)
    }

    @Published var pane: Pane = .activity
    /// +1 when the new pane is lower in the sidebar, -1 when higher. Read by
    /// the pane transition to pick which way content enters.
    @Published private(set) var paneDirection: Double = 1
    @Published var tab: Tab = .read
    @Published var selection: Selection?
    @Published var showAllCaptures = false
    @Published var showAllCalls = false

    @Published private(set) var connection: Connection = .loading
    @Published private(set) var captures: [RecentCapture] = []
    @Published private(set) var calls: [ProviderCall] = []
    @Published private(set) var totals: [String: CallTotal] = [:]
    /// Captures since local midnight, counted by the daemon over the whole
    /// day rather than over the loaded page.
    @Published private(set) var capturesToday = 0
    @Published private(set) var paused = false
    /// When Nova last answered: the "updated" time while live, and the end
    /// of the lists once it stops.
    @Published private(set) var lastAnswer: Date?
    /// Captures Nova gave up on. Empty when there are none, or when the
    /// daemon predates parking — the banner shows only for a real answer.
    @Published private(set) var parked: [ParkedCapture] = []
    @Published private(set) var retrying = false
    /// Set when a retry could not reach Nova. A retry that worked needs no
    /// note: the rows leave the parked list, so the banner goes with them.
    @Published private(set) var retryFailed = false

    // MARK: Blocked apps

    /// The four non-overridable categories, as the daemon names them.
    ///
    /// Not seeded with a local copy. A second copy in Swift would be the same
    /// four strings written twice in two languages, with nothing forcing them
    /// to agree — reword the daemon's and the pane would keep showing the old
    /// text, silently, and indefinitely whenever the daemon was unreachable.
    /// On the one screen whose job is making a guarantee checkable, a stale
    /// promise is worse than a 4ms wait for the real one.
    @Published private(set) var hard: [HardExclusion] = []
    @Published private(set) var rules: [Exclusion] = []
    /// nil until Nova answers, never [:]. Unknown and zero are different
    /// facts and the pane must not show one as the other (motion spec §09).
    @Published private(set) var skipped: [String: Int]?
    @Published private(set) var blockedLoaded = false
    /// Rules whose row is still holding accent after an add (motion spec §04).
    @Published private(set) var fresh: Set<String> = []
    /// What an add deleted, shown on the new row until it is dismissed.
    @Published private(set) var deleted: [String: Int] = [:]
    // MARK: Your data

    /// nil until Nova answers. The pane never shows zeros for "unknown".
    @Published private(set) var dataSummary: DataSummary?
    /// The open delete confirm. One at a time: opening another replaces it.
    @Published private(set) var dataConfirm: DataConfirm?
    /// "Also clear the Sent to your provider list", for Delete everything only.
    @Published var clearCallLog = false

    struct DataConfirm: Equatable {
        let scope: DeleteScope
        /// What the scope is called in the confirm line: "from Slack", "from today".
        let label: String
        /// nil while Nova counts.
        var counts: DeleteCounts?
        var deleting = false
        var failed = false
    }

    // MARK: Profile

    /// nil until Nova answers.
    @Published private(set) var profile: Profile?
    /// The edit in progress. Kept here rather than in the view so a poll
    /// that lands mid-edit cannot reset it.
    @Published var draftName = ""
    @Published private(set) var draftAliases: [String] = []
    @Published private(set) var savingProfile = false
    /// Nova's reason for refusing the last save, shown under the form.
    @Published private(set) var profileError: String?

    // MARK: Permissions

    /// Read from macOS in this process, never asked of Nova, so the pane has
    /// no unreachable state of its own.
    @Published private(set) var grants = InspectorModel.readGrants()
    private var activation: NSObjectProtocol?

    nonisolated private static func readGrants() -> [NovaPermission: Bool] {
        Dictionary(uniqueKeysWithValues: NovaPermission.allCases.map { ($0, $0.granted) })
    }

    /// Also run on activation: the user flips the switch in System Settings
    /// and comes back, and the pane should already agree.
    private func refreshGrants() {
        let next = Self.readGrants()
        if grants != next { grants = next }
    }

    var profileChanged: Bool {
        draftName.trimmingCharacters(in: .whitespacesAndNewlines) != (profile?.name ?? "")
            || draftAliases != (profile?.aliases ?? [])
    }

    /// Unchanged values from `.env` can still be saved, to keep them in the app.
    var canSaveProfile: Bool {
        profile != nil && !savingProfile && (profileChanged || profile?.source == .env)
            && !draftName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The scope being counted before its confirm opens.
    private var pendingDelete: DeleteScope?
    private static let countGrace: Duration = .milliseconds(300)

    @Published var addOpen = false
    @Published var confirming: String?
    @Published private(set) var adding = false
    @Published private(set) var toast: String?

    /// Shown while the window is open. Slower than the panel's 5 s: this is a
    /// reading surface, and a list that reflows under the eye is worse than
    /// one that is a few seconds stale.
    private static let pollInterval: TimeInterval = 15
    /// While Nova is not answering. The window says this number, so it is
    /// the one the timer uses.
    static let retryInterval: TimeInterval = 10

    /// How much each feed loads. Generous compared with the panel's page: the
    /// user came here to look, and the window scrolls.
    private static let pageSize = 100

    /// Rows shown before the fold. Enough for a screenful, and few enough
    /// that the second list is never hundreds of rows away.
    static let captureFold = 12
    static let callFold = 10

    private let client: ControlClient
    private let restartDaemon: () -> Void
    private var poll: Timer?
    private var interval: TimeInterval = 0
    /// False once the window closes, so a refresh still in flight cannot
    /// re-arm the timer behind it.
    private var active = false

    init(client: ControlClient = ControlClient(), restartDaemon: @escaping () -> Void = {}) {
        self.client = client
        self.restartDaemon = restartDaemon
    }

    // MARK: Derived

    var callsToday: Int { totals.values.reduce(0) { $0 + $1.calls } }
    var charsToday: Int { totals.values.reduce(0) { $0 + $1.inputChars } }
    var failedToday: Int { totals.values.reduce(0) { $0 + $1.errors } }

    /// The ids lit by the current selection.
    var linked: Set<String> {
        switch selection {
        case let .capture(id):
            return Set(calls.filter { $0.captures.contains(id) }.map(\.id))
        case let .call(id):
            return Set(calls.first { $0.id == id }?.captures ?? [])
        case nil:
            return []
        }
    }

    func capture(_ id: String) -> RecentCapture? { captures.first { $0.id == id } }

    func toggle(_ s: Selection) {
        selection = selection == s ? nil : s
    }

    // MARK: Polling

    func start() {
        active = true
        activation = activation ?? NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main,
        ) { [weak self] _ in
            Task { @MainActor in self?.refreshGrants() }
        }
        refresh()
    }

    /// Stopped when the window closes: polling a window nobody is looking at
    /// decrypts a page of rows in the daemon for no one.
    func stop() {
        active = false
        if let activation { NotificationCenter.default.removeObserver(activation) }
        activation = nil
        poll?.invalidate()
        poll = nil
        interval = 0
    }

    func restart() {
        restartDaemon()
        refresh()
    }

    func refresh() {
        refreshGrants()
        let client = self.client
        let limit = Self.pageSize
        let since = Int64(Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000)
        // Only the visible pane's data, the same rule the Activity feeds
        // already follow: polling a list nobody is looking at decrypts rows
        // in the daemon for no one.
        let wantBlocked = pane == .blockedApps
        let wantData = pane == .data
        let wantProfile = pane == .profile
        Task.detached(priority: .userInitiated) {
            // The visible pane's data first, and on its own. The Activity
            // feeds decrypt up to 100 captures and 100 calls in the daemon
            // and carry an 8s budget each; fetching them ahead of the blocked
            // list meant switching to Blocked apps waited out two heavy
            // queries it does not use before asking for the one it does
            // (found 2026-10-07 — the pane looked empty for seconds).
            if wantBlocked, let blocked = try? client.listBlocked() {
                await MainActor.run { self.apply(blocked) }
            }
            if wantData, let summary = try? client.dataSummary() {
                await MainActor.run { if self.dataSummary != summary { self.dataSummary = summary } }
            }
            if wantProfile, let profile = try? client.getProfile() {
                await MainActor.run { self.apply(profile) }
            }

            let outcome: Result<(CaptureFeed, CallFeed, DaemonStatus), Error>
            do {
                outcome = .success((
                    try client.listCaptures(limit: limit, since: since),
                    try client.listCalls(limit: limit, since: since),
                    try client.status(),
                ))
            } catch {
                outcome = .failure(error)
            }
            // Separate from the outcome: an older daemon has no list_parked,
            // and that must not turn the whole window "unreachable".
            let parked = try? client.listParked()
            await MainActor.run {
                self.apply(outcome)
                if let parked, parked != self.parked { self.parked = parked }
            }
        }
    }

    /// Re-queues every parked capture. The daemon drains within 15 s; the
    /// banner clears on the refresh that follows, not optimistically.
    func retryParked() {
        guard !retrying else { return }
        retrying = true
        let client = self.client
        Task.detached(priority: .userInitiated) {
            let n = try? client.retryParked()
            await MainActor.run {
                self.retrying = false
                self.retryFailed = n == nil
                self.refresh()
            }
        }
    }

    /// The hard list arrives from the app bundle's point of view — it is the
    /// same four every time — so it is replaced wholesale. Counts update in
    /// place and rows are never reordered by them (motion spec §07).
    private func apply(_ feed: BlockedFeed) {
        // Same rule as the Activity feeds: an identical assignment still
        // invalidates every row.
        if hard != feed.hard { hard = feed.hard }
        if rules != feed.exclusions { rules = feed.exclusions }
        if skipped != feed.skipped { skipped = feed.skipped }
        blockedLoaded = true
    }

    /// Replaces the draft only when the user has not started editing, so a
    /// poll never overwrites what they are typing.
    private func apply(_ next: Profile) {
        let editing = profile != nil && profileChanged
        if profile != next { profile = next }
        guard !editing else { return }
        draftName = next.name ?? ""
        draftAliases = next.aliases
    }

    // MARK: Profile actions

    /// Adds a handle to the draft. Blank and case-insensitive repeats are
    /// skipped here so the list does not show a row Nova would drop.
    func addAlias(_ raw: String) {
        let alias = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !alias.isEmpty,
              !draftAliases.contains(where: { $0.lowercased() == alias.lowercased() }) else { return }
        draftAliases.append(alias)
        profileError = nil
    }

    func removeAlias(_ alias: String) {
        draftAliases.removeAll { $0 == alias }
        profileError = nil
    }

    /// Saves, then shows the values as Nova stored them. A refusal keeps the
    /// draft so the user can correct it.
    func saveProfile() {
        guard canSaveProfile else { return }
        savingProfile = true
        profileError = nil
        let client = self.client
        let name = draftName
        let aliases = draftAliases
        Task.detached(priority: .userInitiated) {
            let result: Result<Profile, Error> = Result { try client.setProfile(name: name, aliases: aliases) }
            await MainActor.run {
                self.savingProfile = false
                switch result {
                case let .success(saved):
                    self.profile = saved
                    self.draftName = saved.name ?? ""
                    self.draftAliases = saved.aliases
                    self.toast = "Saved. Nova uses this from the next capture"
                case let .failure(error):
                    self.profileError = error.localizedDescription
                }
            }
        }
    }

    // MARK: Blocked apps actions

    /// Switches pane and fetches what that pane needs.
    ///
    /// The sidebar must go through this rather than setting `pane` itself:
    /// each pane's data is fetched only while it is visible, so a switch that
    /// only changed the selection left the new pane on its loading state
    /// until the next scheduled poll — up to 15 seconds of an empty-looking
    /// window (found 2026-10-07).
    func select(_ next: Pane) {
        guard next != pane else { return }
        // Which way the content moves: selecting lower in the sidebar brings
        // it up from below, higher brings it down (motion spec §01). The
        // direction is what makes the window feel navigated rather than
        // reloaded, so it is decided here, where the old and new positions
        // are both known.
        let all = Pane.shown
        if let from = all.firstIndex(of: pane), let to = all.firstIndex(of: next) {
            paneDirection = to > from ? 1 : -1
        }
        // Not animated here: the transition is declared on the pane itself,
        // and wrapping the assignment would animate the sidebar wash with the
        // pane's longer curve instead of its own 140ms.
        pane = next
        guard next.built else { return }
        // Already have it: a revisit shows the rows it had and refreshes
        // underneath, rather than blanking back to "Asking Nova".
        if next == .blockedApps && blockedLoaded { refresh(); return }
        if next != .data { pendingDelete = nil; dataConfirm = nil }
        refresh()
    }

    // MARK: Your data actions

    /// Opens the confirm for a scope and asks Nova what it would delete. The
    /// counts are Nova's, never estimated here.
    /// Counts first, then opens the confirm whole. Opening before the counts
    /// arrived reflowed the well mid-animation as its title, lines and button
    /// changed. A count slower than `countGrace` opens the waiting state.
    func askDelete(_ scope: DeleteScope, label: String) {
        guard dataConfirm?.deleting != true else { return }
        clearCallLog = false
        pendingDelete = scope
        let client = self.client
        Task { @MainActor in
            try? await Task.sleep(for: Self.countGrace)
            guard self.pendingDelete == scope, self.dataConfirm?.scope != scope else { return }
            self.dataConfirm = DataConfirm(scope: scope, label: label)
        }
        Task.detached(priority: .userInitiated) {
            let counts = try? client.countForDelete(scope)
            await MainActor.run {
                // Another scope may have been picked, or the ask cancelled, while this one counted.
                guard self.pendingDelete == scope else { return }
                var confirm = self.dataConfirm?.scope == scope ? self.dataConfirm! : DataConfirm(scope: scope, label: label)
                if let counts { confirm.counts = counts } else { confirm.failed = true }
                self.dataConfirm = confirm
            }
        }
    }

    func cancelDelete() {
        guard dataConfirm?.deleting != true else { return }
        pendingDelete = nil
        dataConfirm = nil
    }

    /// Deletes, then reports what Nova says it deleted — after, not before.
    func confirmDelete() {
        guard var confirm = dataConfirm, !confirm.deleting, confirm.counts != nil else { return }
        confirm.deleting = true
        dataConfirm = confirm
        let client = self.client
        let clearLog = confirm.scope == .all && clearCallLog
        Task.detached(priority: .userInitiated) {
            let done = try? client.deleteData(confirm.scope, clearCallLog: clearLog)
            await MainActor.run {
                if let done {
                    self.pendingDelete = nil
                    withAnimation(.nova(Nova.base)) { self.dataConfirm = nil }
                    self.toast = confirm.scope == .all
                        ? "Deleted everything: " + Self.countsLine(done) + (clearLog ? ", and the Sent list" : "")
                        : "Deleted " + Self.countsLine(done) + " " + confirm.label
                } else {
                    self.dataConfirm?.deleting = false
                    self.toast = "Nova couldn't delete that. Nothing was removed"
                }
                self.refresh()
            }
        }
    }

    /// The Keep pop-up whose change is in flight, so only it is disabled.
    @Published private(set) var savingRetention: RetentionField?

    enum RetentionField { case raw, memory }

    func setRetention(_ r: Retention, changed field: RetentionField) {
        guard savingRetention == nil else { return }
        savingRetention = field
        let client = self.client
        Task.detached(priority: .userInitiated) {
            let saved = try? client.setRetention(r)
            await MainActor.run {
                self.savingRetention = nil
                if let saved {
                    self.toast = Self.keepLine(saved, field)
                } else {
                    self.toast = "Nova couldn't save that setting"
                }
                self.refresh()
            }
        }
    }

    /// "Nova keeps captured text for 30 days"
    static func keepLine(_ r: Retention, _ field: RetentionField) -> String {
        let what = field == .raw ? "captured text" : "memories"
        return "Nova keeps \(what) \(keepPhrase(field == .raw ? r.rawDays : r.memoryDays))"
    }

    /// "for 30 days", "for 1 year", "forever"
    static func keepPhrase(_ days: Int?) -> String {
        guard let days else { return "forever" }
        return "for " + daysName(days)
    }

    /// "30 days", "1 year", "Forever"
    static func daysName(_ days: Int?) -> String {
        guard let days else { return "Forever" }
        return days == 365 ? "1 year" : "\(days) day\(days == 1 ? "" : "s")"
    }

    /// The non-zero parts joined: "413 captures, 1,167 memories and 1 loop".
    static func countsLine(_ c: DeleteCounts) -> String {
        func n(_ v: Int, _ one: String, _ many: String) -> String {
            "\(v.formatted()) \(v == 1 ? one : many)"
        }
        var parts: [String] = []
        if c.captures > 0 { parts.append(n(c.captures, "capture", "captures")) }
        if c.memories > 0 { parts.append(n(c.memories, "memory", "memories")) }
        if c.loops > 0 { parts.append(n(c.loops, "loop", "loops")) }
        if parts.isEmpty { return "nothing" }
        if parts.count == 1 { return parts[0] }
        return parts.dropLast().joined(separator: ", ") + " and " + parts.last!
    }

    func openAdd() { addOpen = true }

    func closeAdd() { addOpen = false }

    /// Adds a rule, then reports what it deleted — after the deletion, not
    /// before it (motion spec §04). `label` carries the app's name when
    /// `value` is a bundle id from the picker.
    func add(kind: String, value: String, label: String? = nil) {
        guard !adding else { return }
        adding = true
        let client = self.client
        Task.detached(priority: .userInitiated) {
            let result = try? client.addExclusion(kind: kind, value: value, label: label)
            await MainActor.run {
                self.adding = false
                guard let result else {
                    self.toast = "Nova could not add that rule"
                    return
                }
                self.addOpen = false
                self.deleted[result.id] = result.purged.threads
                self.fresh.insert(result.id)
                self.refresh()
                self.settle(result.id)
            }
        }
    }

    func askRemove(_ id: String) { confirming = id }

    func cancelRemove() { confirming = nil }

    func remove(_ id: String) {
        let name = rules.first { $0.id == id }?.title ?? "that rule"
        confirming = nil
        let client = self.client
        Task.detached(priority: .userInitiated) {
            let ok = (try? client.removeExclusion(id: id)) ?? false
            await MainActor.run {
                self.toast = ok ? "Removed \(name). Nova reads it again" : "Could not remove \(name)"
                self.refresh()
            }
        }
    }

    func clearToast() { toast = nil }

    /// Holds the new row's accent for `ackHold`, then settles it.
    private func settle(_ id: String) {
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(Nova.ackHold))
            withAnimation(.nova(Nova.considered)) { _ = fresh.remove(id) }
        }
    }

    private func apply(_ outcome: Result<(CaptureFeed, CallFeed, DaemonStatus), Error>) {
        switch outcome {
        case let .success((captureFeed, callFeed, status)):
            // Only on a real change. The poll replaces the whole array every
            // 15s, and an identical assignment still invalidates every row —
            // a diff of 100 rows landing mid-scroll is a visible hitch. Both
            // types are Equatable, so this is a cheap compare against an
            // expensive rebuild.
            if captures != captureFeed.captures { captures = captureFeed.captures }
            capturesToday = captureFeed.count ?? captureFeed.captures.count
            if calls != callFeed.calls { calls = callFeed.calls }
            if totals != callFeed.totals { totals = callFeed.totals }
            paused = status.paused
            lastAnswer = callFeed.asOf.map { Date(timeIntervalSince1970: Double($0) / 1000) } ?? Date()
            connection = .live
            schedule(Self.pollInterval)
        case let .failure(error):
            // Logged, not shown: the window's job is to say what it can no
            // longer vouch for, and a socket errno does not help with that.
            panelLog.notice("your space: refresh failed: \(error.localizedDescription, privacy: .public)")
            connection = lastAnswer == nil ? .unreachable : .stale
            schedule(Self.retryInterval)
        }
    }

    /// Re-arms the timer only when the cadence changes, so a refresh the
    /// user asked for does not push the next automatic one further away.
    private func schedule(_ seconds: TimeInterval) {
        guard active, poll == nil || interval != seconds else { return }
        poll?.invalidate()
        interval = seconds
        poll = Timer.scheduledTimer(withTimeInterval: seconds, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }
}
