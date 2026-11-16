---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-11-approval-risk-command-identity

English | [中文](2026-11-11-approval-risk-command-identity.zh.md)

## Summary

Adds optional ask risk tier, structured escalation facts, and command retry identity fields to the durable approval and command audit events.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-11-approval-risk-command-identity
baseline: false
changes:
  - root: "event:approval/asked"
    previous: "2026-09-11-initial"
    after: "7d4b2813a6fc075ed8cbe9a03c0fbe67eaf081a30d3adee73f0f5a47dd8d3a16"
    decision: same-version
  - root: "event:command/done"
    previous: "2026-09-11-initial"
    after: "628f22307154a28661a0e4b2390b8a07709c56d1da1d8f2b09fd62719678e116"
    decision: same-version
  - root: "event:command/run"
    previous: "2026-09-11-initial"
    after: "5fa0af5a3f663880a31ade24fa0bcf9d6b18a416ac4d934487661ed207dec538"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Both changes add optional properties to existing events. Readers written before the fields ignore them, and absence keeps the pre-change semantics: no risk tier to display, no escalation facts to render, and no in-process retry receipt for a command execution. Writers set each field only when the caller supplied it, so sessions produced by either generation stay valid.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/interaction/user-approval/tests/approval.spec.ts: 33 tests passed (covers the risk/escalation audit fields and the absent-optional-fields omission). pnpm exec vitest run packages/interaction/commands: 55 tests passed (covers the clientMutationId retry identity emission). pnpm exec vitest run packages/session/session-format-v0-to-v1/tests/validation.spec.ts: 20 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
