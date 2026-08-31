---
description: "Artifact storage seam and the model-facing artifact_create tool for maintainers wiring first-class artifacts onto the journal."
kind: "package-reference"
---

# @deepseek-ai/dsh-artifact

English | [中文](README.zh.md)

## Summary

This package is the artifact host face: the `ctx.artifacts` resource channel plus the model-facing `artifact_create` and `artifact_read` tools. One call authors one complete artifact — the journal records the reference, its kind and title, and its lifecycle status (`artifact/created`, `artifact/status`), while the complete content bytes go to the resource channel and never ride an event (chapter 56). The shipped `dsh` composition enables this with no setup; artifacts survive restarts and companion surfaces render the pane from the journaled references. The branded `ArtifactId` and the two `SessionEventMap` members live here too, so contract fixtures and native folds pin the wire shapes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Artifacts work end to end in the default composition: the model calls `artifact_create` with a kind, a title, and the complete content, and the artifact is stored and journaled without further action. When you compose your own setup, mount the tool package with a resource-channel backend:

```yaml
- name: '@deepseek-ai/dsh-artifact'
- name: '@deepseek-ai/dsh-artifact-local'
```

Take a type-only edge on `@deepseek-ai/dsh-artifact/types` where a program needs the `SessionEventMap` merge in scope, and the `ArtifactId` constructor where a fixture mints a reference.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/index.ts` declares the `ArtifactStore` service (`put`/`get`/`remove` by reference id — chapter 56's resource channel) and registers the tool: it requires an owning agent session, trims and validates kind and title, mints the reference, journals `artifact/created`, writes the bytes through the channel, and journals `artifact/status` — `ready` on success, `failed` with the storage failure surfaced when the channel refuses. `src/types.ts` holds the branded identity, the three-state `ArtifactStatus`, and the declaration merge onto `@deepseek-ai/dsh-session/types`; `src/invariant.ts` enforces the durable shape (non-empty trimmed kind and title, the closed status set) and the open-turn relationship, staying silent on orphan statuses — a legal no-op in every fold.

<a id="further-exploration"></a>
## Further Exploration

- [Tool schema catalog](../../../docs/tool-catalog.md#deepseek-aidsh-artifact) — the generated `artifact_create` schema the model receives.
- [Local artifact backend](../artifact-local/README.md) — the shipped resource channel below `DSH_HOME`.
- [Session event vocabulary](../../core/session/README.md) — the merge-extensible `SessionEventMap` this package extends.
- [Companion fold](../../remote/link-contracts/README.md) — the reference fold that consumes these events into the artifact pane.

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`artifact_create` schema](../../../docs/tool-catalog.md#deepseek-aidsh-artifact): an object with required `kind`, `title`, and `content` strings. The description instructs one complete artifact per call and forbids scratch text or splitting across calls.

#### Token effect

Fixed schema cost on every request where the tool is visible; the description and schema are static.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool schema — artifact_read

#### What the model sees

The model also sees the generated [`artifact_read` schema](../../../docs/tool-catalog.md#deepseek-aidsh-artifact): an object with a required `id` string and optional `offset`/`limit` integers. The description offers one UTF-16 range per call and states that reading does not modify the artifact.

#### Token effect

Fixed schema cost on every request where the tool is visible; the description and schema are static.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains the full artifact content in its arguments. Success returns exactly `Artifact ready: <title> (<kind>) — <id>`. Stable failures are `Error: artifact_create requires a non-empty kind and title` and `Error: artifact_create requires an owning agent session`; a storage failure surfaces the channel's error text. The `artifact/created` and `artifact/status` session events are UI and replay state, not a second model message.

#### Token effect

Token growth scales with the artifact content the model submits, and those call arguments remain until compaction. The result itself is small and fixed-shape.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Tool-call history and result — artifact_read

#### What the model sees

A read returns the artifact's header line plus its content — the whole artifact by default, or one UTF-16 range with `offset` and `limit` (`truncated` and `size` report the cut) — with `kind` and `title` when the calling session journaled the artifact. The stable failures are `Error: artifact_read requires a non-empty id`, `Error: artifact_read offset and limit must be non-negative`, and `Error: artifact_read found no content stored under id "<id>"`.

#### Token effect

A default read places the artifact's full content into the conversation; a paged read costs only its range. Repeated default reads of large artifacts cost their size every time until compaction.

#### KV Cache effect

Append-only; the read result follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Artifacts are textual in this first version: `content` is a string and the channel stores its UTF-8 bytes; binary artifacts need a future binary input surface.

### Dev Note

<a id="dev-note"></a>

The event shapes deliberately match the Lite artifact vocabulary already pinned by the cross-language conformance fixtures, so the three companion folds consume host events and Lite events through one set of branches.
