---
description: "Artifact storage seam and the model-facing artifact_create tool for maintainers wiring first-class artifacts onto the journal."
kind: "package-reference"
---

# @deepseek-ai/dsh-artifact

English | [中文](README.zh.md)

## Summary

This package is the artifact host face: the `ctx.artifacts` resource channel plus the model-facing `artifact_create` and `artifact_read` tools. One call authors one complete artifact — text through `content` or raw bytes through base64 `data`, exactly one of the two — and the journal records the reference, its kind, title, authoring format, and lifecycle status (`artifact/created`, `artifact/status`), while the complete content bytes go to the resource channel and never ride an event (chapter 56). The shipped `dsh` composition enables this with no setup; artifacts survive restarts and companion surfaces render the pane from the journaled references. The branded `ArtifactId`, the `ArtifactFormat` discriminant, and the two `SessionEventMap` members live here too, so contract fixtures and native folds pin the wire shapes.

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

Artifacts work end to end in the default composition: the model calls `artifact_create` with a kind, a title, and the complete content — `content` text or base64 `data` bytes — and the artifact is stored and journaled without further action. When you compose your own setup, mount the tool package with a resource-channel backend:

```yaml
- name: '@deepseek-ai/dsh-artifact'
- name: '@deepseek-ai/dsh-artifact-local'
```

Take a type-only edge on `@deepseek-ai/dsh-artifact/types` where a program needs the `SessionEventMap` merge in scope, and the `ArtifactId` constructor where a fixture mints a reference.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/index.ts` declares the `ArtifactStore` service (`put`/`get`/`remove` by reference id — chapter 56's resource channel) and registers the tools: `artifact_create` requires an owning agent session, trims and validates kind and title, rejects anything but exactly one of `content`/`data`, decodes base64 strictly (ASCII whitespace tolerated, any other non-canonical input fails loud), journals `artifact/created` with the authoring `format`, writes the bytes through the channel, and journals `artifact/status` — `ready` on success, `failed` with the storage failure surfaced when the channel refuses. `artifact_read` picks its arm from the journaled format: text pages by UTF-16 code unit into `content`, raw bytes — or an id this session never journaled, where the format is unknowable — page by byte into base64 `data`, both with `truncated`/`size`. `src/types.ts` holds the branded identity, the three-state `ArtifactStatus`, the `ArtifactFormat` discriminant, and the declaration merge onto `@deepseek-ai/dsh-session/types`; `src/invariant.ts` enforces the durable shape (non-empty trimmed kind and title, the closed status and format sets) and the open-turn relationship, staying silent on orphan statuses — a legal no-op in every fold.

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

The model sees the generated [`artifact_create` schema](../../../docs/tool-catalog.md#deepseek-aidsh-artifact): an object with required `kind` and `title` strings, plus `content` and `data` strings where exactly one must be supplied — text content, or base64-encoded bytes. The description instructs one complete artifact per call and forbids scratch text or splitting across calls.

#### Token effect

Fixed schema cost on every request where the tool is visible; the description and schema are static.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool schema — artifact_read

#### What the model sees

The model also sees the generated [`artifact_read` schema](../../../docs/tool-catalog.md#deepseek-aidsh-artifact): an object with a required `id` string and optional `offset`/`limit` integers whose units follow the artifact's format — UTF-16 code units for text, bytes for raw. The description states that reading does not modify the artifact.

#### Token effect

Fixed schema cost on every request where the tool is visible; the description and schema are static.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains the full artifact content in its arguments — the text itself, or its base64 encoding (roughly four characters per three bytes) for a bytes artifact. Success returns exactly `Artifact ready: <title> (<kind>, <format>) — <id>`. Stable failures are `Error: artifact_create requires a non-empty kind and title`, `Error: artifact_create requires an owning agent session`, `Error: artifact_create requires exactly one of content or data`, and `Error: artifact_create requires data to be base64-encoded bytes`; a storage failure surfaces the channel's error text. The `artifact/created` and `artifact/status` session events are UI and replay state, not a second model message.

#### Token effect

Token growth scales with the artifact content the model submits — base64 inflates raw bytes by a third — and those call arguments remain until compaction. The result itself is small and fixed-shape.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Tool-call history and result — artifact_read

#### What the model sees

A read returns the artifact's header line plus its content in the journaled arm — a text artifact returns its `content` (the whole artifact by default, or one UTF-16 range with `offset` and `limit`), a bytes artifact returns base64 `data` over a byte range — with `kind` and `title` when the calling session journaled the artifact; an id this session never journaled falls to the base64 arm because the authoring format is unknowable there (`truncated` and `size` report the cut in the arm's units). The stable failures are `Error: artifact_read requires a non-empty id`, `Error: artifact_read offset and limit must be non-negative`, and `Error: artifact_read found no content stored under id "<id>"`.

#### Token effect

A default read places the artifact's full content into the conversation — base64-inflated for bytes artifacts; a paged read costs only its range. Repeated default reads of large artifacts cost their size every time until compaction.

#### KV Cache effect

Append-only; the read result follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Stored bytes have no retention policy yet: nothing prunes or garbage-collects artifacts whose sessions end, so `DSH_HOME/artifacts` grows without bound.
- One call carries the complete artifact; there is no streaming or multipart authoring for artifacts larger than a single tool call.

### Dev Note

<a id="dev-note"></a>

The event shapes deliberately match the Lite artifact vocabulary already pinned by the cross-language conformance fixtures, so the three companion folds consume host events and Lite events through one set of branches.
