// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "DSHContract",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "DSHContract"),
        .testTarget(name: "DSHContractTests", resources: [.copy("Resources")]),
    ]
)
