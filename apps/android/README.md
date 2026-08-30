# DSH Android Companion

English | [中文](README.zh.md)

The Android companion (nativization plan chapters 52 and 60): `core` is the pure-JVM domain module today, and the Compose surface grows over it later.

## Layout

| Path | What it is |
| --- | --- |
| [`core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt`](core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt) | The generated contract models, synced by `pnpm run gen-link-contracts` and byte-gated by `verify-link-contracts` |
| [`core/…/companion/DomainFold.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/DomainFold.kt) | The Kotlin half of the chapter-62 domain-state fold: the same conformance fixtures TypeScript and Swift replay, folded identically |
| [`core/…/companion/NeumorphicTokens.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/NeumorphicTokens.kt) | The Minimal Neumorphic-only visual baseline (chapter 60): one style, dual-tone raised surfaces |
| [`core/…/link/LinkWire.kt`](core/src/main/kotlin/ai/deepseek/dsh/link/LinkWire.kt) and its siblings | The wire client half: pass-through JSON values and envelopes, Ed25519 signing through the JDK provider, SPKI pinning over a leaf certificate, and `LinkClient` pair/describe/call/stream — tested against a real local HTTP server |
| [`core/src/test/resources/`](core/src/test/resources/) | The synced golden fixtures, conformance scenarios, and pinning certificate the tests replay |

## Building and testing

The [Android Kotlin](../.github/workflows/android-kotlin.yml) lane runs `gradle test` on Ubuntu (JDK 17, Gradle 8.14, no committed wrapper); locally the same works with any Gradle 8.14+ on a JDK 17 toolchain.

## Known Limitations and Deferred Work

- **No app modules yet** — the Compose UI over `core` arrives with the companion surface; the visual baseline is tokens only.
- **Handshake pinning deferred** — `LinkPinning` verifies a leaf certificate's SPKI fingerprint, but wiring it into the TLS handshake rides the app module's OkHttp stack; the JDK `HttpClient` here does not pin.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
