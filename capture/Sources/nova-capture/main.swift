import AppKit
import Foundation
import NovaCaptureKit

// Samples the frontmost window every 3 s: AX first, OCR fallback (spec Flow 2).
// Prints one JSON line per sample; metrics only — full text goes to stderr
// only when --dump is passed (never redirect stderr into a committed file).
let dump = CommandLine.arguments.contains("--dump")
// --no-ocr measures AX alone, so the CPU gate can be evaluated without the
// burst cost the OCR fallback adds.
let noOCR = CommandLine.arguments.contains("--no-ocr")
// --emit prints CaptureRecord lines for the daemon (spec §4.1) instead of the
// diagnostics Sample used for spike measurement. Both remain available: the
// diagnostics mode is how the CPU and content-quality gates are re-measured.
let emit = CommandLine.arguments.contains("--emit")
// --app <name> reads that app's focused window instead of the frontmost one.
// Measurement-only: invoking --dump from a shell makes the terminal frontmost,
// so every sample came back as the terminal and no other app was measurable
// from a shell. Naming the target reads that app while the shell keeps focus;
// --delay covers the opposite case, where the target must be frontmost.
let targetApp: String? = CommandLine.arguments.firstIndex(of: "--app").flatMap { i in
    let next = i + 1
    guard next < CommandLine.arguments.count else { return nil }
    let value = CommandLine.arguments[next]
    return value.hasPrefix("--") ? nil : value
}
if CommandLine.arguments.contains("--app"), targetApp == nil {
    FileHandle.standardError.write("[capture] --app needs a name, e.g. --app Chrome\n".data(using: .utf8)!)
    exit(2)
}
// --app is diagnostics-only and must never reach the daemon wire. Two reasons,
// either sufficient:
//
//   1. Consent. Sampling the frontmost window means Nova reads what the user
//      chose to put in front of them. A named background app reads something
//      they may have forgotten is open — the wrong direction to widen while
//      credentials still reach the providers unfiltered (docs D1).
//   2. Honesty of the record. --app skips the OCR fallback (below), so records
//      from this path would be AX-only with nothing on the record saying why.
//      An app whose content needs OCR would emit thin captures that look
//      complete.
//
// Refusing beats warning: an --emit run is a pipe into the store, so a warning
// on stderr would scroll past while bad records accumulated.
if targetApp != nil && emit {
    FileHandle.standardError.write(
        "[capture] --app is diagnostics-only; refusing to --emit a non-frontmost window\n"
            .data(using: .utf8)!)
    exit(2)
}
// --delay <seconds> waits before the first sample, so the operator can bring a
// window forward after launching from a shell. This is how a frontmost read of
// another app is measured at all: without it the terminal is always in front.
let startDelay: Double = CommandLine.arguments.firstIndex(of: "--delay").flatMap { i in
    let next = i + 1
    guard next < CommandLine.arguments.count else { return nil }
    return Double(CommandLine.arguments[next])
} ?? 0
if CommandLine.arguments.contains("--delay"), startDelay <= 0 {
    FileHandle.standardError.write("[capture] --delay needs seconds, e.g. --delay 5\n".data(using: .utf8)!)
    exit(2)
}
// --regions prints the candidate regions scoring chose between (diagnostics).
AXReader.dumpRegions = CommandLine.arguments.contains("--regions")
var lastTextByApp: [String: String] = [:]

// Suppression accounting for --emit (silent-failure rule): an all-suppressed
// run must be distinguishable from a broken-AX run, so counts are flushed to
// stderr on a rolling cadence rather than left to accumulate invisibly.
var suppressedTotal = 0
var suppressedByReason: [String: Int] = [:]
let suppressionReportInterval = 20

@MainActor
func recordSuppression(reason: String) {
    suppressedTotal += 1
    suppressedByReason[reason, default: 0] += 1
    guard suppressedTotal % suppressionReportInterval == 0 else { return }
    let breakdown = suppressedByReason
        .sorted { $0.key < $1.key }
        .map { "\($0.key)=\($0.value)" }
        .joined(separator: " ")
    let line = "[capture] suppressed \(suppressedTotal) (\(breakdown))\n"
    FileHandle.standardError.write(line.data(using: .utf8)!)
}

/// Identity of the window whose text a record carries.
struct Source {
    let app: String
    let bundleId: String
    let windowTitle: String
    let url: String?
}

let ocrWorker = OCRWorker()
var seenOCRErrors: Set<String> = []

