/// The menu-bar icon: the whole ambient surface (design spec §9.H).
///
/// Two jobs, and no more. Show state through the aperture's form, and open
/// things — a native menu on either click, the panel as its first item. It lists no
/// loops, shows no count, and holds no settings pane; those live in the panel
/// and in Settings.
///
/// The glyph is always a **template image**, so macOS recolours it for light
/// and dark menu bars and for the highlighted state. Status is carried by form,
/// never by hue: a 16pt coloured dot is illegible, and colourblind users exist.
import AppKit
import SwiftUI

@MainActor
final class StatusItemController: NSObject {
    private let item: NSStatusItem
    private let model: PanelModel
    private let panel: PanelController
    private let supervisor: Supervisor
    /// Built on first use rather than at launch: most sessions never open it,
    /// and its model polls only while its window is up.
    private lazy var inspector = InspectorWindow(model: InspectorModel(
        restartDaemon: { [weak self] in self?.supervisor.restart() },
    ))
    private var state: ApertureState = .attention

    init(model: PanelModel, panel: PanelController, supervisor: Supervisor) {
        self.model = model
        self.panel = panel
        self.supervisor = supervisor
        self.item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()

        if let button = item.button {
            button.target = self
            button.action = #selector(clicked(_:))
            // Mouse-UP, not down. The menu is popped up manually (see
            // showMenu), and popping it on mouse-down ran it inside the
            // button's click tracking: the menu consumed the release the
            // tracking was waiting for, so the button kept waiting and the app
            // ignored every later click and the ⌃⌥ chord until another release
            // happened to arrive. On mouse-up, tracking has already finished.
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        render(.attention)
    }

    /// The glyph's frame in screen coordinates, for anything that drops down
    /// from it (the morning digest card).
    var glyphFrame: NSRect? {
        guard let button = item.button, let window = button.window else { return nil }
        return window.convertToScreen(button.convert(button.bounds, to: nil))
    }

    /// Called by the app's poll. Re-renders only on change, so the menu bar is
    /// not redrawn every few seconds for nothing.
    func update(status: DaemonStatus?, reachable: Bool, accessibilityDenied: Bool) {
        let next: ApertureState
        if !reachable || accessibilityDenied {
            next = .attention
        } else if status?.paused == true {
            next = .paused
        } else {
            next = .capturing
        }
        guard next != state else { return }
        render(next)
    }

    private func render(_ next: ApertureState) {
        state = next
        item.button?.image = Self.glyph(next)
        item.button?.toolTip = nil   // the form already says it; a tooltip would be noise
    }

    /// Renders the aperture to a template image at menu-bar size. Drawn rather
    /// than shipped as an asset so it stays in lockstep with `Aperture`'s
    /// geometry — one definition of the mark, not two.
    private static func glyph(_ state: ApertureState) -> NSImage {
        let side: CGFloat = 18
        let image = NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }

            let path = Aperture(openness: state.openness).path(in: rect)
            context.setStrokeColor(NSColor.black.cgColor)
            context.setLineWidth((1.5 / 16 * 100) * (side / 112))
            context.setLineCap(.round)
            context.addPath(path.cgPath)
            context.strokePath()

            if state == .attention {
                let dot = side * (3.0 / 16) * (50.0 / 56)
                context.setFillColor(NSColor.black.cgColor)
                context.fillEllipse(in: CGRect(
                    x: rect.midX - dot / 2, y: rect.midY - dot / 2,
                    width: dot, height: dot
                ))
            }
            return true
        }
        image.isTemplate = true
        return image
    }

    // MARK: Clicks

    /// Either button opens the menu; the panel is its first item and the
    /// ⌃⌥ chord.
    @objc private func clicked(_ sender: NSStatusBarButton) {
        let event = NSApp.currentEvent
        panelLog.notice("icon clicked: event=\(event.map { String(describing: $0.type) } ?? "none", privacy: .public)")
        showMenu(from: sender)
    }

    /// A native `NSMenu`, unstyled. Nova contributes wording and grouping, not
    /// chrome: it renders correctly in every appearance and accessibility
    /// setting for free, and it cannot drift out of sync with the panel
    /// because it holds no loop data at all.
    private func showMenu(from button: NSStatusBarButton) {
        let menu = NSMenu()

        // First, and showing the chord, so the menu teaches the shortcut
        // that skips it.
        let open = NSMenuItem(title: "Open Nova", action: #selector(openPanel), keyEquivalent: "")
        open.target = self
        open.keyEquivalentModifierMask = [.control, .option]
        menu.addItem(open)
        menu.addItem(.separator())

        if model.daemonDown {
            addDownItems(to: menu)
        } else if model.status?.paused == true {
            // A disabled item as a status readout is a standard macOS idiom
            // and costs nothing.
            let paused = NSMenuItem(title: "Paused", action: nil, keyEquivalent: "")
            paused.isEnabled = false
            menu.addItem(paused)

            let resume = NSMenuItem(title: "Resume capturing", action: #selector(togglePause), keyEquivalent: "")
            resume.target = self
            menu.addItem(resume)
        } else {
            let pause = NSMenuItem(title: "Pause capturing", action: #selector(togglePause), keyEquivalent: "")
            pause.target = self
            menu.addItem(pause)
        }

        menu.addItem(.separator())
        // "Your Space" is the audited half of the product (F5.5, D22): the
        // surfaces opened rarely and read for minutes, as against the panel,
        // which is read in about two seconds. One item that opens the window:
        // its panes are listed in its own sidebar, and repeating them here
        // would make the menu a second, worse copy of that navigation.
        let space = NSMenuItem(title: "Your Space", action: #selector(openInspector), keyEquivalent: "")
        space.target = self
        menu.addItem(space)

        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Nova", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)

        // Popped up directly rather than assigned to `item.menu`. Assigning it
        // — even briefly — hands left-click to the menu system for good, and
        // the button's action stops firing.
        menu.popUp(positioning: nil,
                   at: NSPoint(x: 0, y: button.bounds.height + 4),
                   in: button)
    }

    /// Why the daemon is down, in the supervisor's words. Once restarting has
    /// given up, the daemon's last line is the likeliest explanation (a
    /// missing API key, say), so it is shown as-is.
    private func addDownItems(to menu: NSMenu) {
        func readout(_ title: String) {
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }
        switch supervisor.state {
        case .gaveUp:
            readout("Stopped restarting")
            if let line = supervisor.lastLine {
                readout(line.count > 80 ? String(line.prefix(79)) + "…" : line)
            }
            let restart = NSMenuItem(title: "Restart Nova", action: #selector(restartDaemon), keyEquivalent: "")
            restart.target = self
            menu.addItem(restart)
        case .unavailable(let reason):
            readout("Can't start: \(reason)")
        default:
            readout("Not running · restarting…")
        }
    }

    @objc private func restartDaemon() { supervisor.restart() }
    @objc private func openPanel() { panel.show() }
    @objc private func openInspector() { inspector.show() }
    @objc private func togglePause() { model.togglePause() }
}

private extension Path {
    /// `Path` bridges to Core Graphics, but not through a stored property.
    var cgPath: CGPath { self.cgPath(using: .init()) }

    func cgPath(using _: CGAffineTransform) -> CGPath {
        let path = CGMutablePath()
        forEach { element in
            switch element {
            case .move(let to): path.move(to: to)
            case .line(let to): path.addLine(to: to)
            case .quadCurve(let to, let control): path.addQuadCurve(to: to, control: control)
            case .curve(let to, let c1, let c2): path.addCurve(to: to, control1: c1, control2: c2)
            case .closeSubpath: path.closeSubpath()
            }
        }
        return path
    }
}
