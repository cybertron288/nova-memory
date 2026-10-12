import Foundation

/// Removes the harness's own JSON output from captured text.
///
/// Measured 2026-08-21: Ghostty exposes its entire scrollback via AX, which
/// included the `nova-capture` JSON lines being printed into that same terminal.
/// The capture was reading its own output — inflating character counts and
/// feeding novelty detection with self-generated churn.
///
/// M1 carries the same concern more broadly: Nova must not capture its own
/// windows, logs, or menu-bar surfaces.
public enum SelfOutput {
    /// Drops lines that look like a `Sample` record emitted by this harness.
    public static func strip(_ text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !isOwnSampleLine($0) }
            .joined(separator: "\n")
    }

    /// A line is ours if it is a JSON object carrying this harness's own
    /// diagnostic keys. Requiring several keys together keeps the test from
    /// matching unrelated JSON the user happens to be looking at.
    static func isOwnSampleLine(_ line: Substring) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard t.hasPrefix("{"), t.hasSuffix("}") else { return false }
        let markers = ["\"axContentChars\"", "\"axChromeChars\"",
                       "\"sawContentRole\"", "\"ocrReason\""]
        return markers.filter(t.contains).count >= 3
    }
}
