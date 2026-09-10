# Apple support scanner integration

English | [中文](2026-09-10-apple-support-scanner.zh.md)

## Scope

Provide the native Apple library required by [Support Bundle task 4](2026-09-08-support-bundle.md). Library packaging, native binding execution and application export are separate acceptance steps. The complete four-platform Support Bundle remains the final requirement.

## Selected implementation

Use the same [Go scanner](../../native/support-scanner/README.md) and pinned gomobile generator as Android. An independent Apple producer handles Xcode, static frameworks and platform-specific verification. Reusing the generated Objective-C interface retains the scanner's immutable-byte and joined-cancellation semantics. A custom C adapter adds an unnecessary ABI implementation; copying rules into Swift would create a second scanner.

The XCFramework contains iOS arm64, simulator arm64/x86_64 and macOS arm64/x86_64. [Apple build policy](../../native/support-scanner/apple-build.json) pins Xcode and deployment versions. The producer reads committed module files through the existing verified local proxy, inspects the actual Go object in each architecture's static archive and retains source, module checksums and licenses. Framework version links must match the generated layout exactly; archive metadata is canonicalized without rewriting native bytes.

The [native verifier](../../scripts/verify-apple-support-scanner.py) compares the exact package and compile inputs, links a Swift probe and runs it on macOS and an owned iOS simulator. It verifies approved-byte identity, mutation isolation, secret refusal and cancellation completion. Both linked binaries undergo the maintained Go vulnerability check. A static `BUILT` receipt cannot replace this execution evidence or establish physical-device acceptance.

## Application integration

Keep the scanning protocol and diagnostic projection independent of the binary framework. The native iOS and Mac Companion shells supply the actual scanner adapter to the existing SwiftUI composition. The full Mac Host continues to own its supervisor exporter. Export serializes all fields before scanning, performs scan and cancellation joins off the UI thread, and delivers only the approved bytes through the platform save operation.

Product acceptance must exercise unpaired and paired states, failed metadata collection, cancellation, scanner refusal and actual saved-byte scanning in the native application. Missing producers remain explicit; a successful library probe cannot close G2-SUPPORT. The application adapter and save flows follow the verified library, without changing Host authority or introducing another Session domain.

## Verification order

1. Run structural and builder rejection fixtures on Windows and Linux, including the existing Android packaging tests affected by shared metadata inspection.
2. Run the committed producer under its pinned macOS/Xcode configuration and retain all five architecture bindings, module inventory and package digests.
3. Execute the Swift probes against those exact framework bytes, scan both linked binaries and verify owned-simulator deletion.
4. Integrate the native application adapter and export UI, then verify the actual saved document and refusal paths.
5. Bind application, library, source and export evidence to the same candidate before evaluating the complete Support Bundle requirements.
