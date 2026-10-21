/// Whether the Mac has a network path (F1.6).
///
/// Capture never needs the network; extraction does. The daemon only learns the
/// network is gone when a provider call fails, and on its own it would notice
/// the return up to a minute late. This watches the path so the panel can say
/// "offline" at once, and tells the daemon the moment the path comes back.
import Foundation
import Network

@MainActor
final class NetworkMonitor {
    private let monitor = NWPathMonitor()
    private var online = true
    private let onChange: (Bool) -> Void

    init(onChange: @escaping (Bool) -> Void) {
        self.onChange = onChange
    }

    func start() {
        monitor.pathUpdateHandler = { [weak self] path in
            let up = path.status == .satisfied
            Task { @MainActor in self?.apply(up) }
        }
        monitor.start(queue: DispatchQueue(label: "nova.network"))
    }

    func stop() {
        monitor.cancel()
    }

    private func apply(_ up: Bool) {
        guard up != online else { return }
        online = up
        onChange(up)
        guard up else { return }
        // Best effort: if the daemon is down it drains on its own clock once
        // the supervisor brings it back.
        let client = ControlClient()
        Task.detached(priority: .utility) { try? client.networkUp() }
    }
}
