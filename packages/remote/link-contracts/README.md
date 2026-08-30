---
description: "Executable contract for the remote link wire vocabulary: zod schemas pinned to the protocol types, golden fixtures, and the generator emitting the cross-language manifest, Swift, and Kotlin models native companions are checked against."
kind: "package-reference"
---

# @deepseek-ai/dsh-link-contracts

English | [中文](README.zh.md)

## Summary

`dsh-link-contracts` is the single source of truth native companions compile against: one declarative table names every wire type of the link vocabulary — pairing payload, pair response, host description with its capability objects, carrier status, device record, the administration status row, and the companion-rendered session-event payloads (turn and step spans, user and assistant messages, tool calls and results, packed chunk rows, plan/todo/goal state) — and one golden fixture per entry fixes the exact wire bytes. The zod schemas are pinned to the TypeScript protocol types at compile time, so a wire-type change fails typecheck here first; the generator then emits the language-neutral manifest with fixture checksums plus Swift `Codable` and Kotlin data models, and a drift gate fails CI until regenerated artifacts are committed.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The generator runs from the repository root (it also syncs the `apps/apple` copies); the drift gate rides the `hygiene` aggregate.

```sh
pnpm run gen-link-contracts      # regenerate manifest + Swift + Kotlin + conformance scenarios
pnpm run verify-link-contracts   # fail when committed artifacts are stale
```

### Observable behavior

A wire-type change surfaces twice: the zod schemas stop satisfying the protocol types (typecheck), and the regenerated manifest, Swift, or Kotlin text stops matching the committed files (the drift gate). The generator also syncs the Swift models and the fixture JSONs into `apps/apple`, where the Shared Apple Remote Core and its fixture-replay tests consume them under the same gate. Fixtures round-trip through the schemas in the unit suite, and every emitted checksum names the fixture it pins, so a companion's decoder test can rely on the same bytes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- **Table, not reflection.** The declarative table in `src/index.ts` names every type, field, kind, constant, and optionality explicitly; the emitter stays pure string work with no filesystem access, so the drift gate compares byte-for-byte.
- **Three pins per type.** Protocol interface (the real contract), zod schema (`satisfies z.ZodType<…>`), and fixture (`satisfies` the interface) — any drift between them is a compile error before it is a gate failure.
- **Const fields stay fields.** Version and kind constants emit as documented scalar fields, not hardcoded decoder branches, so a protocol bump changes the manifest diff visibly.
- **Session events pin the host vocabulary.** Each event-payload fixture satisfies the real `SessionEventMap` member (the plugin merges for `plan/mode`, `todo/write`, and `goal/change` included), so a host-side payload change fails typecheck here first; `sessionEvents`/`chunkRows` tags on a row must be values of the `LinkSessionEventKind`/`LinkChunkRowKind` enums, and the emitter rejects any other tag.
- **Lite Behavior Spec.** `foldLiteDomain` is the reference fold of an on-device Native Harness Lite runtime's lifecycle events (prompt, streaming, cancel, tool call/result, plan, todo, artifact, provider and network errors, handoff — plan chapters 33/34/63) into its domain state; `generated/lite-conformance/<id>.json` pairs each golden keyless event sequence with the derived expected state under the same drift gate, ready for the Swift and Kotlin Lite runtimes to replay. Behavior compatible, never implementation identical.
- **Domain-state conformance scenarios.** `foldCompanionDomain` is the reference fold of follow records into the companion domain state (timeline summaries, plan/todo/goal, tool trajectory); `generated/conformance/<id>.json` pairs each golden record sequence with the state it derives, so a native fold replaying the same bytes must reach exactly the TypeScript result — plan chapter 62's "same fixture, same domain state" guarantee, under the same drift gate.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Type table, fixtures, zod schemas pinned to the protocol types |
| [`src/generate.ts`](src/generate.ts) | Pure emitter for the manifest, Swift, and Kotlin artifacts |
| [`src/companion-fold.ts`](src/companion-fold.ts) | Reference domain-state fold over follow records |
| [`src/lite-spec.ts`](src/lite-spec.ts) | Lite Behavior Spec: event vocabulary, reference fold, golden scenarios |
| [`src/companion-scenarios.ts`](src/companion-scenarios.ts) | Golden conformance scenarios and their emitter |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: pure contract library) |
| [`generated/`](generated/) | Emitted manifest, Swift, Kotlin, fixtures, and conformance scenarios — never hand-edited |

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

- **Emitting models only, no transport** — the artifacts are decoders and encoders; networking, storage, and UI arrive with the Phase 2 companion apps.
- **Closed event subset** — the table models the companion-rendered session events, not the merge-extensible `SessionEventMap` at large; unknown event tags stay wire-valid and render generically, and variant fields beyond the modeled ones (for example a turn-end error chain) are ignored by the generated decoders.
- **Numbers as doubles** — timestamps and versions emit as floating-point scalars in both languages; exact integer handling arrives if a wire value ever exceeds double precision.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
