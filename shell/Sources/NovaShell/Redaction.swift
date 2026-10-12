/// The redaction aesthetic (design spec §1.3), applied to captured text.
///
/// Memories are read off the user's screen, so they contain whatever was on
/// it: email addresses, tokens, account numbers. The panel floats over
/// whatever the user is doing — including calls and shared screens — so those
/// spans are replaced by solid ink blocks rather than shown.
///
/// Ink, never blur: blur implies recoverable, ink implies withheld. The
/// structure of the fact survives, which is the whole idea — you can still see
/// that a fact is about an email address without the address being on screen.
import Foundation

enum Redaction {
    /// Spans worth withholding, in the order they are applied.
    ///
    /// Deliberately conservative. Over-redaction makes the list unreadable and
    /// the design spec caps it at roughly 40% of a preview; these patterns
    /// target values that are sensitive on sight rather than anything that
    /// merely looks like data.
    private static let patterns: [NSRegularExpression] = {
        let sources = [
            // Email addresses.
            #"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#,
            // Bearer tokens, API keys, long opaque identifiers.
            #"\b[A-Za-z0-9_-]{32,}\b"#,
            // Phone numbers, card-like and OTP-like digit runs.
            #"\+?\d[\d ()-]{7,}\d"#,
            #"\b\d{4,}\b"#,
            // Anything that reads as a password field. The value runs to the
            // end of the line: "Password (for x@y.com): hunter2" put an email
            // between the label and the secret, and a pattern anchored on
            // `label: value` matched the email instead and left the password
            // in plain sight.
            #"(?i)\b(password|passwd|pwd|secret|token|api[_ -]?key|credential)\b.*"#,
        ]
        return sources.compactMap { try? NSRegularExpression(pattern: $0) }
    }()

    /// Splits text into runs, marking which are withheld. The view renders a
    /// withheld run as an ink block sized to the text it replaces, so the
    /// line keeps its shape.
    static func runs(in text: String) -> [(text: String, redacted: Bool)] {
        var ranges: [NSRange] = []
        let whole = NSRange(text.startIndex..., in: text)
        for pattern in patterns {
            for m in pattern.matches(in: text, range: whole) { ranges.append(m.range) }
        }
        guard !ranges.isEmpty else { return [(text, false)] }

        // Merge overlaps — the patterns deliberately overlap (a long digit run
        // inside a phone number), and nested blocks would render twice.
        ranges.sort { $0.location < $1.location }
        var merged: [NSRange] = [ranges[0]]
        for r in ranges.dropFirst() {
            let last = merged[merged.count - 1]
            if r.location <= last.location + last.length {
                let end = max(last.location + last.length, r.location + r.length)
                merged[merged.count - 1] = NSRange(location: last.location, length: end - last.location)
            } else {
                merged.append(r)
            }
        }

        var out: [(String, Bool)] = []
        var cursor = 0
        for r in merged {
            if r.location > cursor, let pre = Range(NSRange(location: cursor, length: r.location - cursor), in: text) {
                out.append((String(text[pre]), false))
            }
            if let hit = Range(r, in: text) { out.append((String(text[hit]), true)) }
            cursor = r.location + r.length
        }
        if cursor < (text as NSString).length,
           let tail = Range(NSRange(location: cursor, length: (text as NSString).length - cursor), in: text) {
            out.append((String(text[tail]), false))
        }
        return out
    }
}
