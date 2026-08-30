# DSH Android Companion

English | [中文](README.zh.md)

The Android companion (nativization plan chapters 52 and 60): `core` is the pure-JVM domain module today, and the Compose surface grows over it later.

## Layout

| Path | What it is |
| --- | --- |
| [`core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt`](core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt) | The generated contract models, synced by `pnpm run gen-link-contracts` and byte-gated by `verify-link-contracts` |
| [`core/…/companion/DomainFold.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/DomainFold.kt) | The Kotlin half of the chapter-62 domain-state fold: the same conformance fixtures TypeScript and Swift replay, folded identically |
| [`core/…/companion/NeumorphicTokens.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/NeumorphicTokens.kt) | The Minimal Neumorphic-only visual baseline (chapter 60): one style, dual-tone raised surfaces |
| [`core/src/test/resources/`](core/src/test/resources/) | The synced golden fixtures and conformance scenarios the tests replay |

## Building and testing

The [Android Kotlin](../.github/workflows/android-kotlin.yml) lane runs `gradle test` on Ubuntu (JDK 17, Gradle 8.14, no committed wrapper); locally the same works with any Gradle 8.14+ on a JDK 17 toolchain.

## Known Limitations and Deferred Work

- **No app modules yet** — the Compose UI over `core` arrives with the companion surface; the visual baseline is tokens only.
- **JsonElement decoding only** — the generated models carry no serialization annotations; the fold parses JSON trees by hand, and full wire-client work arrives with the Compose modules.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
