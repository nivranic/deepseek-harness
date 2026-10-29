---
description: "Local durable artifact backend for deployments storing artifact content bytes below DSH_HOME."
kind: "package-reference"
---

# @deepseek-ai/dsh-artifact-local

English | [中文](README.zh.md)

## Summary

This package stores your artifacts' content bytes on this machine: one atomic `<id>.artifact` file per reference under `<DSH_HOME>/artifacts`, owner-only permissions, created on demand. It implements the `ctx.artifacts` resource channel that `dsh-artifact`'s `artifact_create` tool writes through; the session journal keeps references and status only, so this store is where the bytes live. The shipped `dsh` composition mounts it with no setup, keeping every artifact forever; deployments that must bound disk growth enable the opt-in `retentionDays` sweep.

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

`retentionDays` bounds how long stored bytes live: a positive whole number of days an artifact may age before the sweep deletes it; omitted keeps every artifact forever (the default — artifacts are files the user keeps). Configure it explicitly, for example:

```yaml
- name: '@deepseek-ai/dsh-artifact-local'
  retentionDays: 30
```

<a id="understand-the-implementation"></a>
## Understand the implementation

`LocalArtifactStore` extends the `ArtifactStore` service: `put` writes through `writeFileAtomic` (exclusive-create temp sibling renamed over the target, so a reader sees either the old or the complete new file), `get` reads the bytes back with an absent id reading as null, and `remove` deletes silently. Re-putting an id replaces its content wholesale. With `retentionDays` configured, the constructor validates it as a positive whole number (a bad value fails plugin load) and registers a sweep that runs once at boot and then daily: `sweep(retentionDays)` lists `artifacts/`, stats each `<id>.artifact` file, and deletes the ones whose bytes aged past the window, returning the removed ids. Age is time since the bytes were written — reads never refresh it. The sweep is best-effort per file: one unreadable entry is logged and skipped, and a directory that never materialized holds nothing to prune.

<a id="further-exploration"></a>
## Further Exploration

- [Artifact seam and tool](../artifact/README.md) — the vocabulary, the service seam, and `artifact_create`.
- [Atomic write utility](../../util/atomic-write/README.md) — the replacement primitive this backend rides.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Retention is age-since-write only: a journal reference outliving its swept bytes is the modeled `ARTIFACT_CONTENT_MISSING` / loud tool failure, but the sweep never consults which sessions still reference an artifact.
- The sweep cadence (boot plus daily) is fixed; only the window is configurable.
- Content is addressed by reference id only, not content-addressed; identical content submitted twice stores twice.

<a id="dev-note"></a>
## Dev Note

None.
