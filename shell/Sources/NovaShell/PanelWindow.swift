/// The window the panel lives in, and the ⌃⌥ chord that summons it.
///
/// Not an `NSPopover`: the panel is centered on screen, floats above every
/// window, and appears on every Space. An anchored popover under a 16pt corner
/// icon would fight the platform convention and force a second visual
/// treatment for the same content.
import AppKit
import SwiftUI
import Carbon.HIToolbox
import os

/// Panel open/close decisions, readable with
/// `log stream --predicate 'subsystem == "nova.shell"'` — the panel failing to
/// appear is otherwise invisible from outside the process.
let panelLog = Logger(subsystem: "nova.shell", category: "panel")

final class PanelWindow: NSPanel {
    /// Non-activating: summoning Nova must not steal focus from the app the
    /// user is in. They press a chord, read, act, and are gone — taking over
    /// the foreground for that would be rude and would disturb what they were
    /// reading behind it.
    init(model: PanelModel) {
        super.init(
            contentRect: PanelWindow.stage,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        isFloatingPanel = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        isOpaque = false
        backgroundColor = .clear
        // No window shadow: the window is larger than the panel and mostly
        // transparent, and the window server's shadow traced that transparent
        // region as a ghost outline. The shadow is drawn by SwiftUI instead.
        hasShadow = false
        hidesOnDeactivate = false
        isMovableByWindowBackground = false
        animationBehavior = .none

        let host = NSHostingView(rootView: PanelView(model: model))
        host.translatesAutoresizingMaskIntoConstraints = false
        contentView = NSView(frame: PanelWindow.stage)
        contentView!.addSubview(host)
        NSLayoutConstraint.activate([
            host.leadingAnchor.constraint(equalTo: contentView!.leadingAnchor),
            host.trailingAnchor.constraint(equalTo: contentView!.trailingAnchor),
            host.topAnchor.constraint(equalTo: contentView!.topAnchor),
            host.bottomAnchor.constraint(equalTo: contentView!.bottomAnchor),
        ])

        // The window is sized once, by the controller, and never by content.
        host.sizingOptions = []
    }

    /// The fixed window: the panel at its largest, plus the shadow's margin.
    static let stage = NSRect(
        x: 0, y: 0,
        width: Nova.panelWidth + Nova.panelMargin * 2,
        height: Nova.panelMaxHeight + Nova.panelMargin * 2
    )

    // Borderless windows refuse key status by default, which would break every
    // keystroke the panel's interface is built from.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

// MARK: - Controller

@MainActor
final class PanelController: NSObject, NSWindowDelegate {
    private let model: PanelModel
    private var window: PanelWindow?
    private var keyMonitor: Any?
    private var outsideClickMonitor: Any?
    private var clickInWindowMonitor: Any?

    init(model: PanelModel) {
        self.model = model
        super.init()
        model.onRequestClose = { [weak self] in self?.hide() }
    }

    var isVisible: Bool { window?.isVisible ?? false }

    func toggle() {
        panelLog.notice("toggle: isVisible=\(self.isVisible, privacy: .public) onScreen=\(self.window?.occlusionState.contains(.visible) ?? false, privacy: .public)")
        isVisible ? hide() : show()
    }

    func show() {
        let panel = window ?? PanelWindow(model: model)
        window = panel
        panel.delegate = self

        position(panel)
        model.panelDidOpen()
        panelLog.notice("show: frame=\(NSStringFromRect(panel.frame), privacy: .public) screen=\(NSScreen.main.map { NSStringFromRect($0.frame) } ?? "none", privacy: .public)")

        // `orderFrontRegardless` rather than `makeKeyAndOrderFront` alone:
        // the shell is an accessory app with no Dock presence, so it is not
        // guaranteed to be allowed to activate.
        panel.orderFrontRegardless()
        panel.makeKey()

        installMonitors()
        animateIn(panel)
    }

    /// The visible panel, in screen coordinates: the top of the window minus
    /// the margin, as tall as SwiftUI last laid it out.
    private func panelRect(_ panel: PanelWindow) -> NSRect {
        let m = Nova.panelMargin
        let h = model.panelHeight
        return NSRect(x: panel.frame.minX + m, y: panel.frame.maxY - m - h,
                      width: Nova.panelWidth, height: h)
    }

    func hide() {
        guard let panel = window, panel.isVisible else { return }
        panelLog.notice("hide")
        removeMonitors()
        model.panelDidClose()

        // Dissolve: a plain fade. 140ms — dismissal is quick.
        NSAnimationContext.runAnimationGroup { context in
            context.duration = Nova.quick
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.32, 0.72, 0.28, 1.0)
            panel.animator().alphaValue = 0
        } completionHandler: {
            panelLog.notice("hide: ordered out")
            panel.orderOut(nil)
            panel.alphaValue = 1
        }
    }

    /// The panel's top edge sits 32% from the top of the screen — above
    /// centre, where the eye rests, and clear of the dock. It grows downward.
    private func position(_ panel: PanelWindow) {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let stage = PanelWindow.stage
        let panelTop = visible.maxY - visible.height * 0.32
        panel.setFrame(NSRect(x: visible.midX - stage.width / 2,
                              y: panelTop + Nova.panelMargin - stage.height,
                              width: stage.width, height: stage.height),
                       display: true)
    }

    /// Develop: opacity 0→1 with scale 0.96→1, from the panel's own centre.
    /// No slide, no drop, no spring — it fades up in place, already lit. The
    /// backdrop is deliberately not dimmed: dimming the screen for a
    /// two-second check would make the panel feel modal, which it isn't.
    private func animateIn(_ panel: PanelWindow) {
        // The window is shown at full opacity first. An earlier version set
        // alpha to 0 and animated it up through `NSAnimationContext`, which on
        // a non-activating borderless panel could leave it at 0 forever — a
        // correctly sized, correctly placed, completely invisible window.
        // Visibility is the product; the fade is polish, so the fade is what
        // gives way.
        panel.alphaValue = 1
    }

    // MARK: Monitors

    private func installMonitors() {
        removeMonitors()

        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, let press = Self.translate(event) else { return event }
            return self.model.handleKey(press) ? nil : event
        }

        // Clicking anywhere outside dismisses. The panel is transient by
        // nature; it should never be something the user has to put away.
        //
        // Two guards. The click that *opens* the panel is still being
        // delivered when this monitor installs, so without the grace window it
        // would immediately close what it just opened — which also made the
        // status item appear dead, since every click re-showed a
        // never-quite-visible panel. And a click inside the panel's own frame
        // is not an outside click, however the monitor sees it.
        let openedAt = Date()
        outsideClickMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] event in
            Task { @MainActor in
                guard let self, let panel = self.window else { return }
                guard Date().timeIntervalSince(openedAt) > 0.3 else { return }
                if self.panelRect(panel).contains(NSEvent.mouseLocation) { return }
                self.hide()
            }
        }

        // The transparent margin belongs to Nova's window, so a click there
        // never reaches the global monitor. Treat it as outside too.
        clickInWindowMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] event in
            guard let self, let panel = self.window, event.window === panel else { return event }
            if self.panelRect(panel).contains(NSEvent.mouseLocation) { return event }
            self.hide()
            return nil
        }
    }

    private func removeMonitors() {
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        if let outsideClickMonitor { NSEvent.removeMonitor(outsideClickMonitor) }
        if let clickInWindowMonitor { NSEvent.removeMonitor(clickInWindowMonitor) }
        clickInWindowMonitor = nil
        keyMonitor = nil
        outsideClickMonitor = nil
    }

    private static func translate(_ event: NSEvent) -> PanelModel.KeyPress? {
        switch Int(event.keyCode) {
        case kVK_Escape: return .escape
        case kVK_DownArrow: return .down
        case kVK_UpArrow: return .up
        case kVK_Return, kVK_ANSI_KeypadEnter: return .enter
        case kVK_Delete, kVK_ForwardDelete: return .delete
        case kVK_Space: return .space
        // ⌥← / ⌥→ switch tabs. Option rather than plain arrows, which move
        // focus within the list.
        case kVK_LeftArrow where event.modifierFlags.contains(.option): return .prevTab
        case kVK_RightArrow where event.modifierFlags.contains(.option): return .nextTab
        default: break
        }
        guard let characters = event.charactersIgnoringModifiers?.lowercased() else { return nil }
        if characters == "s" { return .snooze }
        if characters == "y" { return .yes }
        if characters == "n" { return .no }
        if let digit = Int(characters), (1...9).contains(digit) { return .digit(digit) }
        return nil
    }
}

