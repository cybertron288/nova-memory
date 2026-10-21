/// Nova's shell: a menu-bar app with one panel and no Dock icon.
///
/// It starts the daemon itself (see `Supervisor`) and speaks to it over the
/// control socket. While the daemon is down the glyph shows *attention* and the
/// panel says "Nova isn't running" — the truth, never a stale "capturing".
import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let model = PanelModel()
    private var panel: PanelController!
    private var statusItem: StatusItemController!
    private var hotkey: HotkeyMonitor!
    private var poll: Timer?
    private let supervisor = Supervisor()
    private var signalSources: [DispatchSourceSignal] = []
    private var digestCard: DigestCardController!
    private var digest: DigestController!

    func applicationDidFinishLaunching(_ notification: Notification) {
        // A dead control socket would otherwise kill the process on write.
        signal(SIGPIPE, SIG_IGN)

        supervisor.start()
        quitOnSignals()

        panel = PanelController(model: model)
        statusItem = StatusItemController(model: model, panel: panel, supervisor: supervisor)

        hotkey = HotkeyMonitor { [weak self] in
            panelLog.notice("chord fired")
            Task { @MainActor in self?.panel.toggle() }
        }
        hotkey.start()

        // The glyph polls whether or not the panel is open — it is the ambient
        // readout, and it must never show a stale "capturing".
        refreshStatus()
        poll = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshStatus() }
        }

        digestCard = DigestCardController { [weak self] in
            guard let self else { return }
            self.model.tab = .loops
            self.panel.show()
        }
        digest = DigestController(card: digestCard) { [weak self] in self?.statusItem.glyphFrame }
        digest.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        hotkey.stop()
        poll?.invalidate()
        supervisor.stop()
    }

    /// `pkill NovaShell` and Ctrl-C quit like the menu's Quit does. Their
    /// default disposition kills the process outright, skipping
    /// `applicationWillTerminate` and leaving the daemon running unowned.
    private func quitOnSignals() {
        for sig in [SIGTERM, SIGINT] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { NSApp.terminate(nil) }
            source.resume()
            signalSources.append(source)
        }
    }

    private func refreshStatus() {
        // Skip while the panel is open: it polls at 5s and owns the model.
        guard !panel.isVisible else {
            statusItem.update(status: model.status, reachable: !model.daemonDown,
                              accessibilityDenied: model.accessibilityDenied)
            return
        }
        let client = ControlClient()
        Task.detached(priority: .utility) {
            let status = try? client.status()
            await MainActor.run {
                self.statusItem.update(status: status, reachable: status != nil,
                                       accessibilityDenied: !NovaPermission.accessibility.granted)
            }
        }
    }
}
