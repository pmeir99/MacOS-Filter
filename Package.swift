// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MacOS-Filter",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "FilterCore", targets: ["FilterCore"]),
        .executable(name: "FilterHost", targets: ["FilterHost"]),
        .executable(name: "MacOSFilter", targets: ["MacOSFilterApp"])
    ],
    targets: [
        .target(name: "FilterCore"),
        .target(name: "UpdateSupport"),
        .executableTarget(name: "FilterUpdate", dependencies: ["UpdateSupport"]),
        .executableTarget(name: "FilterHost", dependencies: ["FilterCore"]),
        .executableTarget(name: "MacOSFilterApp", dependencies: ["FilterCore", "UpdateSupport"]),
        .testTarget(name: "FilterCoreTests", dependencies: ["FilterCore"])
    ]
)
