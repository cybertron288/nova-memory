/// The shell's only link to daemon state (shell spec §5, §6).
///
/// Newline-delimited JSON over a Unix domain socket. Request `{id, op, ...}`,
/// reply `{id, ok, result|error}`. Requests may interleave; replies are matched
/// by id, so a slow `list_loops` never blocks a `status`.
///
/// The daemon owns all state. This client caches nothing: every answer comes
/// from a live round trip, and a failed round trip surfaces as `.disconnected`
/// rather than as a stale value. A menu-bar app that lies about whether it is
/// capturing is the worst failure this product can have.
import Foundation

// MARK: - Wire types

/// `status`. Mirrors the daemon's reply in control.ts exactly; adding a field
/// here that the daemon does not send makes every decode fail.
struct DaemonStatus: Decodable, Equatable {
    let capturing: Bool
    let paused: Bool
    let queued: Int
    let lastCaptureAt: Int64?
    let lastError: String?
    let uptimeMs: Int64
    let pid: Int
}

/// One row of `list_loops`, matching `OpenLoop` in daemon/src/loops.ts.
struct OpenLoop: Decodable, Equatable, Identifiable {
    let id: String
    let description: String
    let direction: String
    let counterparty: String?
    let dueSignal: String?
    let state: String
    let createdAt: Int64
    let ageDays: Int
    /// The app this was captured from, or nil when the evidence link is gone.
    /// Optional in the Swift type as well as the wire type: an older daemon
    /// does not send the field at all, and the panel should still run.
    let sourceApp: String?
    /// The user's verdict (F4.5): 1 real, -1 not real, nil unrated. Optional
    /// on the wire too: an older daemon does not send it.
    var feedback: Int?

    /// `Slack · Dana Reyes · today 3:42 PM · said "today"` — the parts that exist, joined.
    ///
    /// The app leads, because provenance is what makes a surfaced loop
    /// checkable: "you said this, in Slack" can be verified against the thread
    /// it came from, while "you said this" has to be taken on faith. It is
    /// omitted rather than guessed when the daemon reports none.
    var meta: String { metaParts.map(\.text).joined(separator: " · ") }

    /// The same parts, with the counterparty marked, so the row can colour the
    /// person alone.
    var metaParts: [(text: String, isPerson: Bool)] {
        var parts: [(text: String, isPerson: Bool)] = []
        if let app = sourceApp, !app.isEmpty { parts.append((app, false)) }
        if let who = counterparty, !who.isEmpty { parts.append((who, true)) }
        parts.append((Self.when(createdAt), false))
        if let due = dueSignal, !due.isEmpty { parts.append(("said \"\(due)\"", false)) }
        return parts
    }

    /// "today 3:42 PM", "yesterday 9:05 AM", then "3d ago". Calendar days,
    /// not 24-hour spans: a loop from 11 PM is "yesterday" at 1 AM. The time
    /// is shown only while it still helps place the conversation.
    static func when(_ createdAtMs: Int64, now: Date = Date(), calendar: Calendar = .current) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(createdAtMs) / 1000)
        let time = timeFormatter.string(from: date)
        if calendar.isDateInToday(date) { return "today \(time)" }
        if calendar.isDateInYesterday(date) { return "yesterday \(time)" }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date),
                                           to: calendar.startOfDay(for: now)).day ?? 0
        return days <= 0 ? "today \(time)" : "\(days)d ago"
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "h:mm a"
        return f
    }()

    /// Someone else owes this to the user. The panel lists these last, under
    /// their own header, instead of mixing them into the user's own work.
    var isWaitingOn: Bool { direction == "owed_to_me" }
}

/// One row of `list_memories` — a fact Nova extracted, already decrypted by
/// the daemon, which is the only process holding the field key.
struct Memory: Decodable, Equatable, Identifiable {
    let id: String
    let text: String
    let sourceApp: String?
    let capturedAt: Int64

    /// Coarse on purpose: the exact second a fact was read is noise, and the
    /// list is scanned rather than audited.
    var age: String { relativeAge(capturedAt) }
}

/// One capture, for the Activity tab (F5.5). Sizes rather than content: the
/// feed says which window was read and how much came from it, and the text
/// itself stays one deliberate click away in the Memory tab.
struct RecentCapture: Decodable, Equatable, Identifiable {
    let id: String
    let at: Int64
    let app: String
    let title: String
    let url: String?
    let chars: Int
    let words: Int

