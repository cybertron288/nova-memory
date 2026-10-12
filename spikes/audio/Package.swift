// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "nova-spike-audio",
    platforms: [.macOS(.v14)],
    targets: [.executableTarget(name: "spike-audio")]
)
