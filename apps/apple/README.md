# @deepseek-ai/dsh-apple

English | [中文](README.zh.md)

The downstream thin Apple companion home for DeepSeek Harness. The device is a Remote Companion first: it never runs the agent runtime and holds no second session truth. This project starts with the contract package that mirrors the shared Remote failure vocabulary; the native shell migrates onto it later.

## Use this project

The `contract` Swift package mirrors the candidate's Remote failure classification: `RemoteFailureClass` and `RemoteFailureClasses.classify(code)` mirror the TypeScript authority in `@deepseek-ai/dsh-typert-protocol`. Codes without shared semantics — including every future code from a newer Host — resolve to `unknown` and must stay presentable as opaque diagnostics. A class names what the Client may do next; it never grants capability, permission, retry policy, or protocol-version admission.

The self-check executable asserts the mirror equals the generated projection (`remote-failure-classes.json`), that every classified code is declared by [the Remote failure JSON Schema](../../packages/typert/protocol/remote-errors.schema.json), that the schema's opaque unknown branch excludes all 84 known codes, and that unclassified vocabulary resolves to `unknown`. Fixtures regenerate via `node scripts/gen-remote-failure-classes-json.mjs`; committed output is verified by the check, and drift fails it. Run with `swift run dsh-contract-check` inside `apps/apple/contract` (requires macOS with Xcode; CI runs it on the macOS lane).

## Known Limitations and Deferred Work

Schema payload validation is not reimplemented in Swift; this package pins classification and schema-structure evidence only. No native shell, no simulator or device qualification, no store packaging, and no multi-version behavior is claimed. The wrapper requires macOS; this project cannot build on Windows or Linux hosts.
