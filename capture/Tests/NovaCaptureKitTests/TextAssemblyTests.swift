import Testing
@testable import NovaCaptureKit

private func frag(_ t: String, _ y: Double?) -> TextAssembly.Fragment {
    TextAssembly.Fragment(text: t, y: y)
}

@Test func tokensOnSameRowJoinIntoOneLine() {
    // The VSCodium defect: a syntax highlighter emits one node per token, all
    // on the same visual row. Joining with "\n" shredded code into one word
    // per line.
    let out = TextAssembly.assemble([
        frag("static", 100), frag("func", 100), frag("frontmostText", 100),
        frag("(", 100), frag("maxNodes", 100), frag(":", 100), frag("Int", 100),
    ])
    #expect(out == "static func frontmostText ( maxNodes : Int")
}

@Test func distinctRowsStayOnSeparateLines() {
    let out = TextAssembly.assemble([
        frag("enum", 100), frag("AXReader", 100), frag("{", 100),
        frag("static", 118), frag("func", 118),
    ])
    #expect(out == "enum AXReader {\nstatic func")
}

@Test func subPixelJitterWithinARowStillMerges() {
    // Real frames are not pixel-identical across nodes on a row.
    let out = TextAssembly.assemble([
        frag("let", 200.0), frag("x", 201.5), frag("=", 199.2), frag("1", 202.0),
    ])
    #expect(out == "let x = 1")
}

@Test func toleranceBoundaryDoesNotMergeAdjacentRows() {
    // 4.1 pt apart with the default 4.0 tolerance: different rows.
    let out = TextAssembly.assemble([frag("a", 100), frag("b", 104.1)])
    #expect(out == "a\nb")
}

@Test func multilineNodeIsPreservedAsItsOwnBlock() {
    // A textarea's AXValue holds real prose; its newlines are authoritative
    // and must not be merged into surrounding tokens.
    let out = TextAssembly.assemble([
        frag("Label", 50),
        frag("You are an assistant.\n-Be warm.\n-Be brief.", 90),
        frag("Footer", 300),
    ])
    #expect(out == "Label\nYou are an assistant.\n-Be warm.\n-Be brief.\nFooter")
}

@Test func fragmentsWithoutFramesNeverMerge() {
    // Unknown position: cannot prove same row, so keep them separate rather
    // than fabricating a line.
    let out = TextAssembly.assemble([frag("one", nil), frag("two", nil)])
    #expect(out == "one\ntwo")
}

@Test func emptyAndWhitespaceFragmentsAreDropped() {
    let out = TextAssembly.assemble([
        frag("real", 10), frag("   ", 10), frag("", 10), frag("text", 10),
    ])
    #expect(out == "real text")
}

@Test func emptyInputYieldsEmptyString() {
    #expect(TextAssembly.assemble([]) == "")
}

// MARK: - labelSupersedes

private func message(_ t: String, _ y: Double?) -> TextAssembly.Fragment {
    TextAssembly.Fragment(text: t, y: y, fromLabel: true)
}

@Test func messageLabelReplacesItsOwnText() {
    // Slack's row label carries the author the visible text leaves out.
    #expect(TextAssembly.labelSupersedes(
        "Alex: which role is missing the upload permission? 11:24 AM.",
        [frag("11:24 AM", 10), frag("which role is missing the upload permission?", 10)]))
}

@Test func paneLabelDoesNotReplaceWhatItCovers() {
    #expect(!TextAssembly.labelSupersedes(
        "Conversation with Dana Reyes",
        [frag("which role is missing the upload permission?", 10), frag("yes", 30)]))
}

@Test func messagesAtTheSameYStayOnSeparateLines() {
    // Measured 2026-09-24: Slack reports every message scrolled above the view
    // at the list's top edge, so position alone merged them into one line.
    let out = TextAssembly.assemble([
        message("Alex: checking now. 10:53 AM.", 108),
        message("Alex: can we connect once? 10:55 AM.", 108),
        frag("10:56 AM", 108), frag("View thread", 108),
    ])
    #expect(out == "Alex: checking now. 10:53 AM.\nAlex: can we connect once? 10:55 AM.\n10:56 AM View thread")
}
