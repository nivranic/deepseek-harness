---
description: "Package map for the artifact vocabulary family: the branded reference identity and the journal events that carry it."
kind: "package-group"
---

# artifact/ — artifact vocabulary family

English | [中文](README.zh.md)

## Summary

The `artifact/` group owns the artifact vocabulary of the session journal: a branded reference identity plus the `artifact/created` and `artifact/status` events that record an artifact's metadata and lifecycle on the host's durable log. Events carry references only — content bytes live in the resource channel a consumer resolves the reference against, never on the journal (chapter 56 of the cross-device plan).

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`artifact/`](artifact/README.md) | The branded `ArtifactId` and the artifact `SessionEventMap` members |

-----

<a id="related-documentation"></a>
## Related documentation

- [Persistence catalog](../../docs/persistence-catalog.md) — the generated documentation of every journal event, artifacts included.
- [Session event vocabulary](../core/session/README.md) — the merge-extensible `SessionEventMap` this family extends.
- [Companion fold](../remote/link-contracts/README.md) — the reference fold that consumes these events into the artifact pane.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The host-side producer (a tool or capability that creates artifacts and journals these events) and the host-side resource channel are deferred increments; the vocabulary lands first so companion consumers and fixtures pin one shape.

</details>
