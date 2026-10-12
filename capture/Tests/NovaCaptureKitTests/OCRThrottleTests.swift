import Testing
@testable import NovaCaptureKit

@Test func firstSampleOfAWindowIsDue() {
    let t = OCRThrottle()
    #expect(t.isDue(window: 7, now: 1000) == true)
}

@Test func windowIsNotDueWithinTheInterval() {
    var t = OCRThrottle()
    _ = t.shouldRecognize(window: 7, fingerprint: "a", now: 1000)
    #expect(t.isDue(window: 7, now: 1014.9) == false)
}

@Test func windowIsDueOnceTheIntervalHasPassed() {
    var t = OCRThrottle()
    _ = t.shouldRecognize(window: 7, fingerprint: "a", now: 1000)
    #expect(t.isDue(window: 7, now: 1015) == true)
}

@Test func unchangedPixelsAreNotRecognizedButStillStampTheRun() {
    var t = OCRThrottle()
    #expect(t.shouldRecognize(window: 7, fingerprint: "a", now: 1000) == true)
    #expect(t.shouldRecognize(window: 7, fingerprint: "a", now: 1015) == false)
    #expect(t.isDue(window: 7, now: 1020) == false)
}

@Test func changedPixelsAreRecognized() {
    var t = OCRThrottle()
    _ = t.shouldRecognize(window: 7, fingerprint: "a", now: 1000)
    #expect(t.shouldRecognize(window: 7, fingerprint: "b", now: 1015) == true)
}

@Test func windowsAreThrottledIndependently() {
    var t = OCRThrottle()
    _ = t.shouldRecognize(window: 7, fingerprint: "a", now: 1000)
    #expect(t.isDue(window: 8, now: 1001) == true)
    #expect(t.shouldRecognize(window: 8, fingerprint: "a", now: 1001) == true)
    #expect(t.isDue(window: 7, now: 1001) == false)
}
