// The Inspector's window (D22).
//
// An ordinary titled, resizable window — deliberately unlike the loop panel,
// which is borderless and non-activating because it is summoned and dismissed.
// This one is opened, moved, resized and read, so it behaves like every other
// macOS window the user has: the standard chrome is the correct answer here,
// the same reasoning that keeps the menu-bar menu a native NSMenu.
import AppKit
import SwiftUI

@MainActor
final class InspectorWindow: NSObject, NSWindowDelegate {
    private let model: InspectorModel
    private var window: NSWindow?

    // No default argument: constructing an InspectorModel is main-actor work,
    // and a default in a nonisolated signature is evaluated outside it.
    init(model: InspectorModel) {
        self.model = model
        super.init()
    }

    /// Opens the window, or brings it forward if it is already open.
    func show() {
        if let window {
            // Already open: raise it rather than making a second one.
            model.refresh()
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let w = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 720, height: 460),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false,
        )
        // Still a standard window, with its title bar folded into the
        // content: the traffic lights sit over the sidebar, as in Finder and
        // System Settings, rather than over a strip of empty chrome.
        w.title = "Your Space"
        w.titleVisibility = .hidden
        w.titlebarAppearsTransparent = true
        w.isMovableByWindowBackground = true
        // Dark in both appearances, like the panel: the tokens are drawn for
        // a dark ground.
        w.appearance = NSAppearance(named: .darkAqua)
        // Non-opaque with a clear background, so NovaGround's HUD material can
        // sample the desktop the way the panel's does. An opaque window draws
        // its own background under the material and the glass reads as flat
        // grey — which is what Your Space looked like before this.
        w.isOpaque = false
        w.backgroundColor = .clear
        w.contentMinSize = NSSize(width: 720, height: 460)
        w.contentView = NSHostingView(rootView: InspectorView(model: model))
        w.delegate = self
        w.isReleasedWhenClosed = false
        w.center()
        // Remembers where the user put it, which an audited surface earns:
        // they come back to it.
        w.setFrameAutosaveName("NovaYourSpace")
        window = w

        model.start()
        w.makeKeyAndOrderFront(nil)
        // The shell is an accessory app with no Dock icon, so it has to ask
        // for activation explicitly or the window opens behind whatever the
        // user was looking at.
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Polling stops with the window. The feeds decrypt a page of rows in the
    /// daemon, and doing that for a window nobody is looking at is work
    /// nobody asked for — the same rule the panel's per-tab fetch follows.
    func windowWillClose(_ notification: Notification) {
        model.stop()
    }
}
