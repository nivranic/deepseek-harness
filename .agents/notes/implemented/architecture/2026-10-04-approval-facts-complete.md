# Agent Note: Approval surface presents the complete itemized approval information

Status: implemented

English | [中文](2026-10-04-approval-facts-complete.zh.md)

## Problem

The §37 remaining clause demands the approval surface present the complete approval information itemized: operation, target, Host, Workspace, permission elevation, and command preview. The landed §38 fact rows covered operation/Host/Workspace/risk, but target had no row and no payload field anywhere, permission elevation rendered only the asker's free-text reason (the sandbox mode lived inside an English sentence), and command preview worked only for shell tools whose call had streamed. Two latent defects also surfaced in the data chain: `ApprovalService.request` dropped `risk` from the durable `approval/asked` event even though the wire payload carried it, and the frozen released-v0 payload disposition table rejected both `risk` and any new member on format-artifact validation.

## Decision

- **Target rides the existing correlation seam, not the payload.** The 2026-07-06 approval-seam decision pins "the approval request does not duplicate tool arguments; channel adapters correlate richer call state by callId" — so the target row comes from a new data slot `conversation.approval.target` (same owner props as the detail slot) implemented by ui-chat, deriving the correlated call's `args.command` or `args.path`. A string is a valid ReactNode, so the slot system carries it without new infrastructure.
- **Escalation is approval-intrinsic structured metadata.** `ApprovalRequestEvent`/`approval/asked`/`ApprovalRequest` gain `escalation?: { requestedMode; effectiveMode }`; the sandbox escalation gate (which already holds both modes) fills it; the permission-escalation row renders localized requested/effective modes with the free-text reason kept as the fallback for non-escalation asks (hook asks).
- **The mode vocabulary mirrors, not imports.** `ApprovalSandboxMode` in user-approval/types re-declares the three sandbox modes — importing `@deepseek-ai/dsh-sandbox` into the wire-safe types module drags Host runtime modules into browser type programs and breaks Context merging (verified by stash probe). The structural-mirror idiom is the same one `EscalationOutcome` already uses, in the reverse direction.
- **The durable log and format validator follow the type.** The `approval/asked` append now spreads `risk` and `escalation` (fixing the risk drop); the released-v0 disposition admits `risk`/`escalation` as optional members; the payload-semantics validator type-checks the risk tier literal and the escalation record's exact keys and mode literals. The corruption test's mutation loop covers the new leaves.

## Alternatives considered

- **Carrying target/command in the wire payload**: rejected — contradicts the recorded seam decision and duplicates tool arguments on the wire; the callId correlation already reaches the same data.
- **Extending the detail slot to return structured data**: rejected — slot rendering is ReactNode by construction; a second single-cardinality data slot is the minimal symmetric addition.
- **Marking escalation opaque in the disposition**: rejected — the fact is approval-owned (not an owner-opaque external blob), so its keys and mode literals are validated strictly; opaque members skip the corruption mutations that pin the shape.

## Consequences

- The panel renders six itemized rows plus the preview heading; target appears only when the correlated call carries a command or path, and structured escalation only for escalation asks.
- `user-approval` keeps zero new package dependencies (the mirror union replaces the import); `EscalationApprover`'s structural request type gains the escalation field.
- The frozen-inventory fixture now carries risk+escalation, so the format validator's admission is regression-pinned; pre-existing logs without the fields validate unchanged (all new members optional).
- ACP machine-channel delegation and the `tools/pre-execute` hook path are unchanged (they set neither risk nor escalation — those rows stay hidden, the honest data-conditional presentation).

## Open follow-ups

- Hook-originated asks still classify no risk tier; giving `PreToolDecision` an optional Host-assessed tier is a separate policy change.
- Multi-Host per-approval origin identity (§28) remains connection-scoped Host facts.
- Real multi-device approval acceptance stays in the §38 device matrix.