struct Sample: Codable {
    let ts: Double; let app: String
    let axChars: Int; let ocrChars: Int
    let axMs: Double; let ocrMs: Double
    let novel: Bool
    // Diagnostics added 2026-08-13 after measurement showed axChars was
    // counting UI chrome, so a high count hid the absence of real content.
    let axContentChars: Int   // text from content-bearing roles only
    let axChromeChars: Int    // control labels, kept out of the capture payload
    let axDepth: Int          // deepest node reached (old limit of 25 was too shallow)
    let axNodes: Int
    let sawContentRole: Bool  // did the walk reach a document/web-area subtree?
    let ocrReason: String     // why OCR ran, or "none"
    let basis: String         // how the content region was chosen (iteration 3)
}

func now() -> Double { Date().timeIntervalSince1970 }

// Bootstrap the GUI connection: NSApplication must exist before any
// CoreGraphics / ScreenCaptureKit call, or CGS_REQUIRE_INIT aborts.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)   // menu-bar-style: no Dock icon, no window

// Under --emit, exit with the daemon. A daemon killed outright (SIGKILL, a
// crash) never gets to stop its child, and a capture that only dies of
// SIGPIPE on its next write can sit for minutes — reparented to launchd,
// walking the AX tree, alongside the replacement the shell's supervisor has
// already started. kqueue reports the parent's exit the moment it happens.
let parentWatch: DispatchSourceProcess? = emit
    ? DispatchSource.makeProcessSource(identifier: getppid(), eventMask: .exit, queue: .main)
    : nil
parentWatch?.setEventHandler { exit(0) }
parentWatch?.resume()

