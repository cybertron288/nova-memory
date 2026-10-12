/// Starts the daemon, restarts it when it dies, and stops it on quit
/// (shell spec §5, amendment B).
///
/// The shell owns the daemon's *lifetime*; the daemon owns all state. Nothing
/// here reads the socket beyond one question — "is a daemon already
/// answering?" — so the glyph and panel keep getting their truth from the
/// daemon's own `status`, never from whether this class thinks it is running.
///
/// A daemon started by hand (`bun src/cli.ts start`) is adopted, not fought:
/// the supervisor watches it and only spawns its own once it is gone. `start`
/// refuses a second daemon anyway, so spawning over it would just burn
/// restarts.
import AppKit

@MainActor
final class Supervisor {
    enum State: Equatable {
        case idle
        /// A daemon this shell spawned.
        case running(pid: Int32)
        /// A daemon someone else started, answering on the socket.
        case adopted
        /// Waiting out the backoff before the next spawn.
        case waiting
        /// Too many failures in a row; only the menu's Restart retries.
        case gaveUp
        /// Bun or the daemon source could not be found. Not retried.
        case unavailable(String)
    }

    private(set) var state: State = .idle
    /// The daemon's most recent non-empty output line — shown in the menu
    /// when restarting has given up, since the reason is almost always there.
    private(set) var lastLine: String?

    // Backoff (spec §5): 1 s doubling to 60 s, reset after 5 min of uptime,
    // give up after 10 consecutive failures.
    private static let firstDelay: TimeInterval = 1
    private static let maxDelay: TimeInterval = 60
    private static let healthyUptime: TimeInterval = 300
    private static let maxFailures = 10
    private static let adoptedRecheck: TimeInterval = 5

    private var process: Process?
    private var startedAt = Date()
    private var delay = Supervisor.firstDelay
    private var failures = 0
    private var stopping = false
    private var pending: DispatchWorkItem?
    private var log: FileHandle?

    func start() {
        stopping = false
        launchOrAdopt()
    }

    /// The menu's Restart: forget the failure streak and try now.
    func restart() {
        failures = 0
        delay = Self.firstDelay
        pending?.cancel()
        if case .running = state { return }
        launchOrAdopt()
    }

    /// SIGTERM, up to 3 s for a clean exit, then SIGKILL (spec §5). Blocking:
    /// it runs from `applicationWillTerminate`, and returning early would let
    /// the shell exit with the daemon still going. An adopted daemon is left
    /// alone — this shell did not start it.
    func stop() {
        stopping = true
        pending?.cancel()
        guard let process, process.isRunning else { return }
        let pid = process.processIdentifier
        kill(pid, SIGTERM)
        let deadline = Date().addingTimeInterval(3)
        while process.isRunning && Date() < deadline {
            usleep(50_000)
        }
        if process.isRunning { kill(pid, SIGKILL) }
    }

    // MARK: - Lifecycle

    /// Ask the socket first. Off the main thread: the client blocks for up to
    /// its timeout when nothing is listening on a stale socket file.
    private func launchOrAdopt() {
        guard !stopping else { return }
        Task.detached(priority: .utility) {
            let answering = (try? ControlClient().status()) != nil
            await MainActor.run {
                guard !self.stopping else { return }
                if answering {
                    self.state = .adopted
                    self.schedule(after: Self.adoptedRecheck) { self.launchOrAdopt() }
                } else {
                    self.spawn()
                }
            }
        }
    }

    private func spawn() {
        guard let bun = Self.findBun() else {
            state = .unavailable("bun not found")
            return
        }
        guard let daemonDir = Self.findDaemonDir() else {
            state = .unavailable("daemon source not found")
            return
        }

        let p = Process()
        p.executableURL = bun
        p.arguments = ["src/cli.ts", "start"]
        // The daemon's directory, so Bun loads the provider keys from its .env.
        p.currentDirectoryURL = daemonDir
        var env = ProcessInfo.processInfo.environment
        // A shell launched from Finder or login has a bare PATH.
        env["PATH"] = [bun.deletingLastPathComponent().path,
                       env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"].joined(separator: ":")
        // The bundled app carries its own capture; naming it here makes the
        // daemon launch that one, so it runs under Nova.app's signature and
        // Accessibility grant. A bare binary from shell/.build has no sibling
        // and leaves the daemon on the checkout's build. An explicit
        // NOVA_CAPTURE_BIN in the shell's own environment wins.
        if env["NOVA_CAPTURE_BIN"] == nil,
           let capture = Bundle.main.url(forAuxiliaryExecutable: "nova-capture") {
            env["NOVA_CAPTURE_BIN"] = capture.path
        }
        p.environment = env

        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        let log = openLog()
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            // To the end on every write, not from a remembered offset: the
            // daemon empties this file on "delete everything", and a handle
            // still at the old offset would pad the file back out with zeros.
            _ = try? log?.seekToEnd()
            log?.write(data)
            let line = String(decoding: data, as: UTF8.self)
                .split(whereSeparator: \.isNewline).last.map(String.init)
            if let line, !line.trimmingCharacters(in: .whitespaces).isEmpty {
                Task { @MainActor in self?.lastLine = line }
            }
        }

        p.terminationHandler = { [weak self] proc in
            // The daemon exits 0 only from its own SIGTERM/SIGINT shutdown:
            // someone stopped it on purpose (`pkill` while iterating on the
            // daemon, a terminal's `start --force`). A crash exits non-zero.
            let clean = proc.terminationReason == .exit && proc.terminationStatus == 0
            Task { @MainActor in self?.exited(clean: clean) }
        }

        do {
            try p.run()
        } catch {
            lastLine = error.localizedDescription
            process = nil
            exited(clean: false)
            return
        }
        process = p
        startedAt = Date()
        state = .running(pid: p.processIdentifier)
    }