    var age: String { relativeAge(at) }

    /// The window, as the panel labels it: the title when there is one, the
    /// host when the title is empty but a URL is not.
    var label: String {
        if !title.isEmpty { return title }
        if let url, let host = URL(string: url)?.host { return host }
        return app
    }
}

/// One outbound provider call, for the Activity tab (F5.5). Metadata only —
/// the daemon records no prompt, reply or captured text, so there is none to
/// decode here.
struct ProviderCall: Decodable, Equatable, Identifiable {
    let id: String
    let at: Int64
    let provider: String
    let model: String
    /// "chat" or "embed".
    let kind: String
    /// "ok" or "error".
    let outcome: String
    let ms: Int
    let inputChars: Int
    let items: Int
    let status: Int?
    let detail: String?
    /// "memories", "loops", "digest", "probe" or "search"; absent for a call logged
    /// before the daemon attributed them.
    let purpose: String?
    /// The captures this call carried. Optional so an older daemon's reply
    /// still decodes; read through `captures`.
    let captureIds: [String]?

    var failed: Bool { outcome != "ok" }
    var age: String { relativeAge(at) }
    var captures: [String] { captureIds ?? [] }
}

struct CallTotal: Decodable, Equatable {
    let calls: Int
    let errors: Int
    let inputChars: Int
    let items: Int
}

/// What the Activity tab shows in one round trip.
struct CallFeed: Decodable, Equatable {
    let calls: [ProviderCall]
    /// Scoped to `since` when the request sent one, else the whole log.
    let totals: [String: CallTotal]
    /// When the daemon answered, epoch ms.
    let asOf: Int64?
}

struct CaptureFeed: Decodable, Equatable {
    let captures: [RecentCapture]
    /// Every capture since the request's `since`, not only this page.
    let count: Int?
    let asOf: Int64?
}

/// One exclusion in the user's own deny-list (D21).
/// One rule in the user's own list (D21). Additive: it refuses more than the
/// hard exclusions, never less.
struct Exclusion: Decodable, Equatable, Identifiable {
    let id: String
    /// "app" or "domain".
    let kind: String
    /// What is matched: a bundle id, a host, or an app name for an older rule.
    let value: String
    /// The readable name when `value` is a bundle id nobody reads.
    let label: String?
    /// Windows this rule has refused, ever.
    let skipped: Int

    /// What the row shows: the name when there is one, else the value itself.
    var title: String { label ?? value }
    /// The line under it: the bundle id when the title is a name.
    var subtitle: String? { label == nil ? nil : value }
}

/// One non-overridable category, shipped inside Nova.
///
/// Rendered as a statement rather than a disabled control: the design's rule
/// is that nothing on these rows looks switchable, because the user is not
/// being denied a setting — they are being shown a guarantee.
struct HardExclusion: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let detail: String
    let overridable: Bool
}

/// Everything the Blocked apps pane needs, in one round trip. Separate calls
/// would let the pane draw the user's list while the hard list was still
/// loading, which reads as "this is everything that is blocked".
struct BlockedFeed: Decodable, Equatable {
    let hard: [HardExclusion]
    let exclusions: [Exclusion]
    let skipped: [String: Int]
}

/// A capture the pipeline gave up on. It stays queued, parked, until it is
/// retried: a capture leaves the queue only when it succeeds.
struct ParkedCapture: Decodable, Equatable, Identifiable {
    let versionId: String
    let app: String
    let attempts: Int
    let parkedAt: Int64
    let capturedAt: Int64
    let error: String?
    var id: String { versionId }
}

struct ParkedFeed: Decodable, Equatable {
    let parked: [ParkedCapture]
}

/// What a delete reaches, before it runs (count_for_delete) or after
/// (delete_data). Loops are the daemon's own count: a loop goes only when
/// nothing outside the scope still backs it.
struct DeleteCounts: Decodable, Equatable {
    let captures: Int
    let memories: Int
    let loops: Int
}

/// Which captures a delete takes (F5.3).
enum DeleteScope: Equatable {
    /// Captures in [from, to), epoch ms.
    case range(from: Int64, to: Int64)
    case app(String)
    case all

    var json: [String: Any] {
        switch self {
        case let .range(from, to): return ["kind": "range", "from": from, "to": to]
        case let .app(app): return ["kind": "app", "app": app]
        case .all: return ["kind": "all"]
        }
    }
}

