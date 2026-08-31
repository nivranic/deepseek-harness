---
description: "Artifact reference vocabulary for maintainers wiring artifact events onto the session journal or consuming them from a companion fold."
kind: "package-reference"
---

# @deepseek-ai/dsh-artifact

English | [中文](README.zh.md)

## Summary

This package owns the artifact vocabulary of the session journal: the branded `ArtifactId` reference identity and the two `SessionEventMap` members — `artifact/created` and `artifact/status` — that put artifacts on the host's durable event log. Journal events carry the reference, its coarse kind, its human-facing title, and its lifecycle status only; content bytes never ride an event and live in the resource channel the consumer resolves the reference against. Companion surfaces (the cross-platform fold and the native companion apps) consume this vocabulary to render the artifact pane, and contract fixtures replay it as golden scenarios.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Take a type-only edge on `@deepseek-ai/dsh-artifact/types` where a program needs the `SessionEventMap` merge in scope, and import the `ArtifactId` constructor where a fixture or a producer mints a reference:

```ts
import { ArtifactId } from '@deepseek-ai/dsh-artifact/types'
```

A host producer journals an artifact by appending the two events through the session the same way every plugin domain does; nothing here registers a plugin, tool, or schema.

<a id="understand-the-implementation"></a>
## Understand the implementation

`types.ts` declares the branded identity, the three-state `ArtifactStatus`, and the declaration merge onto `@deepseek-ai/dsh-session/types`. The merge is picked up by the generated known-event guard (`dsh-session/known-event-types`), which makes persistence refuse logs carrying artifact events from builds that do not understand them, and by the generated persistence catalog, which documents both members. Adding the members is vocabulary only: `SESSION_FORMAT_VERSION` does not move, because an older runtime rejects the new types instead of misreading them.

<a id="further-exploration"></a>
## Further Exploration

- [Session event vocabulary](../../core/session/README.md) — the merge-extensible `SessionEventMap` this package extends.
- [Persistence catalog](../../../docs/persistence-catalog.md) — the generated documentation of every journal event, artifacts included.
- [Companion fold](../../remote/link-contracts/README.md) — the reference fold that consumes these events into the artifact pane.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The vocabulary ships without a host-side producer: no tool or capability emits `artifact/created` yet, so recorded sessions stay free of artifact events until that increment lands.
- The host-side resource channel (resolving an `ArtifactId` to content bytes on the host) is deferred with that producer; companion Lite runtimes keep their own store today.

<a id="dev-note"></a>
## Dev Note

The event shapes deliberately match the Lite artifact vocabulary already pinned by the cross-language conformance fixtures, so the three companion folds consume host events and Lite events through one set of branches.
