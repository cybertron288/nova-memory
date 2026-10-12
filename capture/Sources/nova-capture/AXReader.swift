import AppKit
import ApplicationServices
import NovaCaptureKit

/// Extracts text from the focused window's accessibility tree.
///
/// The extractor is deliberately generic: no app names, no bundle IDs. It keys
/// only on accessibility structure and geometry, because Nova captures whatever
/// the user has frontmost across all of macOS.
///
/// Three measured iterations:
///
///   1. (2026-08-13) Collected AXValue/AXTitle/AXDescription everywhere.
///      Returned pure UI chrome — toolbar labels, tab titles, file trees.
///   2. (2026-08-21) Classified by leaf role. Failed: sidebars and nav menus
///      are `AXStaticText` too, so Slack's channel list scored as content.
///   3. (2026-08-21) Required membership in an `AXWebArea`/`AXTextArea`
///      subtree. Failed: web apps and Electron render the *whole* window inside
///      one web area, so the test admitted sidebars again.
///
/// This version scores candidate *regions* by focus, area and text density
/// (see `ContentScoring`), which are the properties that actually separate a
/// document pane from navigation. Regions are the scroll areas, web areas and
/// text areas of the window; the winner's text becomes the payload and
/// everything else becomes chrome.
enum AXReader {
    struct Extraction {
        /// Text from the region identified as document content.
        let content: String
        /// Everything else — controls, sidebars, navigation.
        let chrome: String
        let app: String
        /// The frontmost application's bundle identifier.
        let bundleId: String
        /// The focused window's title (`kAXTitleAttribute`).
        let windowTitle: String
        /// The address-bar URL, present only for browsers.
        let url: String?
        /// Hash over the whole extracted tree (content, a NUL delimiter,
        /// then chrome) — the cheap level-1 dedup gate that catches
        /// chrome-only changes a content-only hash cannot see. The delimiter
        /// prevents content="ab"+chrome="c" from hashing identically to
        /// content="a"+chrome="bc".
        let treeHash: String
        /// Diagnostics for tuning; not part of the capture payload.
        let nodesVisited: Int
        let maxDepthReached: Int
        /// Did region scoring find a document pane?
        let foundContentRole: Bool
        /// How the winning region was chosen: "focus", "geometry", or "none".
        let selectionBasis: String
    }

    /// Roles that can root a candidate content region.
    ///
    /// `AXGroup` is deliberately absent (measured 2026-08-21): web pages nest
    /// groups dozens deep, so admitting them split every window into hundreds
    /// of tiny candidates. Text then landed in whichever leaf group enclosed
    /// it — a few hundred square points — and no candidate could pass the area
    /// test, so every deeply-nested app returned `basis=none` and zero content.
    /// Only Finder, with a shallow tree, survived. Panes are what we want to
    /// score, and panes are scroll areas, web areas and text areas.
    private static let regionRoles: Set<String> = [
        "AXWebArea", "AXTextArea", "AXDocument", "AXScrollArea",
        "AXTable", "AXOutline", "AXList",
    ]

    /// A node must cover at least this fraction of the window to become a
    /// candidate pane. Guards against the same fragmentation from any role:
    /// a scroll area wrapping a single toolbar row is not a document pane.
    private static let minCandidateAreaFraction = 0.05

    /// Roles whose text may contribute to a region's content.
    private static let textRoles: Set<String> = [
        "AXStaticText", "AXTextArea", "AXTextField",
        "AXHeading", "AXParagraph", "AXCell", "AXLink", "AXValueIndicator",
    ]

    /// Never read these, regardless of position or role.
    private static let forbiddenRoles: Set<String> = ["AXSecureTextField"]

