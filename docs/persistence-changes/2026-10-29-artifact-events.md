---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-29-artifact-events

English | [中文](2026-10-29-artifact-events.zh.md)

## Summary

The artifact feature (packages/artifact) journals two new Session events: artifact/created when the model calls artifact_create, and artifact/status when the resource channel settles the stored bytes. Both roots add durable event discriminants; no existing envelope changes.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-29-artifact-events
baseline: false
changes:
  - root: "event:artifact/created"
    previous: null
    after: "18a9a30bd6e4c9519bbada9d53f7f5e7fb3b29d5040f7a810d406d6b6de75b12"
    decision: same-version
  - root: "event:artifact/status"
    previous: null
    after: "3e0d43bd710d43096f1436af7500bb54ceaf59ed2a7494367a3e3387a1a2fced"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Two roots are added under the same session format version: a reader built for the previous tree skips events it does not know through the closed discriminator switch, and both events carry only JSON-safe fields (string ids, kinds, titles, formats, statuses). No root is moved, renamed, or deleted, so old logs replay unchanged.

<a id="verification"></a>
## Verification

packages/artifact artifact-tool.spec.ts asserts the exact event sequence artifact/created then artifact/status (ready and failed paths) plus the journaled payload fields; the persistence catalog regeneration derives both root schemas from the same SessionEventMap declaration, and persistence-changes --check validates this record against the regenerated tree.

<a id="dev-note"></a>
## Dev Note

None.
