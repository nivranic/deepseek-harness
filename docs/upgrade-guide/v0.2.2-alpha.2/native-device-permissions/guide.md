---
kind: upgrade-guide
description: Native device authorization now reports resource-policy refusals and preserves a distinct device principal.
---

# Native device authorization

English | [中文](guide.zh.md)

## Change

Signed native requests use a device Peer and an explicit Host-wide Remote Access binding. A device role named `owner` remains distinct from the local owner principal. Valid resource-addressed operations retain their role permissions, while invalid resource identities are rejected before lookup.

An authenticated device calling an undeclared or unauthorized endpoint now receives `remote-access/denied` with `{ action, reason }`. Missing signed identity still returns `gateway/permission-denied`. A reply addressed to another device's event stream returns `gateway/interactions-forbidden`; signature failures retain their Device Trust codes. Access snapshots may contain `{ kind: 'host' }` grants.

## Migration

1. In native Client error handling, classify `remote-access/denied` as a permission refusal and preserve its original details. Treat `gateway/interactions-forbidden` as a refused reply; do not retry it automatically.
2. If consuming `remoteAccess/follow` directly, apply a `host` grant's actions across resources and remove that grant independently from `global` and resource-specific grants. The shipped Client access service performs this update.
3. Keep sending a fresh signed admission for every request and stream. Verify that Viewer cannot mutate or answer interactions, Collaborator can answer questions, and another device cannot answer the current stream's delivery.

The [device Peer decision](../../../../.agents/notes/implemented/architecture/2026-11-13-device-peer-host-bindings.md) explains identity and authorization ownership. Pairing codes, role names, and the pinned TLS identity are unchanged.
