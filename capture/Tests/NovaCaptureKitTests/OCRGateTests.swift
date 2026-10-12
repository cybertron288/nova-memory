import Testing
@testable import NovaCaptureKit

// Numbers below are the measured values from the 2026-08-21 run, so these
// tests pin the gate to the cases that actually occurred.

@Test func canvasEditorFallsBackToOCRDespiteClearingCharFloor() {
    // VSCodium: 237 content vs 4787 chrome. Above the 200-char floor, so the
    // old gate suppressed OCR — but the "content" was a file-tree fragment.
    let r = OCRGate.decide(hasAX: true, foundRegion: true,
                           contentChars: 237, chromeChars: 4787)
    #expect(r == .contentSwampedByChrome)
}

@Test func realArticleDoesNotTriggerOCR() {
    // Chrome: 19_719 content vs 2296 chrome — a genuine extraction.
    let r = OCRGate.decide(hasAX: true, foundRegion: true,
                           contentChars: 19_719, chromeChars: 2296)
    #expect(r == .none)
}

@Test func electronMessagePaneDoesNotTriggerOCR() {
    // Slack, focus-selected message pane.
    let r = OCRGate.decide(hasAX: true, foundRegion: true,
                           contentChars: 901, chromeChars: 1200)
    #expect(r == .none)
}

@Test func terminalWithNoAXTextFallsBackToOCR() {
    // Ghostty: content 0, chrome 30.
    let r = OCRGate.decide(hasAX: true, foundRegion: false,
                           contentChars: 0, chromeChars: 30)
    #expect(r == .noContentRole)
}

@Test func regionFoundButEmptyIsDistinguishedFromNoRegion() {
    // Different causes need different labels: one is a scoring miss, the other
    // is an app that exposes no document pane at all.
    #expect(OCRGate.decide(hasAX: true, foundRegion: true,
                           contentChars: 10, chromeChars: 500) == .contentRoleEmpty)
    #expect(OCRGate.decide(hasAX: true, foundRegion: false,
                           contentChars: 10, chromeChars: 500) == .noContentRole)
}

@Test func missingAXTreeIsItsOwnReason() {
    #expect(OCRGate.decide(hasAX: false, foundRegion: false,
                           contentChars: 0, chromeChars: 0) == .noAX)
}

@Test func contentWithNoChromeIsAccepted() {
    // A full-screen document viewer: ratio must not divide by zero or reject.
    let r = OCRGate.decide(hasAX: true, foundRegion: true,
                           contentChars: 5000, chromeChars: 0)
    #expect(r == .none)
}

@Test func ratioBoundaryIsInclusiveAtThreshold() {
    // Exactly 25% content must pass; just under must not.
    #expect(OCRGate.decide(hasAX: true, foundRegion: true,
                           contentChars: 250, chromeChars: 750) == .none)
    #expect(OCRGate.decide(hasAX: true, foundRegion: true,
                           contentChars: 249, chromeChars: 751) == .contentSwampedByChrome)
}
