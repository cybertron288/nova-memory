import Testing
@testable import NovaCaptureKit

@Test func stripsOwnSampleLines() {
    let captured = """
    $ .build/debug/nova-capture
    {"axChromeChars":24,"sawContentRole":true,"ocrReason":"none","axMs":116.4,"app":"Ghostty","axContentChars":19461}
    $ swift build
    """
    #expect(SelfOutput.strip(captured) == "$ .build/debug/nova-capture\n$ swift build")
}

@Test func keepsUnrelatedJsonTheUserIsLookingAt() {
    // A user reading an API response must not have it silently dropped.
    let line = #"{"name":"nova","version":"1.0","ocrReason":"none"}"#
    #expect(SelfOutput.strip(line) == line)
}

@Test func keepsOrdinaryProse() {
    let text = "The ocrReason field records why OCR ran.\nSecond line."
    #expect(SelfOutput.strip(text) == text)
}

@Test func keepsNonJsonLinesMentioningOurKeys() {
    let text = "axContentChars sawContentRole ocrReason axChromeChars"
    #expect(SelfOutput.strip(text) == text)
}

@Test func stripsMultipleSampleLinesAndPreservesOrder() {
    let a = #"{"axContentChars":1,"axChromeChars":2,"sawContentRole":true,"ocrReason":"none"}"#
    let b = #"{"axContentChars":3,"axChromeChars":4,"sawContentRole":false,"ocrReason":"no-ax"}"#
    #expect(SelfOutput.strip("before\n\(a)\nmiddle\n\(b)\nafter")
            == "before\nmiddle\nafter")
}

@Test func emptyTextIsUnchanged() {
    #expect(SelfOutput.strip("") == "")
}
