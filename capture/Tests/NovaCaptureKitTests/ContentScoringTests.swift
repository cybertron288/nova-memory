import Testing
@testable import NovaCaptureKit

private typealias Rect = ContentScoring.Rect
private typealias Region = ContentScoring.Region

// Fixtures below are verbatim from the 2026-08-21 measurement dumps, so these
// tests fail if the heuristic regresses on the cases that actually broke it.

private let slackSidebar = [
    "Home", "DMs", "Activity", "Files", "Later", "More", "Threads", "Huddles",
    "Drafts & sent 19", "Directories", "team-templates",
    "web-test-reports", "ios-releases", "android-releases",
    "test-chatbot", "z-deployment-notifs", "z-deployment-requests",
]

private let vscodiumTree = [
    "EXPLORER", "SCREEN", ".build", "Sources", "NovaCaptureKit", "Novelty.swift",
    "SelfOutput.swift", "TextAssembly.swift", "nova-capture", "AXReader.swift",
    "main.swift", "OCR.swift", "Tests", "Package.swift", "OUTLINE", "TIMELINE",
]

private let slackMessages = [
    "Riley: can you push the release branch when the tests go green?",
    "Taylor: done, it is on staging now. deploy notes are in the thread.",
    "Jamie: thanks — I will review the migration before we cut over.",
]

private let editorCode = [
    "static func frontmostText(maxNodes: Int = 12_000) -> Extraction? {",
    "guard let front = NSWorkspace.shared.frontmostApplication else { return nil }",
    "var content: [String] = []",
]

@Test func sidebarLosesToDocumentPaneByArea() {
    // The Slack failure: sidebar and message pane both sit inside one AXWebArea,
    // so tree position cannot separate them. Area and density can.
    let sidebar = Region(id: 1, frame: Rect(x: 0, y: 0, width: 220, height: 900),
                         texts: slackSidebar, containsFocus: false)
    let messages = Region(id: 2, frame: Rect(x: 220, y: 0, width: 1180, height: 900),
                          texts: slackMessages, containsFocus: false)
    let pick = ContentScoring.selectContentRegion([sidebar, messages],
                                                  windowArea: 1400 * 900)
    #expect(pick?.id == 2)
}

@Test func fileTreeLosesToEditorPane() {
    // The VSCodium failure, same shape.
    let tree = Region(id: 1, frame: Rect(x: 0, y: 0, width: 260, height: 900),
                      texts: vscodiumTree, containsFocus: false)
    let editor = Region(id: 2, frame: Rect(x: 260, y: 0, width: 1140, height: 900),
                        texts: editorCode, containsFocus: false)
    let pick = ContentScoring.selectContentRegion([tree, editor],
                                                  windowArea: 1400 * 900)
    #expect(pick?.id == 2)
}

@Test func focusedRegionWinsEvenWhenSmall() {
    // A user typing in a narrow compose box is working there; the caret is the
    // strongest signal we have, so it outranks a larger passive pane.
    let big = Region(id: 1, frame: Rect(x: 0, y: 0, width: 1200, height: 800),
                     texts: slackMessages, containsFocus: false)
    let compose = Region(id: 2, frame: Rect(x: 0, y: 800, width: 1200, height: 90),
                         texts: ["Drafting a reply about the migration plan."],
                         containsFocus: true)
    let pick = ContentScoring.selectContentRegion([big, compose],
                                                  windowArea: 1200 * 900)
    #expect(pick?.id == 2)
}

@Test func focusedRegionWithoutTextIsSkipped() {
    // Focus often sits on a search field or button. Empty focus must not
    // suppress the real document pane.
    let empty = Region(id: 1, frame: Rect(x: 0, y: 0, width: 300, height: 40),
                       texts: [], containsFocus: true)
    let body = Region(id: 2, frame: Rect(x: 0, y: 40, width: 1200, height: 860),
                      texts: slackMessages, containsFocus: false)
    let pick = ContentScoring.selectContentRegion([empty, body],
                                                  windowArea: 1200 * 900)
    #expect(pick?.id == 2)
}

