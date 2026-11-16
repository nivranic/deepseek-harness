# Agent Note: The Lite multi-round request shape has a live-API e2e lane

Status: implemented

English | [中文](2026-10-23-live-model-e2e.zh.md)

- Date: 2026-10-23
- Class: testing
- Scope: `apps/web/tests` (`android-lite-live-round.e2e.ts`, `android-gateway-driver.ts`), `apps/android/core` (`NativeGatewayDriver.kt`)

## Problem

The keyless wire shape of the Lite multi-round request was already pinned on an embedded server (`LiteHTTPProviderTest` asserts the assistant tool_calls row, the per-id `role:"tool"` result rows, and the loop's continuation request byte-exactly), but nothing proved the real DeepSeek API accepts that shape. gen-63's note left the live API round to the e2e face, and §31 kept the real-model multi-round round as an open item. The gap mattered as de-risking: gen-76A/B's tool-row journal persistence replays these very rows after a restart, and a real API that refused the shape would send that design back to the drawing board.

## Decision

Close it as a double-gated owner-local scenario, `apps/web/tests/android-lite-live-round.e2e.ts`: `it.skipIf` on `DEEPSEEK_API_KEY` (repo e2e convention, self-skip without a key) and `DSH_ANDROID_JAVA` (the compiled-Kotlin-driver gate of `android-tool-catalog.e2e.ts`). The scenario drives one new `liteRound` op in `NativeGatewayDriver.kt` (test source set, the `toolDescriptors` precedent): the op assembles the round from the APK-bundled documents riding the driver's own classpath (the `copyLitePresets`/`copyToolDescriptors`/`copyLiteToolSchemas` test resources) — the default preset's assembled system prompt, the APK-frozen host+device schema union, the APK-frozen declaration union — then submits a calculator-forcing prompt through `LiteLoopDriver` over the real `LiteHTTPProvider` with the on-device calculator executor mounted, and answers with the folded state only (the credential travels the private stdin pipe and never reaches the output). The assertions: bundled-preset fidelity (preset id, system prompt, and schema-union order against the repo projection documents), the multi-round closure proof (the loop lands exactly one assistant row per completed request and only issues the next request on a `tool_calls` finish, so two or more assistant rows on a completed turn prove the continuation request — the one replaying the assistant tool_calls row and its role:tool result rows — was served rather than refused), at least one completed calculator call, a value tolerance (the exact calculator result `391` or the final text naming it — no verbatim assertions over model prose), `lastTurnEnd` completed, zero `errors` (every timeout/unreachable/dropped/HTTP refusal folds there), and no handoff marker. The shared `android-gateway-driver.ts` helper gains an optional per-request `timeoutMs` (default 15 s unchanged), because a live model round outlives the fixed wait.

## Alternatives considered

- An `assumeTrue(key)`-gated JUnit round in `:core:test`: it would grow the 85/609 JVM count that the e2e lane was explicitly kept out of, and it would leave the repo convention that real-API rounds live in self-skipping e2e lanes; the driver form also exercises the compiled production client shape the neighboring Android lanes use.
- A counting wrapper around the provider to assert the request count: the loop's assistant-row invariant already counts completed requests without touching the provider seam, so the wrapper would add a face the production path never has.
- Verbatim final-text assertions: rejected by the tolerance design — the model's prose is non-deterministic; only the arithmetic answer value and the structural round facts are asserted.

## Consequences

- The implementing machine holds no key (no root `.env`, no environment variable), so the real-model round is owner-local-pending: the scenario self-skips there (verified: one skipped test with `DSH_ANDROID_JAVA` set and the key absent). The op's plumbing is verified without any real-model claim — a local SSE stub round through both the raw driver and the TypeScript helper reproduces the two-request turn, the replayed assistant/tool rows, the calculator result, and the clean fold — and `tsc -b tsconfig.host.json` passes over the new files.
- `:core:test` stays at 85 suites / 609 tests and `:contract:test` at 4 / 37: the op is driver plumbing, not a JUnit test, matching the `toolDescriptors` precedent. The scanner-env gradle acceptance round over `:app:assembleDebug :app:assembleDebugAndroidTest :core:test :contract:test -PdshNativeAcceptance` came back BUILD SUCCESSFUL (38 s, 82 actionable tasks, 3 executed) with both APK faces replaying byte-identical at the gen-73 sealed digests (debug `995eeb31…`, androidTest `2c73cbb2…`) — zero production and zero androidTest input change. The reproduction used the sealed build's own unstamped acceptance form (scanner source `8ca9f6eb…` through `.artifacts/native-scanner-candidate-output`, no `DSH_ANDROID_APPLICATION_SOURCE`/`DSH_ANDROID_APPLICATION_TREE`), pinned by decoding the sealed APK's manifest placeholders directly.
- CI never runs the scenario (neither gate is set there); an owner run with both gates green is the live-API acceptance evidence gen-76A/B's restart-replay design was waiting on.
