// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "nova-capture",
    platforms: [.macOS(.v14)],
    targets: [
        .target(name: "NovaCaptureKit"),
        .executableTarget(name: "nova-capture", dependencies: ["NovaCaptureKit"]),
        .testTarget(name: "NovaCaptureKitTests", dependencies: ["NovaCaptureKit"]),
    ]
)
