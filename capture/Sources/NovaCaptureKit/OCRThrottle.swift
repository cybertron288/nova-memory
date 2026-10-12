import Foundation

/// Per-window budget for the OCR fallback, keyed by CG window ID.
///
/// `isDue` runs before any screenshot, so a window inside its interval costs
/// nothing. `shouldRecognize` runs after the screenshot, so unchanged pixels
/// skip Vision, the expensive half.
public struct OCRThrottle: Sendable {
    /// At most one OCR per 15 s per window. M0 ran it every 3 s and failed the
    /// CPU gate (17.65% vs < 5%).
    public static let minInterval: TimeInterval = 15

    struct Entry: Sendable {
        var lastFingerprint: String?
        var lastRunAt: Double
    }

    private var entries: [UInt32: Entry] = [:]

    public init() {}

    public func isDue(window: UInt32, now: Double) -> Bool {
        guard let e = entries[window] else { return true }
        return now - e.lastRunAt >= Self.minInterval
    }

    /// Stamps the run time even when the fingerprint matches, so a static
    /// window is not re-screenshotted on every tick.
    public mutating func shouldRecognize(window: UInt32, fingerprint: String, now: Double) -> Bool {
        let previous = entries[window]?.lastFingerprint
        entries[window] = Entry(lastFingerprint: fingerprint, lastRunAt: now)
        return previous != fingerprint
    }
}