/// How long Nova keeps captured text and memories (F5.4). nil is forever.
struct Retention: Decodable, Equatable {
    var rawDays: Int?
    var memoryDays: Int?

    /// The choices the daemon accepts; anything else it refuses.
    static let rawChoices: [Int?] = [7, 30, 90, 365, nil]
    static let memoryChoices: [Int?] = [nil, 365]
}

/// The user's name and handles, which decide loop direction (D24).
struct Profile: Decodable, Equatable {
    /// Where the values came from. `env` is `.env`; `none` means no name is set.
    enum Source: String, Decodable { case app, env, none }
    let name: String?
    let aliases: [String]
    let source: Source
}

/// The Your data pane in one reply.
struct DataSummary: Decodable, Equatable {
    struct App: Decodable, Equatable, Identifiable {
        let app: String
        let captures: Int
        let last: Int64
        var id: String { app }
    }
    struct Sweep: Decodable, Equatable {
        let at: Int64
        let rawRemoved: Int
        let deleted: DeleteCounts
    }
    let captures: Int
    let memories: Int
    let loops: Int
    /// Captures whose text retention already removed.
    let rawRemoved: Int
    let oldest: Int64?
    let apps: [App]
    /// Store on disk, main file plus write-ahead log.
    let bytes: Int64?
    let retention: Retention
    let lastSweep: Sweep?
    let asOf: Int64?
}

struct ExclusionList: Decodable, Equatable {
    let exclusions: [Exclusion]
}

/// "2m ago", "3h ago", "yesterday" — shared by every row that shows an age.
/// Coarse on purpose: the exact second is noise in a list that is scanned.
func relativeAge(_ epochMillis: Int64) -> String {
    let seconds = Int(Date().timeIntervalSince1970) - Int(epochMillis / 1000)
    switch seconds {
    case ..<60: return "just now"
    case ..<3600: return "\(seconds / 60)m ago"
    case ..<86_400: return "\(seconds / 3600)h ago"
    case ..<172_800: return "yesterday"
    default: return "\(seconds / 86_400)d ago"
    }
}

/// The morning digest (F4.3), written by the daemon, shown once by the shell.
struct MorningDigest: Decodable, Equatable {
    struct Block: Decodable, Equatable {
        let person: String?
        let text: String
        /// Loops the block covers; absent from an older daemon.
        let loops: Int?
    }
    let count: Int
    let owe: [Block]
    let waitingOn: [Block]
    let yesterday: String?
    let summarized: Bool
    /// The user's first name, for the greeting.
    let user: String?
}

enum LoopAction: String {
    case done, snooze, dismiss
}

/// Every way a control call can fail, each with a consequence the UI can show.
/// No case is silent and none collapses into a generic "error".
enum ControlError: Error, LocalizedError {
    /// No socket file, or the daemon is not listening on it.
    case notRunning
    /// Connected, but no reply within the timeout. Treated as a disconnect.
    case timedOut
    /// The daemon answered `ok: false` — an expected refusal, already phrased
    /// for a human ("loop X is dismissed"). Shown verbatim.
    case refused(String)
    /// The reply did not decode. A wire-contract mismatch, not a user problem.
    case malformed(String)

    var errorDescription: String? {
        switch self {
        case .notRunning: return "Nova isn't running"
        case .timedOut: return "Nova isn't responding"
        case .refused(let why): return why
        case .malformed(let what): return "Unexpected reply: \(what)"
        }
    }
}

// MARK: - Client

/// A one-shot-per-request client over a persistent connection.
///
/// Deliberately synchronous on a private queue rather than async/await: the
/// call sites are a 5-second poll and a button tap, the payloads are small,
/// and a blocking read with a hard timeout is far easier to reason about than
/// a continuation that might never resume.
final class ControlClient {
    /// `~/Library/Application Support/Nova/control.sock`, the path the daemon
    /// binds (control.ts `CONTROL_SOCKET_NAME`). Overridable for tests and for
    /// running against a daemon in a checkout.
    static func defaultSocketPath() -> String {
        if let override = ProcessInfo.processInfo.environment["NOVA_CONTROL_SOCKET"] {
            return override
        }
        let support = FileManager.default
            .homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Nova", isDirectory: true)
        return support.appendingPathComponent("control.sock").path
    }

    private let socketPath: String
    private let queue = DispatchQueue(label: "app.nova.control")
    private var fd: Int32 = -1
    /// Bytes read past the end of one reply belong to the next one. Dropping
    /// them would desynchronise the stream the first time two replies land in
    /// a single read, which interleaved requests make likely.
    private var carry = Data()
    private var nextID = 1

