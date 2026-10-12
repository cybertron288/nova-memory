import Foundation

/// Assembles AX leaf-node text back into readable lines.
///
/// Design note (measured 2026-08-21): joining every content node with "\n"
/// destroyed editor text. Syntax highlighters emit one AXStaticText node per
/// *token*, so `enum AXReader {` arrives as four separate nodes and rendered as
/// four separate lines. The extracted text was real but unreadable as prose —
/// and unusable for summarization or embedding.
///
/// Fragments carry the vertical position (`y`) of their node's frame. Nodes
/// sharing a line are joined with a space; a new line starts only when `y`
/// changes by more than `lineTolerance` points.
public enum TextAssembly {
    public struct Fragment: Equatable {
        public let text: String
        /// Vertical position of the node's frame in screen points.
        /// `nil` when the frame could not be read — such fragments never merge.
        public let y: Double?
        /// This text is a node's label that stood in for the text beneath it
        /// (`labelSupersedes`) — in a chat app, one whole message.
        public let fromLabel: Bool

        public init(text: String, y: Double?, fromLabel: Bool = false) {
            self.text = text
            self.y = y
            self.fromLabel = fromLabel
        }
    }

    /// Joins fragments into lines, merging those on the same visual row.
    ///
    /// - Parameter lineTolerance: max `y` difference still considered one line.
    ///   Defaults to 4 pt — below single-line leading at any normal font size,
    ///   so distinct rows never merge, while sub-pixel jitter within a row does.
    public static func assemble(_ fragments: [Fragment], lineTolerance: Double = 4.0) -> String {
        var lines: [String] = []
        var current: [String] = []
        var currentY: Double?

        func flush() {
            guard !current.isEmpty else { return }
            lines.append(current.joined(separator: " "))
            current = []
        }

        for f in fragments {
            let text = f.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }

            // Text that already spans lines is its own block: it came from a
            // single node holding real prose (a textarea value, a message body),
            // so its internal structure is authoritative.
            // A label that stood in for a node is a whole message, never part
            // of a row. Slack reports every message scrolled above the view at
            // the same y (the list's top edge, measured 2026-09-24), so by
            // position alone a morning's messages joined into one line and
            // the user's promise inside it was never read as its own message.
            if text.contains("\n") || f.fromLabel {
                flush()
                lines.append(text)
                currentY = nil
                continue
            }

            if let y = f.y, let cy = currentY, abs(y - cy) <= lineTolerance {
                current.append(text)   // same visual row — join with a space
            } else {
                flush()
                current = [text]
                currentY = f.y
            }
        }
        flush()

        return lines.joined(separator: "\n")
    }

    /// Whether a container's accessibility label should stand in for the text
    /// of the nodes beneath it.
    ///
    /// Chat apps label each message row for VoiceOver with the sender and
    /// time the visible text leaves out. Slack, measured 2026-09-23: the
    /// visible text of a DM was "11:24 AM which role is missing the upload
    /// permission?" with no author on any grouped message, while the row's
    /// label read "Alex: which role is missing the upload permission?
    /// 11:24 AM." Without the author, loop extraction could not tell who asked
    /// and filed the user's own question as one they owed an answer to.
    ///
    /// The label wins only when it is a restatement of what it covers: it
    /// contains the longest fragment under it, and most of that subtree's
    /// text. A pane labelled "Conversation with Dana Reyes" covers far more
    /// than it says, and fails both tests.
    public static func labelSupersedes(_ label: String, _ fragments: [Fragment]) -> Bool {
        func norm(_ s: String) -> String {
            s.lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " ")
        }
        let texts = fragments.map { norm($0.text) }.filter { !$0.isEmpty }
        guard let longest = texts.max(by: { $0.count < $1.count }), longest.count >= 2 else { return false }
        let l = norm(label)
        guard l.count > longest.count, l.contains(longest) else { return false }
        let total = texts.reduce(0) { $0 + $1.count }
        let covered = texts.filter { l.contains($0) }.reduce(0) { $0 + $1.count }
        return Double(covered) >= 0.6 * Double(total)
    }
}
