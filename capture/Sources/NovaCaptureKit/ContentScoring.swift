import Foundation

/// Decides which region of a window holds document content.
///
/// Design note (measured 2026-08-21, iteration 3): neither leaf role nor
/// container membership identifies content.
///
///   - Iteration 1 keyed on role. Sidebars and nav menus are `AXStaticText`
///     too, so Slack returned its channel list as "content".
///   - Iteration 2 keyed on being inside `AXWebArea`/`AXTextArea`. Electron and
///     web apps render the *whole* window — sidebar included — inside one web
///     area, so the test admitted everything. VSCodium returned its file tree.
///
/// Both failures share a cause: tree position does not distinguish navigation
/// from document. Geometry and focus do. A sidebar is narrow and fixed; a
/// document pane dominates the window. Navigation is short labels; prose is
/// sentences. This type scores regions on those observable properties, with no
/// reference to app identity — the extractor must stay generic across macOS.
public enum ContentScoring {
    /// A candidate text-bearing region of the window.
    public struct Region {
        public let id: Int
        /// Frame in screen points.
        public let frame: Rect
        /// Text fragments collected inside this region.
        public let texts: [String]
        /// Does this region contain (or equal) the focused element?
        public let containsFocus: Bool

        public init(id: Int, frame: Rect, texts: [String], containsFocus: Bool) {
            self.id = id
            self.frame = frame
            self.texts = texts
            self.containsFocus = containsFocus
        }
    }

    public struct Rect: Equatable {
        public let x, y, width, height: Double
        public init(x: Double, y: Double, width: Double, height: Double) {
            self.x = x; self.y = y; self.width = width; self.height = height
        }
        public var area: Double { max(0, width) * max(0, height) }
    }

    /// Fraction of a window's area a region must cover to read as a document
    /// pane rather than a sidebar or toolbar. Sidebars in the measured apps sat
    /// well under 20% of window area; document panes well over.
    public static let minAreaFraction = 0.18

    /// Mean words-per-fragment below which text reads as navigation labels
    /// ("Home", "DMs", "Threads") rather than prose.
    public static let minMeanWords = 2.2

    /// Picks the content region, or nil when the window has no document pane.
    ///
    /// Focus wins outright when the focused region carries text: the user's
    /// caret is the strongest available signal of where content is. Otherwise
    /// the largest region that passes the area and density tests wins.
    /// Roles that are part of the text flow when nested in a pane: a bulleted
    /// list in a message, a table in an article or a diff.
    static let inlineRoles: Set<String> = ["AXList", "AXTable"]

    /// Whether a nested list or table spanning at least this share of its
    /// enclosing pane's width reads as part of that pane. Measured 2026-09-23
    /// against a 1680-wide pane: Slack's message column 67%, GitHub's centred
    /// article column 46%, Slack's channel sidebar 23%.
    static let inlineWidthFraction = 0.35

    /// Whether a node that could root a candidate region is instead inline
    /// content of the region enclosing it.
    ///
    /// Measured 2026-09-23: Slack renders a bulleted message as an `AXList`
    /// inside the conversation's web area. Past the 5% area floor it became its
    /// own candidate, lost to the web area it sits in, and its text was filed
    /// as chrome, so a five-item to-do list vanished from the capture while a
    /// three-item one (under the floor) survived. Tables and lists in GitHub
    /// pages went the same way. A navigation list is narrow beside the pane; a
    /// list that is part of the text spans the pane's text column, which on a
    /// web page is often centred and well short of the pane's full width.
    public static func isInline(role: String, frame: Rect, within parent: Rect?) -> Bool {
        guard inlineRoles.contains(role), let parent, parent.width > 0 else { return false }
        return frame.width >= inlineWidthFraction * parent.width
    }

    public static func selectContentRegion(_ regions: [Region], windowArea: Double) -> Region? {
        let withText = regions.filter { !joined($0).isEmpty }
        guard !withText.isEmpty else { return nil }

        // Focus is marked on every enclosing pane, so several regions can carry
        // it. Take the *smallest* — the innermost pane holding the caret. Taking
        // the first (outermost) would hand back the page-wide web area, which is
        // exactly the sidebar-plus-document blob this scoring exists to split.
        let focused = withText.filter(\.containsFocus)
        if !focused.isEmpty {
            return focused.min { $0.frame.area < $1.frame.area }
        }

        let qualified = withText.filter { r in
            let bigEnough = windowArea <= 0 || (r.frame.area / windowArea) >= minAreaFraction
            return bigEnough && looksLikeProse(r.texts)
        }

        return qualified.max { $0.frame.area < $1.frame.area }
    }

    /// True when fragments read as sentences rather than navigation labels.
    ///
    /// Two independent signals, either sufficient: mean words per fragment, and
    /// the presence of sentence-terminating punctuation. Code and log output
    /// score low on words-per-line but carry punctuation, so both are needed.
    public static func looksLikeProse(_ texts: [String]) -> Bool {
        let frags = texts
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !frags.isEmpty else { return false }

        // A single long fragment is a document body read from one node.
        if frags.count == 1, frags[0].count >= 200 { return true }

        let words = frags.reduce(0) { $0 + $1.split(separator: " ").count }
        let meanWords = Double(words) / Double(frags.count)
        if meanWords >= minMeanWords { return true }

        let terminated = frags.filter { f in
            f.hasSuffix(".") || f.hasSuffix("?") || f.hasSuffix("!")
                || f.hasSuffix(";") || f.hasSuffix("{") || f.hasSuffix("}")
        }
        return Double(terminated.count) / Double(frags.count) >= 0.25
    }

    static func joined(_ r: Region) -> String {
        r.texts.joined().trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