    /// Matches the shell spec's 2 s budget: longer than any real reply, short
    /// enough that a hung daemon flips the glyph to *attention* promptly.
    private let timeout: TimeInterval = 2.0

    init(socketPath: String = ControlClient.defaultSocketPath()) {
        self.socketPath = socketPath
    }

    deinit { closeConnection() }

    // MARK: Ops

    func status() throws -> DaemonStatus {
        try call(op: "status", args: [:], as: DaemonStatus.self)
    }

    /// One page of a list, for the panel's infinite scroll. `next` is the
    /// daemon's opaque cursor for the page after, nil at the end.
    struct Page<Item: Decodable>: Decodable {
        let items: [Item]
        let next: String?
        /// Every item, not only the loaded ones; sent for loops only.
        let total: Int?
    }

    func listLoopsPage(after: String? = nil, limit: Int = 30) throws -> Page<OpenLoop> {
        var args: [String: Any] = ["limit": limit]
        if let after { args["after"] = after }
        return try call(op: "list_loops_page", args: args, as: Page<OpenLoop>.self)
    }

    /// Given the memory list's longer budget: each row is decrypted in the daemon.
    func listMemoriesPage(after: String? = nil, limit: Int = 30) throws -> Page<Memory> {
        var args: [String: Any] = ["limit": limit]
        if let after { args["after"] = after }
        return try call(op: "list_memories_page", args: args, as: Page<Memory>.self, timeout: 8)
    }

    func listLoops(limit: Int = 20) throws -> [OpenLoop] {
        try call(op: "list_loops", args: ["limit": limit], as: [OpenLoop].self)
    }

    /// Recent memories.
    ///
    /// Given its own budget: the other ops answer in a few milliseconds, but
    /// this one decrypts a row per memory in the daemon and returns tens of
    /// kilobytes over several socket reads. At the shared 2 s budget it timed
    /// out every time and the tab sat on its skeleton forever — the daemon was
    /// answering correctly the whole while.
    ///
    /// 25 rather than 40 for the same reason: a panel read in two seconds does
    /// not need forty facts, and the reply is smaller for it.
    func listMemories(limit: Int = 25) throws -> [Memory] {
        try call(op: "list_memories", args: ["limit": limit], as: [Memory].self, timeout: 8)
    }

    /// The Activity tab's two feeds (F5.5). Both decrypt or scan a page of
    /// rows in the daemon, so they take the memory list's longer budget
    /// rather than the shared 2 s one.
    /// `since` (epoch ms) asks for a count and totals over the user's day.
    func listCaptures(limit: Int = 30, since: Int64? = nil) throws -> CaptureFeed {
        var args: [String: Any] = ["limit": limit]
        if let since { args["since"] = since }
        return try call(op: "list_captures", args: args, as: CaptureFeed.self, timeout: 8)
    }

    func listCalls(limit: Int = 30, since: Int64? = nil) throws -> CallFeed {
        var args: [String: Any] = ["limit": limit]
        if let since { args["since"] = since }
        return try call(op: "list_calls", args: args, as: CallFeed.self, timeout: 8)
    }

    /// The user's exclusion list (D21).
    func listExclusions() throws -> [Exclusion] {
        try call(op: "list_exclusions", args: [:], as: ExclusionList.self).exclusions
    }

    /// The whole Blocked apps pane in one call.
    func listBlocked() throws -> BlockedFeed {
        try call(op: "list_blocked", args: [:], as: BlockedFeed.self, timeout: 8)
    }

    /// Captures Nova gave up on, newest first.
    func listParked() throws -> [ParkedCapture] {
        try call(op: "list_parked", args: [:], as: ParkedFeed.self).parked
    }

    /// Puts every parked capture back in the queue. Returns how many.
    @discardableResult
    func retryParked() throws -> Int {
        struct Requeued: Decodable { let requeued: Int }
        return try call(op: "retry_parked", args: [:], as: Requeued.self).requeued
    }

    func dataSummary() throws -> DataSummary {
        try call(op: "data_summary", args: [:], as: DataSummary.self, timeout: 8)
    }

    func countForDelete(_ scope: DeleteScope) throws -> DeleteCounts {
        try call(op: "count_for_delete", args: ["scope": scope.json], as: DeleteCounts.self, timeout: 30)
    }

