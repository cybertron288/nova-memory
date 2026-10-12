import AppKit
import CryptoKit
import NovaCaptureKit
import ScreenCaptureKit
import Vision

/// The frontmost app's frontmost normal window, as CoreGraphics reports it.
struct FrontWindow: Sendable {
    let windowID: CGWindowID
    let title: String
    let app: String
    let bundleId: String
}

enum OCROutcome: Sendable {
    case text(String)
    case skipped(OCRSkip)
}

/// Why no text was recognized this tick. Raw values feed suppression accounting.
enum OCRSkip: String, Sendable {
    case noPermission = "ocr-no-permission"
    case throttled = "ocr-throttled"
    case unchanged = "ocr-unchanged"
    case windowGone = "ocr-window-gone"

    /// The window's last OCR text still stands, so the AX text the gate just
    /// rejected must not be emitted in its place. Otherwise one window
    /// alternates thin AX records and full OCR records, each novel against
    /// the other.
    var withholdsAX: Bool { self == .throttled || self == .unchanged }
}

enum OCR {
    /// Cheap: one CGWindowList call, no screenshot. The list is front-to-back,
    /// which `SCShareableContent.windows` is not, so its first match is the
    /// window the user is looking at.
    static func frontWindow() -> FrontWindow? {
        guard let front = NSWorkspace.shared.frontmostApplication else { return nil }
        let pid = front.processIdentifier
        let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                              kCGNullWindowID) as? [[String: Any]] ?? []
        for w in info {
            guard (w[kCGWindowOwnerPID as String] as? pid_t) == pid,
                  (w[kCGWindowLayer as String] as? Int) == 0,
                  let boundsDict = w[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary),
                  bounds.width > 200, bounds.height > 100,
                  let id = w[kCGWindowNumber as String] as? CGWindowID
            else { continue }
            return FrontWindow(windowID: id,
                               title: w[kCGWindowName as String] as? String ?? "",
                               app: front.localizedName ?? "unknown",
                               bundleId: front.bundleIdentifier ?? "")
        }
        return nil
    }
}

/// Owns the throttle so the screenshot and Vision stay off the main actor.
actor OCRWorker {
    private var throttle = OCRThrottle()
    private var requestedScreenRecording = false

    func recognize(_ w: FrontWindow, now: Double) async throws -> OCROutcome {
        guard CGPreflightScreenCaptureAccess() else {
            if !requestedScreenRecording {
                requestedScreenRecording = true
                CGRequestScreenCaptureAccess()
                FileHandle.standardError.write(
                    "[capture] OCR needs Screen Recording for Nova (System Settings > Privacy & Security > Screen Recording); AX-only until granted\n"
                        .data(using: .utf8)!)
            }
            return .skipped(.noPermission)
        }
        guard throttle.isDue(window: w.windowID, now: now) else { return .skipped(.throttled) }

        guard let image = try await Self.screenshot(w.windowID) else { return .skipped(.windowGone) }

        guard throttle.shouldRecognize(window: w.windowID, fingerprint: Self.fingerprint(image), now: now) else {
            return .skipped(.unchanged)
        }

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        try VNImageRequestHandler(cgImage: image).perform([request])
        let text = (request.results ?? [])
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n")
        return .text(text)
    }

    /// Nonisolated because ScreenCaptureKit's results are not Sendable and
    /// cannot be handed into the actor.
    private nonisolated static func screenshot(_ id: CGWindowID) async throws -> CGImage? {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        guard let window = content.windows.first(where: { $0.windowID == id }) else { return nil }
        let config = SCStreamConfiguration()
        config.width = Int(window.frame.width)
        config.height = Int(window.frame.height)
        config.showsCursor = false
        let filter = SCContentFilter(desktopIndependentWindow: window)
        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }

    /// Hashing a 96x64 grayscale thumbnail is cheap next to Vision. A blinking
    /// cursor can still change it; that costs at most one run per interval.
    private static func fingerprint(_ image: CGImage) -> String {
        let width = 96, height = 64
        var pixels = [UInt8](repeating: 0, count: width * height)
        pixels.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: width, height: height,
                                      bitsPerComponent: 8, bytesPerRow: width,
                                      space: CGColorSpaceCreateDeviceGray(),
                                      bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return }
            ctx.interpolationQuality = .low
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        return SHA256.hash(data: Data(pixels)).map { String(format: "%02x", $0) }.joined()
    }
}
