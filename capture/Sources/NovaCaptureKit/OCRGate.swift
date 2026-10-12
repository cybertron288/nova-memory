import Foundation

/// Decides whether OCR must run to recover content the AX tree did not provide.
///
/// Design note (measured 2026-08-21): a fixed character floor is not enough.
/// VSCodium returned 237 content chars against 4787 chars of chrome — above the
/// 200-char floor, so OCR stayed suppressed, yet the "content" was a file-tree
/// fragment and two visible code lines. Editors that render text to a canvas
/// (Monaco and friends) expose only a small focused region to accessibility, so
/// there is no deeper subtree to reach: OCR is the only path to their content.
///
/// The ratio test catches exactly that shape — a window whose chrome dwarfs its
/// content is a window whose content was not really extracted.
public enum OCRGate {
    /// Below this, content is too thin to be a document regardless of ratio.
    public static let minContentChars = 200

    /// Content must be at least this fraction of total extracted text. At 4787
    /// chrome chars, VSCodium's 237 content chars scores 0.047 — far under.
    /// Chrome's 19_719 against 2296 scores 0.896, comfortably over.
    public static let minContentShare = 0.25

    /// Why OCR ran, or `none`. Values are recorded per sample for diagnostics.
    public enum Reason: String {
        case none
        case noAX = "no-ax"
        case noContentRole = "no-content-role"
        case contentRoleEmpty = "content-role-empty"
        /// Content present but swamped by chrome — canvas-rendered editors.
        case contentSwampedByChrome = "content-swamped"
    }

    /// - Parameters:
    ///   - hasAX: did the AX tree yield a window at all?
    ///   - foundRegion: did region scoring identify a document pane?
    public static func decide(hasAX: Bool, foundRegion: Bool,
                              contentChars: Int, chromeChars: Int) -> Reason {
        guard hasAX else { return .noAX }

        if contentChars < minContentChars {
            return foundRegion ? .contentRoleEmpty : .noContentRole
        }

        let total = contentChars + chromeChars
        if total > 0, Double(contentChars) / Double(total) < minContentShare {
            return .contentSwampedByChrome
        }

        return .none
    }
}