Task {
    if startDelay > 0 {
        FileHandle.standardError.write(
            "[capture] waiting \(startDelay)s before first sample — bring the target window forward\n"
                .data(using: .utf8)!)
        try await Task.sleep(for: .seconds(startDelay))
    }
    while true {
        let t0 = Date()
        let ax = targetApp.map { AXReader.text(ofAppNamed: $0) } ?? AXReader.frontmostText()
        let axMs = Date().timeIntervalSince(t0) * 1000
        // A named target that is not running is a measurement error, not an
        // empty capture: reporting it as 0 chars would read as "the app exposes
        // no content" and silently invalidate the run.
        if let targetApp, ax == nil {
            FileHandle.standardError.write(
                "[capture] no running app matches '\(targetApp)'\n".data(using: .utf8)!)
        }

        var ocrChars = 0
        var ocrMs = 0.0
        // Only content-role text counts as captured text. Chrome labels are
        // recorded for diagnostics but never treated as the payload.
        let axText = ax?.content ?? ""
        var bestText = axText
        // Identity of whichever source won. OCR must replace all of it: AX
        // is nil for apps like Metalterm, and an empty title folds every
        // window of the app into one daemon thread.
        var source = Source(app: ax?.app ?? "unknown", bundleId: ax?.bundleId ?? "",
                            windowTitle: ax?.windowTitle ?? "", url: ax?.url)
        var ocrSkip: String?
        var withholdAX = false

        // OCR fallback decided by OCRGate: a character floor plus a
        // content-to-chrome ratio. The ratio is what catches canvas-rendered
        // editors, which expose a little focused text (clearing any floor)
        // while their actual document stays unreachable via accessibility.
        let contentChars = ax?.content.count ?? 0
        let gate = OCRGate.decide(hasAX: ax != nil,
                                  foundRegion: ax?.foundContentRole ?? false,
                                  contentChars: contentChars,
                                  chromeChars: ax?.chrome.count ?? 0).rawValue
        // Record why OCR *would* have run even when suppressed, so an AX-only
        // run still shows which apps the AX path fails to cover.
        let ocrReason = noOCR ? "suppressed:\(gate)" : gate

        // OCR captures the *frontmost* window, which under --app is a different
        // window than the one AX just read — so its text would be spliced onto
        // the target's record and could overwrite it outright (below). Skipping
        // it keeps a targeted run honestly AX-only rather than silently mixed.
        if targetApp != nil && !noOCR && gate != "none" {
            FileHandle.standardError.write(
                "[capture] --app: OCR fallback skipped (would capture the frontmost window)\n"
                    .data(using: .utf8)!)
        }
        if targetApp == nil && !noOCR && gate != "none", let w = OCR.frontWindow() {
            let t1 = Date()
            do {
                switch try await ocrWorker.recognize(w, now: now()) {
                case .text(let text):
                    ocrMs = Date().timeIntervalSince(t1) * 1000
                    ocrChars = text.count
                    if text.count > bestText.count {
                        bestText = text
                        source = Source(app: w.app, bundleId: w.bundleId,
                                        windowTitle: w.title, url: nil)
                    }
                case .skipped(let skip):
                    ocrSkip = skip.rawValue
                    withholdAX = skip.withholdsAX
                }
            } catch {
                ocrSkip = "ocr-error"
                let message = "\(error)"
                if seenOCRErrors.insert(message).inserted {
                    FileHandle.standardError.write("[capture] OCR failed: \(message)\n".data(using: .utf8)!)
                }
            }
        }
        let app = source.app

        // Drop our own JSON lines echoed back by the terminal we print into.
        // Measured 2026-08-21: Ghostty's AX blob contained this harness's
        // stdout, so the capture was reading its own output. M1 must exclude
        // Nova's own surfaces for the same reason.
        bestText = SelfOutput.strip(bestText)

        let prev = lastTextByApp[app] ?? ""
        let novel = !withholdAX && Novelty.isNovel(bestText, against: prev)
        if novel { lastTextByApp[app] = bestText }

        let s = Sample(ts: now(), app: app,
                       axChars: contentChars + (ax?.chrome.count ?? 0),
                       ocrChars: ocrChars, axMs: axMs, ocrMs: ocrMs, novel: novel,
                       axContentChars: contentChars,
                       axChromeChars: ax?.chrome.count ?? 0,
                       axDepth: ax?.maxDepthReached ?? 0,
                       axNodes: ax?.nodesVisited ?? 0,
                       sawContentRole: ax?.foundContentRole ?? false,
                       ocrReason: ocrReason,
                       basis: ax?.selectionBasis ?? "no-ax")
        // Write and flush per sample rather than using print(). When stdout is
        // a file it is block-buffered, so Ctrl-C discarded whole runs — a
        // 10-minute measurement came back as a 0-byte log. A single write()
        // per line also stops concurrent writes interleaving, which produced
        // the malformed lines seen in the 2026-08-13 run.
        if emit {
            // Only novel captures with real content reach the daemon. A
            // suppressed capture is not an error, but silently dropping every
            // one of them would make an all-suppressed run indistinguishable
            // from a broken-AX run on stdout and stderr alike — so each
            // suppression is counted and reported to stderr on a rolling
            // cadence (never stdout: that stream is the JSONL wire and must
            // stay parseable).
            if withholdAX, let ocrSkip {
                recordSuppression(reason: ocrSkip)
            } else if bestText.isEmpty {
                recordSuppression(reason: ocrSkip ?? "empty")
            } else if !novel {
                recordSuppression(reason: "not-novel")
            } else {
                // contentHash always describes the emitted payload.
                // treeHash describes the whole AX tree (content + chrome)
                // and is the cheap level-1 dedup gate that catches
                // chrome-only changes contentHash cannot see — but it is
                // only honest when bestText is exactly what AXReader
                // extracted. If OCR supplied or improved on the text, or
                // SelfOutput.strip altered it, ax?.treeHash describes a tree
                // that did not produce this record's content, so it is
                // omitted rather than shipped misleading.
                let unmodifiedFromAX = bestText == axText
                let rec = CaptureRecord(
                    ts: Int(now() * 1000), app: source.app,
                    bundleId: source.bundleId,
                    windowTitle: source.windowTitle,
                    url: source.url,
                    content: bestText,
                    contentHash: "sha256:" + Novelty.sha256(bestText),
                    treeHash: unmodifiedFromAX ? ax.map { "sha256:" + $0.treeHash } : nil)
                var line = try JSONEncoder().encode(rec)
                line.append(0x0A)
                FileHandle.standardOutput.write(line)
            }
        } else {
            var line = try JSONEncoder().encode(s)
            line.append(0x0A)
            FileHandle.standardOutput.write(line)
        }
        if dump {
            // Label each section so an inspector can tell content from chrome
            // at a glance — conflating them is what produced a false PASS.
            let block = """
            ===== \(app) | reason=\(ocrReason) basis=\(ax?.selectionBasis ?? "no-ax") depth=\(ax?.maxDepthReached ?? 0) =====
            --- AX CONTENT (\(contentChars) chars) ---
            \(ax?.content ?? "")
            --- AX CHROME (\(ax?.chrome.count ?? 0) chars) ---
            \(ax?.chrome ?? "")
            --- OCR (\(ocrChars) chars) ---
            \(ocrChars > 0 ? bestText : "(not run)")

            """
            FileHandle.standardError.write(block.data(using: .utf8)!)
        }
        try await Task.sleep(for: .seconds(3))
    }
}

app.run()   // must be the last statement; drives the run loop
