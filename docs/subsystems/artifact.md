# Durable Artifacts

English | [中文](artifact.zh.md)

Artifacts separate durable user-facing output bytes from the Session journal. The `artifact_create` tool appends an opaque reference and metadata, writes the complete content through [`ctx.artifacts`](#ctxartifacts--artifactstore-abstract-seam), then appends a ready or failed status. Journal events and Remote projections carry only the reference, kind, title, format, and status; content bytes never enter the Session log.

Source: [`packages/artifact/artifact/src/types.ts`](../../packages/artifact/artifact/src/types.ts)

## Identity and lifecycle

`ArtifactId` is an opaque branded string shared by the journal and the content channel. Its portable representation is `art-` plus an ASCII letter/digit/hyphen body that starts and ends with a letter or digit, with a 128-character total limit. Model input, durable events, and filesystem providers validate that representation independently; consumers otherwise do not parse the id, and only a provider derives its fixed storage name. `text` artifacts page by UTF-16 code units when a Session-journaled reference proves the format; `bytes` artifacts page by byte and return base64. A missing content object fails instead of becoming empty content.

`artifact/created` publishes the id, kind, title, and `text | bytes` format before the provider write begins. `artifact/status` records `ready` after the write succeeds or `failed` after it rejects. The Session Remote controller proves that the addressed Session journaled the reference before it fetches bytes. `ctx.artifacts` itself is reference-keyed and does not authorize callers.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxartifacts--artifactstore-abstract-seam"></a>

### `ctx.artifacts` — `ArtifactStore` (abstract seam)

Durable artifact content channel — chapter 56's resource channel. Journal events carry references only; the complete bytes of one artifact live here, keyed by the reference identity `artifact/created` minted.

```ts cordis-catalog
/**
 * Durably write one artifact's complete content bytes under its id.
 * @param id - the artifact reference identity from `artifact/created`.
 * @param data - the complete content bytes.
 */
abstract put(id: ArtifactId, data: Uint8Array): Promise<void>

/**
 * Read one artifact's content bytes back.
 * @param id - the artifact reference identity.
 * @returns the stored bytes, or null when nothing is stored under the id.
 */
abstract get(id: ArtifactId): Promise<Uint8Array | null>

/**
 * Remove one artifact's content bytes.
 * @param id - the artifact reference identity to delete.
 */
abstract remove(id: ArtifactId): Promise<void>
```

Source: [`packages/artifact/artifact/src/index.ts`](../../packages/artifact/artifact/src/index.ts)
<!-- END GENERATED cordis-surface -->