@Test func windowOfOnlyNavigationYieldsNoContent() {
    // Finder: chrome-only window. Must return nil so OCR takes over rather
    // than capturing a file listing as if it were a document.
    let sidebar = Region(id: 1, frame: Rect(x: 0, y: 0, width: 220, height: 900),
                         texts: slackSidebar, containsFocus: false)
    let toolbar = Region(id: 2, frame: Rect(x: 0, y: 0, width: 1400, height: 52),
                         texts: ["Back", "Forward", "View", "Group", "Share"],
                         containsFocus: false)
    #expect(ContentScoring.selectContentRegion([sidebar, toolbar],
                                               windowArea: 1400 * 900) == nil)
}

@Test func emptyRegionListYieldsNil() {
    #expect(ContentScoring.selectContentRegion([], windowArea: 1000) == nil)
}

@Test func navigationLabelsAreNotProse() {
    #expect(ContentScoring.looksLikeProse(slackSidebar) == false)
    #expect(ContentScoring.looksLikeProse(vscodiumTree) == false)
}

@Test func sentencesAreProse() {
    #expect(ContentScoring.looksLikeProse(slackMessages) == true)
}

@Test func codeIsProseViaPunctuation() {
    // Code has few words per line but heavy terminating punctuation. Without
    // the punctuation signal, editors would be classified as navigation.
    #expect(ContentScoring.looksLikeProse(editorCode) == true)
}

@Test func singleLongFragmentIsProse() {
    // A textarea read from one AXValue node — the Chrome playground case.
    let body = String(repeating: "The agent should answer clearly. ", count: 8)
    #expect(ContentScoring.looksLikeProse([body]) == true)
}

@Test func smallDocumentPaneStillLosesToNothingWhenBelowAreaFloor() {
    // A prose region too small to be a document pane (a tooltip, a status bar)
    // must not be promoted to content.
    let tip = Region(id: 1, frame: Rect(x: 0, y: 0, width: 200, height: 40),
                     texts: ["Saved to your drafts folder."], containsFocus: false)
    #expect(ContentScoring.selectContentRegion([tip], windowArea: 1400 * 900) == nil)
}

@Test func innermostFocusedPaneWinsOverEnclosingOne() {
    // Focus is marked on every enclosing pane, so a web app yields both the
    // page-wide area and the editor inside it. The inner one is what the user
    // is working in; the outer is sidebar + document blended together.
    let page = Region(id: 1, frame: Rect(x: 0, y: 0, width: 1400, height: 900),
                      texts: slackSidebar + slackMessages, containsFocus: true)
    let composer = Region(id: 2, frame: Rect(x: 300, y: 700, width: 1000, height: 180),
                          texts: ["Replying about the migration plan now."],
                          containsFocus: true)
    let pick = ContentScoring.selectContentRegion([page, composer],
                                                  windowArea: 1400 * 900)
    #expect(pick?.id == 2)
}

// MARK: - Inline lists and tables

@Test func aWideListInsideAPaneIsPartOfIt() {
    // Slack, 2026-09-23: a bulleted message inside the 1680-wide web area.
    let pane = Rect(x: 0, y: 0, width: 1680, height: 1050)
    #expect(ContentScoring.isInline(role: "AXList", frame: Rect(x: 533, y: 782, width: 1125, height: 100), within: pane))
    #expect(ContentScoring.isInline(role: "AXTable", frame: Rect(x: 346, y: 847, width: 1301, height: 203), within: pane))
    // GitHub's centred article column.
    #expect(ContentScoring.isInline(role: "AXTable", frame: Rect(x: 305, y: 572, width: 782, height: 201), within: pane))
}

@Test func aNarrowListBesideThePaneStaysItsOwnRegion() {
    let pane = Rect(x: 0, y: 0, width: 1680, height: 1050)
    #expect(!ContentScoring.isInline(role: "AXList", frame: Rect(x: 64, y: 117, width: 386, height: 929), within: pane))
}

@Test func onlyListsAndTablesNestedInAPaneAreInline() {
    let pane = Rect(x: 0, y: 0, width: 1680, height: 1050)
    let wide = Rect(x: 0, y: 0, width: 1600, height: 400)
    #expect(!ContentScoring.isInline(role: "AXOutline", frame: wide, within: pane))
    #expect(!ContentScoring.isInline(role: "AXScrollArea", frame: wide, within: pane))
    #expect(!ContentScoring.isInline(role: "AXList", frame: wide, within: nil))
}
