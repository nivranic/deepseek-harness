// swift-tools-version: 5.9
// The Apple Remote Companion: SharedAppleRemoteCore carries the link-client
// state machine (pair, SPKI pinning, signed RPC, NDJSON streams); CompanionUI
// carries the SwiftUI application layer (session UI, approvals, plan/todo/
// goal surfaces, dual visual themes) over view models that depend only on a
// wire-driving protocol, so the whole layer tests without a host. The app
// shells (iOS/iPadOS/macOS) are thin Xcode hosts over CompanionUI.
import PackageDescription

let package = Package(
    name: "SharedAppleRemoteCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "SharedAppleRemoteCore", targets: ["SharedAppleRemoteCore"]),
        .library(name: "CompanionUI", targets: ["CompanionUI"]),
    ],
    targets: [
        .target(
            name: "SharedAppleRemoteCore",
            path: "Sources/SharedAppleRemoteCore"
        ),
        .testTarget(
            name: "SharedAppleRemoteCoreTests",
            dependencies: ["SharedAppleRemoteCore"],
            path: "Tests/SharedAppleRemoteCoreTests",
            resources: [
                .copy("Fixtures"),
            ]
        ),
        .target(
            name: "CompanionUI",
            dependencies: ["SharedAppleRemoteCore"],
            path: "Sources/CompanionUI"
        ),
        .testTarget(
            name: "CompanionUITests",
            dependencies: ["CompanionUI", "SharedAppleRemoteCore"],
            path: "Tests/CompanionUITests"
        ),
    ]
)