    private func exited(clean: Bool) {
        process = nil
        guard !stopping else { state = .idle; return }

        // A daemon that stayed up long enough was healthy, and one stopped
        // cleanly did not fail: either way this exit starts a fresh streak.
        // Counting clean stops walked the backoff up to 60 s and then gave up
        // after ten `pkill`s — the documented way to restart the daemon.
        if clean || Date().timeIntervalSince(startedAt) >= Self.healthyUptime {
            failures = 0
            delay = Self.firstDelay
        }
        failures += 1
        if failures >= Self.maxFailures {
            state = .gaveUp
            return
        }
        state = .waiting
        let wait = delay
        delay = min(delay * 2, Self.maxDelay)
        schedule(after: wait) { self.launchOrAdopt() }
    }

    private func schedule(after seconds: TimeInterval, _ work: @escaping @MainActor () -> Void) {
        pending?.cancel()
        let item = DispatchWorkItem { MainActor.assumeIsolated { work() } }
        pending = item
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
    }

    // MARK: - Finding things

    /// `~/Library/Logs/Nova/daemon.log`, appended across restarts. There is
    /// no terminal to read the daemon's output in any more.
    ///
    /// Rotated once it is a week old: the log names the user's loops in plain
    /// text, so it should not outlive them by months (F5.6). The previous
    /// week is kept as `daemon.log.1` for debugging, so at most two weeks
    /// exist at once. Checked on each daemon start.
    private func openLog() -> FileHandle? {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Nova", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("daemon.log")
        if Self.rotateIfOld(file) {
            try? log?.close()
            log = nil
        }
        if let log { return log }
        if !FileManager.default.fileExists(atPath: file.path) {
            // Owner-only: it names the user's loops in plain text.
            FileManager.default.createFile(atPath: file.path, contents: nil,
                                           attributes: [.posixPermissions: 0o600])
        }
        let handle = try? FileHandle(forWritingTo: file)
        _ = try? handle?.seekToEnd()
        log = handle
        return handle
    }

    private static let logMaxAge: TimeInterval = 7 * 24 * 3600

    /// Moves a log older than a week to `.1`, replacing the one before.
    /// True when it rotated, so the open handle must be replaced.
    private static func rotateIfOld(_ file: URL) -> Bool {
        let fm = FileManager.default
        guard let created = (try? fm.attributesOfItem(atPath: file.path))?[.creationDate] as? Date,
              Date().timeIntervalSince(created) > logMaxAge else { return false }
        let previous = file.appendingPathExtension("1")
        try? fm.removeItem(at: previous)
        return (try? fm.moveItem(at: file, to: previous)) != nil
    }

    /// `NOVA_BUN`, then the usual install locations. Not `PATH`: an app
    /// launched outside a terminal does not have the user's.
    private static func findBun() -> URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [ProcessInfo.processInfo.environment["NOVA_BUN"],
                          "\(home)/.bun/bin/bun", "/opt/homebrew/bin/bun", "/usr/local/bin/bun"]
        return candidates.compactMap { $0 }
            .first { FileManager.default.isExecutableFile(atPath: $0) }
            .map { URL(fileURLWithPath: $0) }
    }

    /// `NOVA_DAEMON_DIR`, else the checkout the shell binary was built in:
    /// walk up from `shell/.build/<config>/NovaShell` until a directory holds
    /// `daemon/src/cli.ts`. The bundled app (`build/Nova.app`) sits inside the
    /// checkout, so this walk finds the daemon from there too; shipping the
    /// daemon inside the bundle is stage 2.
    private static func findDaemonDir() -> URL? {
        let fm = FileManager.default
        if let dir = ProcessInfo.processInfo.environment["NOVA_DAEMON_DIR"] {
            return URL(fileURLWithPath: dir)
        }
        var url = Bundle.main.executableURL?.resolvingSymlinksInPath().deletingLastPathComponent()
        for _ in 0..<8 {
            guard let current = url else { return nil }
            let daemon = current.appendingPathComponent("daemon")
            if fm.fileExists(atPath: daemon.appendingPathComponent("src/cli.ts").path) {
                return daemon
            }
            url = current.deletingLastPathComponent()
        }
        return nil
    }
}
