---
description: "Local durable artifact backend for deployments storing artifact content bytes below DSH_HOME."
kind: "package-reference"
---

# @deepseek-ai/dsh-artifact-local

English | [中文](README.zh.md)

## Summary

This package stores your artifacts' content bytes on this machine: one atomic `<id>.artifact` file per reference under `<DSH_HOME>/artifacts`, owner-only permissions, created on demand. It implements the `ctx.artifacts` resource channel that `dsh-artifact`'s `artifact_create` tool writes through; the session journal keeps references and status only, so this store is where the bytes live. The shipped `dsh` composition mounts it with no setup.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Artifacts store durably in the default composition. When you compose your own setup, mount this backend beside the tool package:

```yaml
- name: '@deepseek-ai/dsh-artifact'
- name: '@deepseek-ai/dsh-artifact-local'
```

`dshHome` is optional: omitted, the store follows `DSH_HOME`, then `~/.dsh`.

<a id="understand-the-implementation"></a>
## Understand the implementation

`LocalArtifactStore` extends the `ArtifactStore` service: `put` writes through `writeFileAtomic` (exclusive-create temp sibling renamed over the target, so a reader sees either the old or the complete new file), `get` reads the bytes back with an absent id reading as null, and `remove` deletes silently. Re-putting an id replaces its content wholesale.

<a id="further-exploration"></a>
## Further Exploration

- [Artifact seam and tool](../artifact/README.md) — the vocabulary, the service seam, and `artifact_create`.
- [Atomic write utility](../../util/atomic-write/README.md) — the replacement primitive this backend rides.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Stored artifacts are never deleted automatically; no retention policy exists yet.
- Content is addressed by reference id only, not content-addressed; identical content submitted twice stores twice.

<a id="dev-note"></a>
## Dev Note

None.