    /// PIDs already poked with `AXManualAccessibility`. The flag persists for
    /// the life of the target process, so this is a once-per-app cost.
    /// AX calls are main-thread-bound here, so a plain lock keeps this safe
    /// without pulling in an actor.
    private final class PokeRegistry: @unchecked Sendable {
        static let shared = PokeRegistry()
        private var pids = Set<pid_t>()
        private let lock = NSLock()
        /// Returns true the first time a pid is seen.
        func claim(_ pid: pid_t) -> Bool {
            lock.lock(); defer { lock.unlock() }
            return pids.insert(pid).inserted
        }
    }

    /// Ask an Electron/Chromium app to expose its full accessibility tree.
    ///
    /// Measured 2026-08-22: without this, VSCodium's tree is 497 nodes of menu
    /// items with **no `AXTextArea` at all** — the Monaco editor is invisible.
    /// After setting it the tree grows to 757 nodes and the editor appears as a
    /// real `AXTextArea` carrying document text, in ~0.43 s.
    ///
    /// Two traps, both measured:
    ///   - The value must be an `NSNumber`. `kCFBooleanTrue` is silently ignored.
    ///   - The attribute **always reads back 0**, even when it is working. Never
    ///     use the readback as a success check; look for `AXTextArea` instead.
    ///
    /// `AXEnhancedUserInterface` is deliberately not set: it returns
    /// `kAXErrorIllegalArgument` (-25208) on current Electron and carries
    /// VoiceOver side effects.
    ///
    /// **Not every Chromium app accepts this.** Measured 2026-09-17: Google
    /// Chrome rejects `AXManualAccessibility` with `kAXErrorAttributeUnsupported`
    /// (-25205) and `AXEnhancedUserInterface` with -25208 — it implements
    /// neither, so there is no opt-in to set. Chrome instead builds its tree in
    /// response to being *walked*, asynchronously (561 → 963 nodes, depth 10 →
    /// 25, no web area → web area, within 0.5 s of a walk that set nothing).
    /// So a rejection here is not fatal and not always worth acting on; it means
    /// this particular lever does not exist for that app.
    ///
    /// The attribute reads back 0 even when it works, so the set call's own
    /// `AXError` is the only signal available about whether the app accepted
    /// the request. Discarding it made a rejected poke indistinguishable from
    /// an accepted one — the app simply exposed no document and the capture
    /// recorded that as "no content" (spec §7 forbids exactly this). Reported
    /// once per pid, matching the poke's own cadence.
    ///
    /// Two outcomes, worded differently on purpose. `-25205` is the ordinary
    /// answer from an app that never implemented the opt-in, and those apps
    /// capture normally, so it reads as information. Anything else is
    /// unexpected and keeps the warning's shape.
    private static func enableManualAccessibility(_ appEl: AXUIElement, pid: pid_t, appName: String) {
        guard PokeRegistry.shared.claim(pid) else { return }
        let err = AXUIElementSetAttributeValue(
            appEl, "AXManualAccessibility" as CFString, NSNumber(value: true))
        guard err != .success else { return }

        // -25205 (kAXErrorAttributeUnsupported) is the ordinary answer from an
        // app that never implemented this opt-in — Chrome, Ghostty and
        // Metalterm all return it, and all three capture normally, because
        // their trees build in response to being walked. Phrasing that as a
        // failure sent operators hunting for a break that was not there. Any
        // other error is genuinely unexpected and still reads as a warning.
        let line = err.rawValue == -25205
            ? "[capture] \(appName): no AXManualAccessibility opt-in — not needed, tree builds on walk\n"
            : "[capture] \(appName): AXManualAccessibility not set (AXError \(err.rawValue))\n"
        FileHandle.standardError.write(line.data(using: .utf8)!)
    }