    /// Can rewrite the whole store ("everything" ends in VACUUM), so it gets
    /// a long budget: a timeout here would report failure for a delete that
    /// went through.
    @discardableResult
    func deleteData(_ scope: DeleteScope, clearCallLog: Bool = false) throws -> DeleteCounts {
        try call(op: "delete_data", args: ["scope": scope.json, "clearCallLog": clearCallLog],
                 as: DeleteCounts.self, timeout: 120)
    }

    /// Sends explicit nulls: an absent key is refused, never read as forever.
    @discardableResult
    func setRetention(_ r: Retention) throws -> Retention {
        let value: [String: Any] = ["rawDays": r.rawDays.map { $0 as Any } ?? NSNull(),
                                    "memoryDays": r.memoryDays.map { $0 as Any } ?? NSNull()]
        return try call(op: "set_retention", args: ["retention": value], as: Retention.self)
    }

    func getProfile() throws -> Profile {
        try call(op: "get_profile", args: [:], as: Profile.self)
    }

    /// Returns the values as Nova stored them: trimmed, empties and
    /// duplicates dropped. Invalid input comes back as `.refused` with the reason.
    @discardableResult
    func setProfile(name: String, aliases: [String]) throws -> Profile {
        try call(op: "set_profile", args: ["name": name, "aliases": aliases], as: Profile.self)
    }

    /// What an add did, so the row can report the deletion as done rather
    /// than predict it.
    struct AddResult: Decodable, Equatable {
        let id: String
        let purged: Purged
        struct Purged: Decodable, Equatable {
            let threads: Int
            let versions: Int
            let memories: Int
            let loops: Int
        }
    }

    /// Adding one also purges what was already captured from that source, so
    /// this can take as long as a purge and gets the longer budget.
    ///
    /// `label` carries the app's display name when `value` is a bundle id
    /// from the picker.
    @discardableResult
    func addExclusion(kind: String, value: String, label: String? = nil) throws -> AddResult {
        var args: [String: Any] = ["kind": kind, "value": value]
        if let label, !label.isEmpty { args["label"] = label }
        return try call(op: "add_exclusion", args: args, as: AddResult.self, timeout: 8)
    }

    @discardableResult
    func removeExclusion(id: String) throws -> Bool {
        struct Removed: Decodable { let removed: Bool }
        return try call(op: "remove_exclusion", args: ["exclusionId": id],
                        as: Removed.self).removed
    }

    /// Returns the loop's new state. `until` is epoch milliseconds and only
    /// meaningful for `.snooze`.
    @discardableResult
    /// May wait on one AI call; the daemon falls back at 20 s, so 30 s here
    /// always sees the daemon's answer rather than a timeout.
    func morningDigest(plain: Bool = false) throws -> MorningDigest {
        try call(op: "morning_digest", args: plain ? ["plain": true] : [:],
                 as: MorningDigest.self, timeout: 30)
    }

    func act(loopID: String, action: LoopAction, until: Int64? = nil) throws -> String {
        var args: [String: Any] = ["loopId": loopID, "action": action.rawValue]
        if let until { args["until"] = until }
        struct ActResult: Decodable { let state: String }
        return try call(op: "act_on_loop", args: args, as: ActResult.self).state
    }

    /// F4.5: 1 real, -1 not real (which also dismisses), nil clears.
    func rate(loopID: String, rating: Int?) throws {
        let args: [String: Any] = ["loopId": loopID, "rating": rating as Any? ?? NSNull()]
        struct RateResult: Decodable { let state: String }
        _ = try call(op: "rate_loop", args: args, as: RateResult.self)
    }

    @discardableResult
    func pause() throws -> Bool {
        struct PauseResult: Decodable { let paused: Bool }
        return try call(op: "pause", args: [:], as: PauseResult.self).paused
    }

    @discardableResult
    func resume() throws -> Bool {
        struct PauseResult: Decodable { let paused: Bool }
        return try call(op: "resume", args: [:], as: PauseResult.self).paused
    }

    // MARK: Transport

    private func call<T: Decodable>(
        op: String, args: [String: Any], as type: T.Type, timeout budget: TimeInterval? = nil
    ) throws -> T {
        try queue.sync {
            let id = nextID
            nextID += 1

            var body = args
            body["id"] = id
            body["op"] = op
            guard let line = try? JSONSerialization.data(withJSONObject: body) else {
                throw ControlError.malformed("could not encode \(op)")
            }

            do {
                try ensureConnected()
                try writeLine(line)
                let reply = try readReply(matching: id, budget: budget ?? timeout)
                return try decode(reply, as: type)
            } catch {
                // Any transport failure invalidates the connection: a half-read
                // stream would mismatch every later reply. Reconnect next call.
                closeConnection()
                throw error
            }
        }
    }

