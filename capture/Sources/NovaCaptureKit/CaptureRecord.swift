import Foundation

/// The capture → daemon wire format (spec §4.1). One JSON object per line on
/// stdout. `ts` is unix milliseconds; `url` is present only for browsers,
/// where it carries thread identity. `treeHash` hashes the whole AX tree
/// (content + chrome) — the cheap level-1 dedup gate that catches
/// chrome-only changes `contentHash` cannot see. It is present only when the
/// emitted `content` came from the AX tree unmodified: when OCR supplied the
/// payload, or `SelfOutput.strip` altered it, a tree hash would describe
/// text this record does not carry, so it is omitted rather than misleading.
public struct CaptureRecord: Codable, Sendable {
    public let ts: Int
    public let app: String
    public let bundleId: String
    public let windowTitle: String
    public let url: String?
    public let content: String
    public let contentHash: String
    public let treeHash: String?

    public init(ts: Int, app: String, bundleId: String, windowTitle: String,
                url: String?, content: String, contentHash: String, treeHash: String?) {
        self.ts = ts; self.app = app; self.bundleId = bundleId
        self.windowTitle = windowTitle; self.url = url; self.content = content
        self.contentHash = contentHash; self.treeHash = treeHash
    }
}
