import Testing
import Foundation
@testable import NovaCaptureKit

@Test func captureRecordEncodesWireFormat() throws {
    let r = CaptureRecord(
        ts: 1787331916548, app: "Google Chrome",
        bundleId: "com.google.Chrome",
        windowTitle: "Rust ownership",
        url: "https://doc.rust-lang.org/book/ch04-01.html",
        content: "Ownership is a set of rules.",
        contentHash: "sha256:abc", treeHash: "sha256:def")
    let data = try JSONEncoder().encode(r)
    let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    #expect(json["ts"] as! Int == 1787331916548)
    #expect(json["url"] as! String == "https://doc.rust-lang.org/book/ch04-01.html")
    #expect(json["content"] as! String == "Ownership is a set of rules.")
}

@Test func captureRecordOmitsUrlWhenAbsent() throws {
    let r = CaptureRecord(
        ts: 1, app: "TextEdit", bundleId: "com.apple.TextEdit",
        windowTitle: "notes.txt", url: nil,
        content: "hello", contentHash: "sha256:a", treeHash: "sha256:b")
    let json = try JSONSerialization.jsonObject(
        with: try JSONEncoder().encode(r)) as! [String: Any]
    #expect(json["url"] == nil)
}

@Test func captureRecordOmitsTreeHashWhenAbsent() throws {
    let r = CaptureRecord(
        ts: 1, app: "TextEdit", bundleId: "com.apple.TextEdit",
        windowTitle: "notes.txt", url: nil,
        content: "hello", contentHash: "sha256:a", treeHash: nil)
    let json = try JSONSerialization.jsonObject(
        with: try JSONEncoder().encode(r)) as! [String: Any]
    #expect(json["treeHash"] == nil)
}
