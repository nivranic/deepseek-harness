---
description: "Executable contract for the remote link wire vocabulary: protocol-pinned zod schemas, golden fixtures, and generated JSON Schema, manifest, Swift, and Kotlin models."
kind: "package-reference"
---

# @deepseek-ai/dsh-link-contracts

English | [中文](README.zh.md)

## Summary

`dsh-link-contracts` is the single source of truth native companions compile against. One declarative source graph names the authenticated unary envelope (`payload.args`), NDJSON stream request and value/error frames, Remote Event ready/emit/waterfall/cancel/result vocabulary, durable Session sequence and snapshot cursor semantics, pairing and host-description values, companion-rendered Session payloads, workspace-file values, subagent values, attachments, artifacts, and handoff values. Golden fixtures pin every semantic variant, including successful void results and structured rejections. Protocol-pinned zod schemas reject missing required fields while ignoring JSON-safe unknown optional fields; the generator emits a machine-readable JSON Schema, a language-neutral manifest with checksums and compatibility rules, Swift `Codable`, and Kotlin models. The drift gate fails CI until every derivative is regenerated from that same graph.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The generator runs from the repository root (it also syncs the Apple and Android copies); the drift gate rides the `hygiene` aggregate.

```sh
pnpm run gen-link-contracts      # regenerate manifest + Swift + Kotlin + conformance scenarios
pnpm run verify-link-contracts   # fail when committed artifacts are stale
```

### Observable behavior

A wire-type change surfaces twice: the zod schemas stop satisfying the protocol types (typecheck), and the regenerated JSON Schema, manifest, Swift, Kotlin, or fixture text stops matching the committed files (the drift gate). The manifest carries independent `protocolVersion`, `contractVersion`, and `sessionFormatVersion` axes, the authenticated routes and headers, supported capabilities, compatibility rules, and recovery semantics. Generated fixtures are consumed by the real Gateway and TLS carrier tests before the same bytes are copied into both native test trees.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- **Graph, not reflection.** The declarative graph in `src/index.ts` names every type, field, kind, constant, optionality, fixture variant, route, header, capability, version, and compatibility rule explicitly; the emitter stays pure string work with no filesystem access, so the drift gate compares byte-for-byte.
- **Four pins per type.** Protocol interface, zod schema (`satisfies z.ZodType<…>`), fixture (`satisfies` the interface), and generated JSON Schema — typed drift fails before or during the generator gate.
- **JSON pass-through stays explicit.** Recursive JSON values reject `undefined`, non-finite values, negative zero, bigint, symbols, functions, and cycles. Unknown optional object fields are accepted and discarded, missing required or invalid discriminant fields remain errors, and the Host parser separately rejects reserved fields from another outcome variant.
- **Recovery is recorded, not invented by a client.** Session event sequence numbers are monotonic, snapshot `cursor` is the highest included sequence, and replay ignores records at or below that cursor. Stream cancellation is the transport abort rather than another wire frame.
- **Const fields stay fields.** Version and kind constants emit as documented scalar fields, not hardcoded decoder branches, so a protocol bump changes the manifest diff visibly.
- **Session events pin the host vocabulary.** Each event-payload fixture satisfies the real `SessionEventMap` member (the plugin merges for `plan/mode`, `todo/write`, and `goal/change` included), so a host-side payload change fails typecheck here first; `sessionEvents`/`chunkRows` tags on a row must be values of the `LinkSessionEventKind`/`LinkChunkRowKind` enums, and the emitter rejects any other tag.
- **Lite Behavior Spec.** `foldLiteDomain` is the reference fold of an on-device Native Harness Lite runtime's lifecycle events (prompt, streaming, cancel, tool call/result, plan, todo, artifact, provider and network errors, handoff — plan chapters 33/34/63) into its domain state; `generated/lite-conformance/<id>.json` pairs each golden keyless event sequence with the derived expected state under the same drift gate, ready for the Swift and Kotlin Lite runtimes to replay. Behavior compatible, never implementation identical.
- **Domain-state conformance scenarios.** `foldCompanionDomain` is the reference fold of follow records into the companion domain state (timeline summaries, plan/todo/goal, tool trajectory); `generated/conformance/<id>.json` pairs each golden record sequence with the state it derives, so a native fold replaying the same bytes must reach exactly the TypeScript result — plan chapter 62's "same fixture, same domain state" guarantee, under the same drift gate.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Type table, fixtures, zod schemas pinned to the protocol types |
| [`src/generate.ts`](src/generate.ts) | Pure emitter for the JSON Schema, manifest, Swift, and Kotlin artifacts |
| [`src/companion-fold.ts`](src/companion-fold.ts) | Reference domain-state fold over follow records |
| [`src/lite-spec.ts`](src/lite-spec.ts) | Lite Behavior Spec: event vocabulary, reference fold, golden scenarios |
| [`src/companion-scenarios.ts`](src/companion-scenarios.ts) | Golden conformance scenarios and their emitter |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: pure contract library) |
| [`generated/`](generated/) | Emitted JSON Schema, manifest, Swift, Kotlin, fixtures, and conformance scenarios — never hand-edited |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Remote link access subsystem](../../../docs/subsystems/remote-link.md) — the wire vocabulary these types mirror.
- [link-access carrier](../link-access/README.md) — the protocol owner of the mirrored types.
- [remote/ package map](../README.md) — the group's packages and their repository position.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No socket or lifecycle ownership** — the contract defines carrier bytes and recovery rules, but the Gateway, TLS carrier, and native clients continue to own dispatch, sockets, authentication, reconnect scheduling, storage, and UI.
- **Closed event subset** — the table models the companion-rendered session events, not the merge-extensible `SessionEventMap` at large; unknown event tags stay wire-valid and render generically, and variant fields beyond the modeled ones (for example a turn-end error chain) are ignored by the generated decoders.
- **Numbers as doubles** — timestamps and versions emit as floating-point scalars in both languages; exact integer handling arrives if a wire value ever exceeds double precision.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
