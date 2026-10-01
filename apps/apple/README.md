# @deepseek-ai/dsh-apple

English | [中文](README.zh.md)

The downstream thin Apple companion home for DeepSeek Harness. The device is a Remote Companion first: it never runs the agent runtime and holds no second session truth. This project starts with the contract package that mirrors the shared Remote failure vocabulary; the native shell migrates onto it later.

## Use this project

The `contract` Swift package mirrors the candidate's Remote failure classification: `RemoteFailureClass` and `RemoteFailureClasses.classify(code)` mirror the TypeScript authority in `@deepseek-ai/dsh-typert-protocol`. Codes without shared semantics — including every future code from a newer Host — resolve to `unknown` and must stay presentable as opaque diagnostics. A class names what the Client may do next; it never grants capability, permission, retry policy, or protocol-version admission.

The self-check executable asserts the mirror equals the generated projection (`remote-failure-classes.json`), that every classified code is declared by [the Remote failure JSON Schema](../../packages/typert/protocol/remote-errors.schema.json), that the schema's opaque unknown branch excludes all 92 known codes, and that unclassified vocabulary resolves to `unknown`. Fixtures regenerate via `node scripts/gen-remote-failure-classes-json.mjs`; committed output is verified by the check, and drift fails it. Run with `swift run dsh-contract-check` inside `apps/apple/contract` (requires macOS with Xcode; CI runs it on the macOS lane).

The contract also adopts the section 28 native Host roster vocabulary: `NativeHostRoster.decode` mirrors `FileNativeHostStore` in the Android core — exact field sets, non-blank strings, the `native-gateway-v1` transport format, the four pairing roles, a 64-lowercase-hex pinned fingerprint, a 32-byte signing key, a canonical reachable HTTPS origin, distinct Host keys (`NativeHostRoster.hostKey`, SHA-256 of `[hostId, pinnedFingerprint]`), and an active key that names a saved identity. The Kotlin authority and this mirror consume the same fixture set (`fixtures/native-host-roster/`, one canonical document plus 14 rejected cases); `NativeHostCatalogTest` runs the identical bytes through the Android store, so acceptance and rejection stay in parity across both implementations.

The contract also adopts the section 30 model-selection vocabulary: `NativeModelCatalog.decode` mirrors `SessionModel.modelCatalog` in the Android core — provider groups of routable models with the same leniency (entries without a string id drop, names fall back to their id, a non-object `reasoning` field reads as absent, non-string default members read as empty), and `NativeModelSelection.wireBody()` mirrors `SessionModel.selectModel` (`session/selectModel` request envelope with `reasoningEffort` riding only when present, so an effort-free selection stays byte-identical to the pre-effort wire). The shared fixture set (`fixtures/native-model-catalog/`, one canonical document, three leniency edge cases, one malformed case) runs through `NativeModelCatalogFixtureTest` on the Kotlin side and the self-check on this side, so both parsers drop and fall back identically.

## Known Limitations and Deferred Work

Schema payload validation is not reimplemented in Swift; this package pins classification and schema-structure evidence only. No native shell, no simulator or device qualification, no store packaging, and no multi-version behavior is claimed. The wrapper requires macOS; this project cannot build on Windows or Linux hosts.
