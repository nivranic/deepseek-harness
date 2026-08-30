# DSH Android Companion

English | [中文](README.zh.md)

The Android companion (nativization plan chapters 52 and 60): `core` is the pure-JVM domain and wire module, and `app` is the Compose seven-tab surface over it — pairing first, then 会话/审批/计划/工具/文件/工件/子代理 under the Minimal Neumorphic baseline.

## Layout

| Path | What it is |
| --- | --- |
| [`core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt`](core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt) | The generated contract models, synced by `pnpm run gen-link-contracts` and byte-gated by `verify-link-contracts` |
| [`core/…/companion/DomainFold.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/DomainFold.kt) | The Kotlin half of the chapter-62 domain-state fold: the same conformance fixtures TypeScript and Swift replay, folded identically; the artifacts pane consumes the Lite artifact/created and artifact/status vocabulary (chapter 56) |
| [`core/…/companion/LiteFold.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteFold.kt) | The Kotlin half of the Lite Behavior-Spec fold (chapters 33/34/63): the same lite-conformance fixtures the TypeScript reference fold and the Swift Lite fold replay — cancel preserves the prefix, a dropped transport keeps the partial, tools pair by id — the foundation of the embedded-host-runtime stage |
| [`core/…/companion/LiteToolRegistry.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteToolRegistry.kt) | The Lite static tool registry (chapter 36): compile-time bundled web_search/url_fetch/image_inspect/attachment_read/artifact_create/calculator, run_tests handing off through LITE_REQUIRES_FULL_RUNTIME, unknown names returning null — never dynamic dispatch |
| [`core/…/companion/LiteLoop.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteLoop.kt) | The Lite loop driver (chapter 34): prompt→streamed chunks→tool dispatch (registry-checked, handoff names stop without executing)→message/turn completion over the LiteProviding seam; cancellation folds turn/cancelled and thrown failures split provider/network into the error vocabulary — testable with the ScriptedLiteProvider double |
| [`core/…/companion/LiteStores.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteStores.kt) | Lite persistence: the `LiteSession` event-sourced journal (replay through LiteFold restores the whole state), `LiteFileSessionStore`'s one `<id>.litejournal append-only JSON-lines file with atomic replace, and the `LiteFileArtifactStore` resource channel's atomic `<id>.artifact` writes (chapters 11/56) |
| [`core/…/companion/LiteArtifactReading.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteArtifactReading.kt) | The chapter-56 resource-channel consumption face: read bytes by id and decide the presentation — markdown/text/report/patch render their text directly, every other kind shows type and byte size, a missing id is the honest empty state; the chat surface's artifact rows read on demand |
| [`core/…/companion/LiteChat.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteChat.kt) and [`app/…/LiteChatScreen.kt`](app/src/main/kotlin/ai/deepseek/dsh/companion/LiteChatScreen.kt) | The Lite chat surface: `send()` drives one turn, journals the turn's outcome events, persists, and restores by journal replay on relaunch; the Compose screen renders LiteDomainState live through the `liveState` StateFlow — per-event streaming partials and tool phases during a turn, journal replay between turns (mirrors Apple's LiteChatView) |
| [`core/…/companion/LiteHTTPProvider.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteHTTPProvider.kt) | The Lite real provider: OpenAI-compatible streaming chat completions over the JDK HttpClient — SSE `data:`/`[DONE]`/bare-NDJSON line parsing, reasoning_content/content/tool-call deltas, fragment assembly by index; transport failures map to timeout/unreachable/dropped and non-2xx refusals to Provider — loop-tested against a real local HTTP server |
| [`core/…/companion/NeumorphicTokens.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/NeumorphicTokens.kt) | The Minimal Neumorphic-only visual baseline (chapter 60): one style, dual-tone raised surfaces |
| [`core/…/link/LinkWire.kt`](core/src/main/kotlin/ai/deepseek/dsh/link/LinkWire.kt) and its siblings | The wire client half: pass-through JSON values and envelopes, Ed25519 signing through the JDK provider, SPKI pinning over a leaf certificate, and `LinkClient` pair/describe/call/stream — tested against a real local HTTP server |
| [`core/…/companion/CompanionModels.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/CompanionModels.kt) | The view models — session fold/prompt/cancel, interaction inbox, files browsing with UTF-16 paged reads, subagent listing — each driving the `WireDriving` seam a FakeWire tests |
| [`core/…/companion/FileChanges.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/FileChanges.kt) | The projection from the tool trajectory to read-only file changes (chapter 55, first version): each completed write/edit/str_replace_editor call becomes one hunk, +N/−M counts and added/removed lines expanding in the tools tab |
| [`core/…/companion/CompanionPush.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/CompanionPush.kt) | The chapter-70 minimal push chain: `$events` forwards fold into reference-data-only pushes (approval waiting, question waiting, task completed), device-side localized titles, local-notification presentation, relay (APNs/FCM) deferred |
| [`core/…/companion/NotificationGrant.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/NotificationGrant.kt) | The chapter-70 runtime grant projection (Android 13+ asks for POST_NOTIFICATIONS at runtime): the system enablement read, whether this process asked, and the user's last answer — presenting follows system enablement, the ask fires once per process; the app-side `NotificationGrantController` holds the StateFlow against the system dialog |
| [`core/…/companion/RelayRendezvous.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/RelayRendezvous.kt) and [`core/…/companion/RelayClient.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/RelayClient.kt) | The relay rendezvous foundation (chapters 68/69): `RelayRendezvous`'s in-memory single-account forwarding — device registration (with the pushToken slot), reference-only envelope fan-out to the account's devices, drain-by-poll; `RelayClient` the HTTP consumer loop-tested against a real server; envelopes bridge onto the chapter-70 push vocabulary via `asPush()`; the self-hostable shell lives at [`apps/relay`](../relay/README.md) |
| [`app/`](app/src/main/kotlin/ai/deepseek/dsh/companion/MainActivity.kt) | The Compose shell: pairing screen, the six-tab scaffold, and the Minimal Neumorphic theme from the core tokens |
| [`core/src/test/resources/`](core/src/test/resources/) | The synced golden fixtures, conformance scenarios, and pinning certificate the tests replay |

## Building and testing

The [Android Kotlin](../.github/workflows/android-kotlin.yml) lane runs `gradle test` and `:app:assembleDebug` on Ubuntu (JDK 17, Gradle 8.14, no committed wrapper, the runner's Android SDK); locally the same works with any Gradle 8.14+ on a JDK 17 toolchain plus an Android SDK.

## Known Limitations and Deferred Work

- **Lifecycle-aware collection** — the tabs collect the models' StateFlows with `collectAsStateWithLifecycle`, so collection pauses in stopped states instead of burning work in the background.
- **Handshake pinning deferred** — `LinkPinning` verifies a leaf certificate's SPKI fingerprint, but wiring it into the TLS handshake rides the app module's OkHttp stack; the JDK `HttpClient` here does not pin. The signing key itself persists only under AndroidKeyStore AES/GCM seal through the `CredentialsCipher` seam.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
