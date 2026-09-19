// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "DSHContract",
    targets: [
        .target(name: "DSHContract"),
        .testTarget(name: "DSHContractTests", resources: [.copy("Resources/")]),
    ]
)
