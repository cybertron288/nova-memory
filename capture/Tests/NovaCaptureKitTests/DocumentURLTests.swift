import Testing
@testable import NovaCaptureKit

/// The URL a capture records as provenance.
///
/// The tree walk itself needs a live browser and is verified by measurement
/// (2026-09-22: Chrome resolves in ~5ms at depth 1, Slack correctly returns
/// nil). What is unit-testable — and what would quietly degrade provenance if
/// it regressed — is which values are allowed through at all.
@Test func acceptsWebAddresses() {
    #expect(URLProvenance.isWebURL("https://chatgpt.com/c/abc"))
    #expect(URLProvenance.isWebURL("http://localhost:3000/app"))
}

@Test func rejectsNonWebSchemes() {
    // All real AXURL values, none of which a user would recognise as the place
    // a loop came from.
    #expect(!URLProvenance.isWebURL("chrome://newtab/"))
    #expect(!URLProvenance.isWebURL("file:///Users/alex/notes.md"))
    #expect(!URLProvenance.isWebURL("about:blank"))
    #expect(!URLProvenance.isWebURL(""))
}
