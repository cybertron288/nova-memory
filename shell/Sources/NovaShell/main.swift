/// Entry point. Top-level code must live in `main.swift`, and under Swift 6 it
/// runs on the main actor only if it says so.
///
/// Accessory activation policy: no Dock icon, no menu bar of its own.
/// `LSUIElement` in Info.plist does the same for the bundled app; setting it
/// here covers running the bare binary during development.
import AppKit

@MainActor
func runNova() {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    // The delegate is not retained by `NSApplication`, and losing it would
    // silently drop every callback.
    objc_setAssociatedObject(app, "nova.delegate", delegate, .OBJC_ASSOCIATION_RETAIN)
    app.run()
}

MainActor.assumeIsolated { runNova() }
