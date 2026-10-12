/// Whether Nova may read the screen, and the way to fix it when it may not.
///
/// Asked of the shell's own process: launched as Nova.app it is the process
/// macOS charges for the daemon and capture too, so its answer is theirs. A
/// bare binary run from a terminal gets the terminal's answer, which is again
/// the one capture runs under. Without this check a revoked grant was silent —
/// capture read empty windows, the daemon kept reporting "capturing", and the
/// panel agreed.
import AppKit
import ApplicationServices

enum AccessibilityPermission {
    /// Cheap enough to ask on every poll; it does not prompt.
    static var granted: Bool { AXIsProcessTrusted() }

    /// Privacy & Security → Accessibility, where Nova's switch is.
    static func openSettings() {
        guard let url = URL(string:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        else { return }
        NSWorkspace.shared.open(url)
    }
}