    /// The frontmost document URL, when the app is a browser.
    ///
    /// Safari puts `AXURL` on the focused window. **Chrome does not** — it
    /// carries it on a child `AXGroup`, so reading only the window returned
    /// nil for every Chrome capture and `source_url` was null across the whole
    /// store (measured 2026-09-22). F1.2 asks for the URL, and without it a
    /// capture's provenance is "Google Chrome" rather than the site, which is
    /// the difference between a loop you can check and one you cannot.
    ///
    /// So: ask the window, then its descendants breadth-first, and take the
    /// shallowest `AXURL` that looks like a web address. Bounded hard on both
    /// depth and node count — this runs on every capture, and an unbounded
    /// walk of a browser tree is exactly the CPU cost the AX-only design
    /// exists to avoid. Depth 4 and 400 nodes are generous for a value
    /// measured at depth 1 and cheap enough to be invisible.
    ///
    /// Only `http`/`https` count. A `file://` or `chrome://` URL is not
    /// provenance a user would recognise, and the scheme check also rejects
    /// the stray non-address `AXURL`s that some toolbars expose.
    static func documentURL(_ windowEl: AXUIElement) -> String? {
        if let direct = webURL(of: windowEl) { return direct }

        var frontier = [windowEl]
        var visited = 0
        for _ in 0..<4 {
            var next: [AXUIElement] = []
            for el in frontier {
                visited += 1
                if visited > 400 { return nil }
                if let found = webURL(of: el) { return found }
                var c: CFTypeRef?
                guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &c) == .success,
                      let kids = c as? [AXUIElement] else { continue }
                next.append(contentsOf: kids)
            }
            if next.isEmpty { return nil }
            frontier = next
        }
        return nil
    }

    /// `AXURL` on one element, accepted only when it is a web address.
    private static func webURL(of el: AXUIElement) -> String? {
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, "AXURL" as CFString, &v) == .success else { return nil }
        let raw: String?
        if let u = v as? URL { raw = u.absoluteString }
        else if let s = v as? String { raw = s }
        else { raw = nil }
        guard let raw, URLProvenance.isWebURL(raw) else { return nil }
        return raw
    }

    /// Reads the frontmost application's focused window.
    static func frontmostText(maxNodes: Int = 12_000, maxDepth: Int = 80) -> Extraction? {
        guard let front = NSWorkspace.shared.frontmostApplication else { return nil }
        return text(of: front, maxNodes: maxNodes, maxDepth: maxDepth)
    }

    /// Reads a *named* application's focused window instead of the frontmost one.
    ///
    /// Measurement-only (spec: content-quality gate). Running `--dump` from a
    /// terminal makes that terminal frontmost, so every sample came back as the
    /// terminal and no other app could be measured from a shell at all. Naming
    /// the target decouples "which window is being read" from "which window has
    /// keyboard focus", so the app under test can be read while the shell keeps
    /// focus. Pair with --delay for the opposite arrangement (target frontmost).
    ///
    /// Matches on localizedName first, then bundle identifier suffix, both
    /// case-insensitively, so `--app chrome` finds "Google Chrome".
    static func text(ofAppNamed name: String, maxNodes: Int = 12_000, maxDepth: Int = 80) -> Extraction? {
        let wanted = name.lowercased()
        let match = NSWorkspace.shared.runningApplications.first { app in
            guard app.activationPolicy == .regular else { return false }
            if let n = app.localizedName?.lowercased(), n.contains(wanted) { return true }
            if let b = app.bundleIdentifier?.lowercased(),
               b.split(separator: ".").last?.contains(wanted) == true { return true }
            return false
        }
        guard let match else { return nil }
        return text(of: match, maxNodes: maxNodes, maxDepth: maxDepth)
    }

    /// How long to wait before re-walking a window that exposed no content.
    ///
    /// Chromium builds its accessibility tree in response to being *walked*,
    /// asynchronously, and tears it down again when no client holds it — so an
    /// isolated walk always reads the cold tree and the population it triggers
    /// lands after the measurement. Measured on Chrome 2026-09-17: a single
    /// walk that set no attribute took the tree from 561 nodes / depth 10 / no
    /// web area to 963 / depth 25 / web area present within 0.5 s.
    static let warmUpDelay = 0.6

    /// Cap on warm-up retries, so a window that genuinely exposes nothing costs
    /// a bounded amount. Zed is that case: 5 nodes, 23 chars, immune to every
    /// retry because GPUI draws its own UI and publishes no tree to warm.
    static let maxWarmUpAttempts = 3

    /// Reads one app's focused window, warming a cold accessibility tree once.
    ///
    /// The first walk both *measures* and *triggers* population, so a window
    /// that reports no content role may simply not have been built yet. A
    /// second walk after `warmUpDelay` distinguishes "this app exposes no
    /// document" from "this app had not built its tree yet" — the two were
    /// indistinguishable before, and Chrome sat in the second case reporting
    /// zero content on every tick (docs D2).
    ///
    /// Generic by construction: the retry keys on the *result* (no content
    /// role) and never on app identity, so it covers any lazily-built tree
    /// rather than a list of known browsers.
    private static func text(of running: NSRunningApplication, maxNodes: Int, maxDepth: Int) -> Extraction? {
        var best = walk(of: running, maxNodes: maxNodes, maxDepth: maxDepth)
        // A window that already yielded a document pays nothing further.
        guard let first = best, !first.foundContentRole else { return best }

        // One retry is not enough for a cold tree. Measured 2026-09-17: a
        // Chrome window that had not been queried recently returned 70 nodes,
        // then 182 after a single 0.6s retry — still a fraction of the 1,085 it
        // settles at. Under sustained querying it reaches that figure and then
        // holds it exactly (12 consecutive walks, unchanged across a 3 s idle),
        // so the stopping rule is growth, not a fixed count: keep walking while
        // the tree is still getting bigger, and stop as soon as it is not.
        for _ in 0..<maxWarmUpAttempts {
            Thread.sleep(forTimeInterval: warmUpDelay)
            guard let next = walk(of: running, maxNodes: maxNodes, maxDepth: maxDepth) else { break }
            let grew = next.nodesVisited > (best?.nodesVisited ?? 0)
            if next.foundContentRole { return next }
            if !grew { break }
            best = next
        }
        return best
    }

    private static func walk(of running: NSRunningApplication, maxNodes: Int, maxDepth: Int) -> Extraction? {
        let appEl = AXUIElementCreateApplication(running.processIdentifier)
        enableManualAccessibility(appEl, pid: running.processIdentifier,
                                  appName: running.localizedName ?? "pid \(running.processIdentifier)")
        var windowRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appEl, kAXFocusedWindowAttribute as CFString, &windowRef) == .success,
              let window = windowRef else { return nil }
        let windowEl = window as! AXUIElement

        let focusedEl = focusedElement(appEl)
        var visited = 0
        var deepest = 0

        // Fragments belonging to each candidate region, plus the window-level
        // leftovers that never fell inside one.
        struct Candidate {
            let id: Int
            let frame: ContentScoring.Rect
            let role: String
            /// The candidate this one is nested in, if any.
            let parent: Int?
            var frags: [TextAssembly.Fragment] = []
            var hasFocus = false
        }
        var candidates: [Candidate] = []
        var looseFrags: [TextAssembly.Fragment] = []

        func string(_ el: AXUIElement, _ attribute: String) -> String? {
            var v: CFTypeRef?
            guard AXUIElementCopyAttributeValue(el, attribute as CFString, &v) == .success,
                  let s = v as? String, !s.isEmpty, s.count < 20_000 else { return nil }
            return s
        }

        func point(_ el: AXUIElement, _ attribute: String, _ type: AXValueType) -> CGPoint? {
            var v: CFTypeRef?
            guard AXUIElementCopyAttributeValue(el, attribute as CFString, &v) == .success,
                  let value = v, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
            var p = CGPoint.zero
            guard AXValueGetValue(value as! AXValue, type, &p) else { return nil }
            return p
        }

        func frame(_ el: AXUIElement) -> ContentScoring.Rect? {
            guard let origin = point(el, kAXPositionAttribute as String, .cgPoint) else { return nil }
            var v: CFTypeRef?
            guard AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &v) == .success,
                  let value = v, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
            var size = CGSize.zero
            guard AXValueGetValue(value as! AXValue, .cgSize, &size) else { return nil }
            return .init(x: Double(origin.x), y: Double(origin.y),
                         width: Double(size.width), height: Double(size.height))
        }

        // Window area gates candidate creation, so it must be known before
        // the walk rather than computed from the result.
        let winArea = frame(windowEl)?.area ?? 0

        // `regionIndex` is the innermost candidate region enclosing this node.
        // Nesting is common (a scroll area inside a web area); the innermost
        // wins so a sidebar nested in a page-wide web area stays distinct.
        func walk(_ el: AXUIElement, depth: Int, regionIndex: Int?, focusChain: [Int]) {
            guard depth < maxDepth, visited < maxNodes else { return }
            visited += 1
            deepest = max(deepest, depth)

            var roleRef: CFTypeRef?
            AXUIElementCopyAttributeValue(el, kAXRoleAttribute as CFString, &roleRef)
            let role = (roleRef as? String) ?? ""
            if forbiddenRoles.contains(role) { return }

            // A node roots a new candidate pane only if it is large enough to
            // plausibly be one. Without this, nested panes fragment the tree
            // and text lands in a leaf too small to ever win scoring.
            var region = regionIndex
            var chain = focusChain
            if regionRoles.contains(role), let f = frame(el), f.area > 0,
               winArea <= 0 || (f.area / winArea) >= minCandidateAreaFraction,
               !ContentScoring.isInline(role: role, frame: f,
                                        within: regionIndex.map { candidates[$0].frame }) {
                candidates.append(Candidate(id: candidates.count, frame: f, role: role, parent: regionIndex))
                region = candidates.count - 1
                chain.append(candidates.count - 1)
            }

            // Mark every enclosing candidate, not just the innermost: focus
            // usually sits on a leaf (a text area, a cell) whose useful text
            // lives in the surrounding pane. Marking only `region` would lose
            // the signal whenever the focused node is itself too small to have
            // become a candidate.
            if let focusedEl, CFEqual(el, focusedEl) {
                for i in focusChain { candidates[i].hasFocus = true }
                if let r = region { candidates[r].hasFocus = true }
            }

            if textRoles.contains(role) {
                let text = string(el, kAXValueAttribute as String)
                    ?? string(el, kAXTitleAttribute as String)
                if let text {
                    let y = point(el, kAXPositionAttribute as String, .cgPoint).map { Double($0.y) }
                    let frag = TextAssembly.Fragment(text: text, y: y)
                    if let r = region { candidates[r].frags.append(frag) }
                    else { looseFrags.append(frag) }
                }
            }

            // A non-text node's labels are chrome — control labels, wherever
            // they sit — unless one restates the text beneath it (see
            // `TextAssembly.labelSupersedes`). That is decided after the
            // children are walked, since they are what it is tested against.
            // Slack puts a message row's "Author: text. time." in its title.
            var labels: [String] = []
            if !textRoles.contains(role) {
                labels = [kAXTitleAttribute, kAXDescriptionAttribute]
                    .compactMap { string(el, $0 as String) }
            }
            let fragsBefore = region.map { candidates[$0].frags.count } ?? 0

            var kidsRef: CFTypeRef?
            if AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &kidsRef) == .success,
               let kids = kidsRef as? [AXUIElement] {
                for k in kids { walk(k, depth: depth + 1, regionIndex: region, focusChain: chain) }
            }

            var superseded = false
            for label in labels {
                if !superseded, let r = region,
                   TextAssembly.labelSupersedes(label, Array(candidates[r].frags[fragsBefore...])) {
                    let y = point(el, kAXPositionAttribute as String, .cgPoint).map { Double($0.y) }
                    candidates[r].frags.removeSubrange(fragsBefore...)
                    candidates[r].frags.append(.init(text: label, y: y, fromLabel: true))
                    superseded = true
                } else {
                    looseFrags.append(.init(text: label, y: nil))
                }
            }
        }
        walk(windowEl, depth: 0, regionIndex: nil, focusChain: [])

        let regions = candidates.map {
            ContentScoring.Region(id: $0.id, frame: $0.frame,
                                  texts: $0.frags.map(\.text), containsFocus: $0.hasFocus)
        }
        let winner = ContentScoring.selectContentRegion(regions, windowArea: winArea)
        if dumpRegions {
            reportRegions(regions, windowArea: winArea, winner: winner,
                          app: running.localizedName ?? "unknown")
            let roles = candidates.map { "\($0.id)=\($0.role)<\($0.parent.map(String.init) ?? "-")" }
            FileHandle.standardError.write("  roles: \(roles.joined(separator: " "))\n".data(using: .utf8)!)
        }

        let basis: String
        if let winner {
            basis = winner.containsFocus ? "focus" : "geometry"
        } else {
            basis = "none"
        }

        // Everything outside the winning region is chrome.
        var contentFrags: [TextAssembly.Fragment] = []
        var chromeFrags = looseFrags
        for c in candidates {
            if let winner, c.id == winner.id { contentFrags = c.frags }
            else { chromeFrags.append(contentsOf: c.frags) }
        }

        let content = TextAssembly.assemble(contentFrags)
        let chrome = TextAssembly.assemble(chromeFrags)
        let windowTitle = string(windowEl, kAXTitleAttribute as String) ?? ""

        return Extraction(
            content: content,
            chrome: chrome,
            app: running.localizedName ?? "unknown",
            bundleId: running.bundleIdentifier ?? "",
            windowTitle: windowTitle,
            url: Self.documentURL(windowEl),
            treeHash: Novelty.sha256(content + "\u{0}" + chrome),
            nodesVisited: visited,
            maxDepthReached: deepest,
            foundContentRole: winner != nil,
            selectionBasis: basis
        )
    }

    /// Set by `--regions`. Diagnostics only: prints the candidate list that
    /// scoring chose between, which is otherwise invisible — a capture reports
    /// the winner and the basis, never the field of candidates, so a bad pick
    /// and a bad candidate set look identical from outside.
    nonisolated(unsafe) static var dumpRegions = false

    private static func reportRegions(_ regions: [ContentScoring.Region],
                                      windowArea: Double,
                                      winner: ContentScoring.Region?,
                                      app: String) {
        var out = "===== \(app) | \(regions.count) candidates | windowArea=\(Int(windowArea)) =====\n"
        out += "  id   area%  focus  prose  chars  frame                        head\n"
        for r in regions.sorted(by: { $0.frame.area > $1.frame.area }) {
            let pct = windowArea > 0 ? (r.frame.area / windowArea) * 100 : 0
            let text = r.texts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
            let head = text.prefix(34).replacingOccurrences(of: "\n", with: "⏎")
            let mark = winner?.id == r.id ? "*" : " "
            out += String(format: "%@%4d %6.1f %6@ %6@ %6d  %4.0f,%-4.0f %4.0fx%-4.0f          %@\n",
                          mark, r.id, pct,
                          r.containsFocus ? "yes" : "—",
                          ContentScoring.looksLikeProse(r.texts) ? "yes" : "—",
                          text.count,
                          r.frame.x, r.frame.y, r.frame.width, r.frame.height,
                          String(head))
        }
        out += "  (* = selected)\n"
        FileHandle.standardError.write(out.data(using: .utf8)!)
    }

    private static func focusedElement(_ appEl: AXUIElement) -> AXUIElement? {
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appEl, kAXFocusedUIElementAttribute as CFString, &v) == .success,
              let el = v, CFGetTypeID(el) == AXUIElementGetTypeID() else { return nil }
        return (el as! AXUIElement)
    }
}
