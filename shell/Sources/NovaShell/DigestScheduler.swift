/// When the morning digest may appear (spec 2026-09-24-morning-digest-design.md §5.1).
///
/// The decision is pure so every rule can be tested without a clock, a screen
/// or a daemon: once a day, at the first chance from 9:00 — morning or not; the
/// card's greeting follows the hour — and never while the Mac is locked, a
/// full-screen app is in front, or the screen is shared.
import AppKit
import CoreGraphics
import Darwin
import Foundation
import os

/// `log stream --predicate 'subsystem == "nova.shell" && category == "digest"'`.
/// 2026-09-28: the daemon logged two digests and no card was seen, and the
/// shell had no record of what it decided or drew.
let digestLog = Logger(subsystem: "nova.shell", category: "digest")

enum DigestDecision: Equatable { case show, wait, skipToday }

struct DigestConditions: Equatable {
    var locked: Bool
    var fullScreen: Bool
    var sharing: Bool
}

enum DigestSchedule {
    static let hour = 9

    static func decide(now: Date, lastShownDay: String?, conditions: DigestConditions,
                       calendar: Calendar = .current) -> DigestDecision {
        if lastShownDay == dayKey(now, calendar: calendar) { return .skipToday }
        if calendar.component(.hour, from: now) < hour { return .wait }
        if conditions.locked || conditions.fullScreen || conditions.sharing { return .wait }
        return .show
    }

    static func dayKey(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
}

/// Drives `DigestSchedule.decide` from a 60 s timer and wake/unlock events,
/// fetches the digest from the daemon, and hands it to the card.
@MainActor
final class DigestController {
    private var timer: Timer?
    private var inFlight = false
    private let card: DigestCardController
    private let glyphFrame: () -> NSRect?
    private var observers: [NSObjectProtocol] = []
    /// Today's key once the digest is settled, held in memory as well as in
    /// shell.json: if the file cannot be written, the card must still never
    /// show twice (review I4).
    private var settledDay: String?

    init(card: DigestCardController, glyphFrame: @escaping () -> NSRect?) {
        self.card = card
        self.glyphFrame = glyphFrame
    }

    private var lastDecision: DigestDecision?

    func start() {
        // `open build/Nova.app --args --digest-now` shows the card once, now,
        // with plain lines (no AI call) and without marking the day — for
        // checking the card while developing.
        // `--digest-now-ai` does the same with the real summary (one AI call).
        let now = CommandLine.arguments.contains("--digest-now")
        let nowAI = CommandLine.arguments.contains("--digest-now-ai")
        if now || nowAI {
            Task.detached(priority: .userInitiated) {
                // The daemon is still starting at launch; ask until it answers.
                var digest: MorningDigest?
                for _ in 0..<30 {
                    digest = try? ControlClient().morningDigest(plain: !nowAI)
                    if digest != nil { break }
                    try? await Task.sleep(for: .seconds(1))
                }
                let found = digest
                await MainActor.run {
                    digestLog.notice("digest-now: count=\(found?.count ?? -1, privacy: .public)")
                    if let found, found.count > 0 { self.card.show(found, under: self.glyphFrame()) }
                }
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        let ws = NSWorkspace.shared.notificationCenter
        observers.append(ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        })
        observers.append(DistributedNotificationCenter.default().addObserver(
            forName: .init("com.apple.screenIsUnlocked"), object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        })
        tick()
    }

    func tick() {
        guard !inFlight else { return }
        let settings = ShellSettings.load()
        let decision = DigestSchedule.decide(now: Date(), lastShownDay: settledDay ?? settings.digestShownOn,
                                             conditions: Self.conditions())
        if decision != lastDecision {
            digestLog.notice("decision: \(String(describing: decision), privacy: .public)")
            lastDecision = decision
        }
        guard decision != .wait else { return }
        let today = DigestSchedule.dayKey(Date())
        if decision == .skipToday {
            return
        }
        inFlight = true
        Task.detached(priority: .utility) {
            // Only a reply settles the day. A daemon that is not up yet — the
            // normal case at login, or the minute after a relaunch — leaves it
            // open, and the next tick asks again until noon (review C2).
            let result = Result { try ControlClient().morningDigest() }
            await MainActor.run {
                self.inFlight = false
                guard case .success(let digest) = result else {
                    if case .failure(let e) = result {
                        digestLog.error("fetch failed, will retry: \(String(describing: e), privacy: .public)")
                    }
                    return
                }
                digestLog.notice("fetched: count=\(digest.count, privacy: .public) summarized=\(digest.summarized, privacy: .public)")
                self.settle(today)
                guard digest.count > 0 else { return }
                self.card.show(digest, under: self.glyphFrame())
            }
        }
    }

    private func settle(_ day: String) {
        settledDay = day
        var s = ShellSettings.load()
        s.digestShownOn = day
        s.save()
    }

    // MARK: Environment

    static func conditions() -> DigestConditions {
        DigestConditions(locked: isLocked(), fullScreen: frontmostIsFullScreen(), sharing: isSharing())
    }

    private static func isLocked() -> Bool {
        guard let d = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
        return (d["CGSSessionScreenIsLocked"] as? Bool) ?? false
    }

    /// The frontmost app's frontmost normal window covers a whole screen.
    private static func frontmostIsFullScreen() -> Bool {
        guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier,
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                                    kCGNullWindowID) as? [[String: Any]] else { return false }
        for w in list where (w[kCGWindowOwnerPID as String] as? Int32) == pid
                        && (w[kCGWindowLayer as String] as? Int) == 0 {
            guard let b = w[kCGWindowBounds as String] as? [String: CGFloat],
                  let width = b["Width"], let height = b["Height"] else { continue }
            // Helper windows (invisible or tiny) come first for some apps;
            // they say nothing about full screen.
            if ((w[kCGWindowAlpha as String] as? Double) ?? 1) == 0 || width < 200 || height < 200 { continue }
            // A full-screen window on a notched display stops below the camera
            // housing, so its height is the screen's minus the top safe inset.
            return NSScreen.screens.contains { s in
                width == s.frame.width && height >= s.frame.height - s.safeAreaInsets.top
            }
        }
        return false
    }

    /// Screen sharing from a known app. There is no public API for "the screen
    /// is being shared"; a share from a browser tab is not detected (spec §5.1).
    private static func isSharing() -> Bool {
        let sharingProcesses: Set<String> = Self.verifiedSharingProcesses
        guard !sharingProcesses.isEmpty else { return false }
        var count = proc_listallpids(nil, 0)
        guard count > 0 else { return false }
        var pids = [pid_t](repeating: 0, count: Int(count))
        count = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        var name = [CChar](repeating: 0, count: 256)
        for pid in pids.prefix(Int(count)) where pid > 0 {
            if proc_name(pid, &name, UInt32(name.count)) > 0,
               sharingProcesses.contains(String(cString: name)) { return true }
        }
        return false
    }

    /// Filled by Task 6, Step 1 with only the process names verified on this
    /// Mac to run exactly while a share is live.
    static let verifiedSharingProcesses: Set<String> = []
}
