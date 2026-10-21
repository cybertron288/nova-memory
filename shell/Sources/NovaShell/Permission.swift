/// The macOS permissions Nova holds, whether each is on, and the way to fix
/// one that is off.
///
/// Asked of the shell's own process: launched as Nova.app it is the process
/// macOS charges for the daemon and capture too, so its answer is theirs. A
/// bare binary run from a terminal gets the terminal's answer, which is again
/// the one capture runs under. Without this check a revoked grant was silent —
/// capture read empty windows, the daemon kept reporting "capturing", and the
/// panel agreed.
import AppKit
import ApplicationServices

enum NovaPermission: CaseIterable {
    case accessibility, screenRecording

    var title: String {
        switch self {
        case .accessibility: return "Accessibility"
        case .screenRecording: return "Screen Recording"
        }
    }

    var purpose: String {
        switch self {
        case .accessibility:
            return "Nova reads the text of the window in front through it, every 3 seconds. "
                + "It also lets ⌃⌥ open the panel from any app"
        case .screenRecording:
            return "When a window exposes no text, Nova takes a picture of it and reads the text "
                + "on this Mac. The picture is never saved"
        }
    }

    var withoutIt: String {
        switch self {
        case .accessibility:
            return "Without it, Nova reads nothing"
        case .screenRecording:
            return "Without it, apps that hide their text from Accessibility are skipped. "
                + "Everything else still works"
        }
    }

    var required: Bool { self == .accessibility }

    /// Cheap enough to ask on every poll; neither check prompts.
    var granted: Bool {
        switch self {
        case .accessibility: return AXIsProcessTrusted()
        case .screenRecording: return CGPreflightScreenCaptureAccess()
        }
    }

    /// Privacy & Security, at the list holding Nova's switch.
    func openSettings() {
        let anchor = switch self {
        case .accessibility: "Privacy_Accessibility"
        case .screenRecording: "Privacy_ScreenCapture"
        }
        guard let url = URL(string:
            "x-apple.systempreferences:com.apple.preference.security?\(anchor)")
        else { return }
        NSWorkspace.shared.open(url)
    }
}
