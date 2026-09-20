# Agent Note: Session capabilities declare their device permissions with read/write splits

Status: implemented

English | [中文](2026-09-21-session-capability-permissions.zh.md)

- Date: 2026-09-21
- Class: feature
- Scope: `packages/api/session-controller`, `packages/api/gateway` (test evidence)

## Problem

The per-request device admission increment landed the capability `requiredPermission` vocabulary with first declarations on device-trust and host-description only; business RPC stayed fail-closed for devices on every session capability. The section 21 adoption queue named session-controller as the first business owner.

## Decision

Declare every session-controller capability by endpoint semantics, splitting the two mixed sets so read and mutation permissions can be stated separately:

- Read-only sets require `view`: `session.follow.v1` (follow, page), the new `session.list.v1` (list), `session.search.v1`, the new `model.catalog.v1` (modelCatalog), `file-reference.list.v1`, and `skill.catalog.v1`.
- Conversation-mutating sets require `prompt.send`: `session.control.v1` (control, prompt, queue update, cancel), `session.cancel-turn.v1`, `session.rename-at.v1`, `session.manage.v1` (now create, rename, fork only), `session.attachment.v1`, and `model.select.v1` (selectModel only).

The splits change the advertised capability sets: `session.manage.v1` drops `list` and `model.select.v1` drops `modelCatalog`. Existing UI consumers already read `session.manage.v1` as "can create sessions", so the split sharpens rather than breaks their semantics; the capability-admission test map, the host-description e2e expectation, and the browser fixture list carry the two new ids. Gateway gating evidence grows one `prompt.send` case (viewer refused, collaborator admitted) beside the existing `device.admin`/`view` cases.

## Alternatives considered

- Coarse `prompt.send` on the mixed sets: would strip viewers of the section 21 查看 right to list sessions and read the model catalog.
- A third "metadata" permission kind: the section 21 table has exactly five columns; rename-at and manage are conversation participation under `prompt.send`.

## Consequences

- Devices holding `view` (every role) can follow, list, search, and read catalogs; `prompt.send` (collaborator and up) gates all conversation mutation — matching the section 21 matrix.
- Hosts advertise two more capability ids; capability-admission and discovery expectations updated in lockstep.
- One pre-existing Windows-environment failure (media-references symlink test) is unrelated and excluded from this increment's suites.
