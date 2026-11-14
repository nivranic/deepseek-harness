// swift-tools-version:5.9
import PackageDescription

// One executable target on purpose: the hosted macOS runners fail test-target
// module imports nondeterministically (seventeen probe rounds on macos-14 and
// macos-15, both installed toolchains, serial and parallel builds), so the
// Swift column self-checks in a single module with plain exit codes instead of
// an XCTest bundle.
let package = Package(
    name: "DSHContract",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "dsh-contract-check", path: "Sources/DSHContract"),
    ]
)