    private func ensureConnected() throws {
        if fd >= 0 { return }
        guard FileManager.default.fileExists(atPath: socketPath) else {
            throw ControlError.notRunning
        }

        let sock = socket(AF_UNIX, SOCK_STREAM, 0)
        guard sock >= 0 else { throw ControlError.notRunning }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketPath.utf8)
        // sun_path is a fixed 104-byte C array; anything longer cannot be
        // connected to at all, so say so rather than truncating into a path
        // that silently addresses the wrong socket.
        guard pathBytes.count < MemoryLayout.size(ofValue: addr.sun_path) else {
            close(sock)
            throw ControlError.malformed("socket path too long")
        }
        withUnsafeMutableBytes(of: &addr.sun_path) { raw in
            raw.copyBytes(from: pathBytes)
        }

        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let ok = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                connect(sock, sa, size) == 0
            }
        }
        guard ok else {
            close(sock)
            throw ControlError.notRunning
        }

        // A read timeout is what turns a hung daemon into a visible
        // "not responding" instead of a frozen menu bar.
        var tv = timeval(tv_sec: Int(timeout), tv_usec: 0)
        setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        fd = sock
        carry.removeAll(keepingCapacity: true)
    }

    private func writeLine(_ payload: Data) throws {
        var out = payload
        out.append(0x0A)
        try out.withUnsafeBytes { raw in
            var sent = 0
            while sent < raw.count {
                // MSG_NOSIGNAL is unavailable on Darwin; SO_NOSIGPIPE is set
                // per-socket instead by ignoring SIGPIPE process-wide in App.
                let n = send(fd, raw.baseAddress!.advanced(by: sent), raw.count - sent, 0)
                if n <= 0 { throw ControlError.notRunning }
                sent += n
            }
        }
    }

    /// Reads until a reply carrying `id` arrives. Replies for other ids are
    /// discarded rather than buffered: with two in-flight requests at most,
    /// the loser is the poll, which runs again in five seconds anyway.
    private func readReply(matching id: Int, budget: TimeInterval) throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(budget)

        while true {
            if let line = takeLine() {
                guard let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else {
                    throw ControlError.malformed(String(data: line, encoding: .utf8) ?? "<binary>")
                }
                if let replyID = obj["id"] as? Int, replyID != id { continue }
                return obj
            }

            if Date() >= deadline { throw ControlError.timedOut }

            var buf = [UInt8](repeating: 0, count: 8192)
            let n = recv(fd, &buf, buf.count, 0)
            if n > 0 {
                carry.append(contentsOf: buf[0..<n])
            } else if n == 0 {
                throw ControlError.notRunning          // daemon closed the socket
            } else if errno == EAGAIN || errno == EWOULDBLOCK {
                // The socket's own timeout (the 2 s default) has passed, not
                // this call's budget. Keep waiting until the deadline above:
                // the digest's budget is 30 s because its reply waits on an AI
                // call, and treating the first 2 s as the end made every
                // digest time out — no card was ever shown (2026-09-28).
                continue
            } else if errno != EINTR {
                throw ControlError.notRunning
            }
        }
    }

    private func takeLine() -> Data? {
        guard let idx = carry.firstIndex(of: 0x0A) else { return nil }
        let line = carry[carry.startIndex..<idx]
        carry.removeSubrange(carry.startIndex...idx)
        return Data(line)
    }

    private func decode<T: Decodable>(_ reply: [String: Any], as type: T.Type) throws -> T {
        if let ok = reply["ok"] as? Bool, ok == false {
            throw ControlError.refused(reply["error"] as? String ?? "refused")
        }
        guard let result = reply["result"] else {
            throw ControlError.malformed("reply had no result")
        }
        // Re-serialise the `result` sub-object so Codable can decode it; the
        // outer envelope is heterogeneous and not worth a wrapper type.
        let data = try JSONSerialization.data(withJSONObject: result, options: [.fragmentsAllowed])
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw ControlError.malformed("\(type): \(error)")
        }
    }

    private func closeConnection() {
        if fd >= 0 { close(fd) }
        fd = -1
        carry.removeAll(keepingCapacity: true)
    }
}
