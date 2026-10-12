/// The shell's own small state, in `~/Library/Application Support/Nova/shell.json`.
/// Today only the day the morning digest was shown, so a relaunch never shows
/// it twice. A missing or unreadable file reads as empty.
import Foundation

struct ShellSettings: Codable {
    var digestShownOn: String?

    private static var url: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Nova/shell.json")
    }

    static func load() -> ShellSettings {
        guard let data = try? Data(contentsOf: url),
              let s = try? JSONDecoder().decode(ShellSettings.self, from: data) else { return ShellSettings() }
        return s
    }

    func save() {
        let dir = Self.url.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(self) { try? data.write(to: Self.url, options: .atomic) }
    }
}