// MARK: - The chord
//
// ⌃⌥ held together, with no third key. A modifier-only hotkey cannot be
// registered through the normal hotkey API, so it is detected from the global
// flags-changed stream instead: fire when both go down together, and arm again
// only once both have been released.

@MainActor
final class HotkeyMonitor {
    private var monitor: Any?
    private var localMonitor: Any?
    private var armed = true
    private let onFire: () -> Void

    init(onFire: @escaping () -> Void) {
        self.onFire = onFire
    }

    /// Requires Accessibility permission for the global stream. Without it the
    /// local monitor still works while Nova is frontmost, so the chord degrades
    /// rather than vanishing.
    func start() {
        stop()
        monitor = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            Task { @MainActor in self?.handle(event) }
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            Task { @MainActor in self?.handle(event) }
            return event
        }
    }

    func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        monitor = nil
        localMonitor = nil
    }

    private func handle(_ event: NSEvent) {
        let flags = event.modifierFlags
        let bothDown = flags.contains(.control) && flags.contains(.option)
        // Re-arming only when both are released is what stops the chord from
        // firing repeatedly while the user holds it.
        if bothDown, armed {
            armed = false
            onFire()
        } else if !flags.contains(.control) && !flags.contains(.option) {
            armed = true
        }
    }
}
