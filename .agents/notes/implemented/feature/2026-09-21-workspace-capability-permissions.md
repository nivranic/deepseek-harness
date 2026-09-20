# Agent Note: Workspace capabilities declare their device permissions

Status: implemented

English | [中文](2026-09-21-workspace-capability-permissions.zh.md)

- Date: 2026-09-21
- Class: feature
- Scope: `packages/api/workspace-controller`

## Problem

The session-controller adoption left every other business owner fail-closed for devices; workspace-controller is the next named adopter.

## Decision

Declare every workspace-controller capability by endpoint semantics — no splits needed because each set is already homogeneous. `workspace.follow.v1` requires `view`; `workspace.manage.v1` (create, rename, delete, insertBefore) and `workspace.sessions.v1` (archiveSession, insertSessionBefore) require `prompt.send` following the session precedent that workspace-lifecycle writes are conversation participation. The directory picker declares `view` for `directory-picker.native.v1` (pick) and `directory-picker.browse.v1` (list), and `prompt.send` for `directory-picker.create.v1` (createDirectory) — its only filesystem mutation. A device role without the declared permission is refused before dispatch; anonymous callers are unaffected.

The full-repository lock-surface grep from the session checklist found no full-set pins: the host-preparation admission map, the browser fixture list, and the e2e filters reference the same homogeneous ids unchanged; only the two package-internal deep-equal capability pins gained the `requiredPermission` fields.

## Alternatives considered

- A dedicated workspace-admin permission kind: the section 21 table has five columns and none names workspace administration; collaborator-and-up conversation participation is the honest mapping.
- `view` for the native picker because it "selects": pick returns a path choice but changes nothing; `createDirectory` is the picker's only write and takes `prompt.send`.

## Consequences

- A viewer device can follow workspace state; collaborator and up manage registries, session order, and picker-created directories.
- The pre-existing Windows-environment failure in `transport.client.spec.ts` (exhausted carrier retries) was verified failing on a clean tree and stays out of scope.
