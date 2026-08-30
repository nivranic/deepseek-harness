---
description: "Executable contract for the remote link wire vocabulary: zod schemas pinned to the protocol types, golden fixtures, and the generator emitting the cross-language manifest, Swift, and Kotlin models native companions are checked against."
kind: "package-reference"
---

# @deepseek-ai/dsh-link-contracts

English | [中文](README.zh.md)

## Summary

`dsh-link-contracts` is the single source of truth native companions compile against: one declarative table names every wire type of the link vocabulary — pairing payload, pair response, host description with its capability objects, carrier status, device record, and the administration status row — and one golden fixture per entry fixes the exact wire bytes. The zod schemas are pinned to the TypeScript protocol types at compile time, so a wire-type change fails typecheck here first; the generator then emits the language-neutral manifest with fixture checksums plus Swift `Codable` and Kotlin data models, and a drift gate fails CI until regenerated artifacts are committed.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The generator runs from the repository root; the drift gate rides the `hygiene` aggregate.

```sh
pnpm run gen-link-contracts      # regenerate manifest + Swift + Kotlin
pnpm run verify-link-contracts   # fail when committed artifacts are stale
```

### Observable behavior

A wire-type change surfaces twice: the zod schemas stop satisfying the protocol types (typecheck), and the regenerated manifest, Swift, or Kotlin text stops matching the committed files (the drift gate). Fixtures round-trip through the schemas in the unit suite, and every emitted checksum names the fixture it pins, so a companion's decoder test can rely on the same bytes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- **Table, not reflection.** The declarative table in `src/index.ts` names every type, field, kind, constant, and optionality explicitly; the emitter stays pure string work with no filesystem access, so the drift gate compares byte-for-byte.
- **Three pins per type.** Protocol interface (the real contract), zod schema (`satisfies z.ZodType<…>`), and fixture (`satisfies` the interface) — any drift between them is a compile error before it is a gate failure.
- **Const fields stay fields.** Version and kind constants emit as documented scalar fields, not hardcoded decoder branches, so a protocol bump changes the manifest diff visibly.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Type table, fixtures, zod schemas pinned to the protocol types |
| [`src/generate.ts`](src/generate.ts) | Pure emitter for the manifest, Swift, and Kotlin artifacts |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: pure contract library) |
| [`generated/`](generated/) | Emitted manifest, Swift, and Kotlin — never hand-edited |

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
- **Numbers as doubles** — timestamps and versions emit as floating-point scalars in both languages; exact integer handling arrives if a wire value ever exceeds double precision.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
