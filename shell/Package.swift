// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "NovaShell",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "NovaShell",
            path: "Sources/NovaShell"
        ),
        .testTarget(
            name: "NovaShellTests",
            dependencies: ["NovaShell"],
            path: "Tests/NovaShellTests"
        ),
    ]
)
