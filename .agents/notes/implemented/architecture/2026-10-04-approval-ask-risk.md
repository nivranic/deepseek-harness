# Agent Note: Pre-tool ask decisions can carry the §37 risk tier

Status: implemented

English | [中文](2026-10-04-approval-ask-risk.zh.md)

## Problem

Section 37's remaining open clause named one last unclassified asker family: hook-origin approval asks. A `tools/pre-execute` listener that returns `{ kind: 'ask' }` (the Claude Code bridge does exactly this for a hook's `permissionDecision: 'ask'`) produced an approval request with `toolName`/`callId`/`reason` but no risk tier, so the §38 panel hid its Risk row for every hook-origin ask. The approval seam itself already accepted, persisted, and rendered a tier — gen-30 delivered `approval/asked`'s durable `risk` member, the frozen-v0 disposition entry, strict payload validation, and the panel row — but no tool-layer asker could supply one.

## Decision

The classification channel follows the section's ownership rule verbatim: the Host layer classifies, the Client only displays. `PreToolDecision`'s `ask` member gains an optional `risk` field typed as a local closed literal union (`ToolAskRisk = 'low' | 'moderate' | 'high' | 'critical'`), and `serviceAsk` conditionally spreads it into `approval.request` — the durable event and the panel render it through the machinery gen-30 already shipped. Structural identity with `ApprovalRisk` lets the value pass through unchanged, same shape as gen-30's `ApprovalSandboxMode` mirror.

Verification: `packages/core/tools/tests/tools.spec.ts` ask-routing block — the forwarding case attaches `risk: 'high'` and asserts it lands on the `approval/request` payload; a new companion case asserts the request omits the `risk` key entirely when the asker did not classify one (conditional spread, not an `undefined` member). core/tools lane 12 files / 391 tests green; tool-cordis 11 green after `gen-cordis-catalog` regenerated the embedded `PreToolDecision` declaration (`risk?: ToolAskRisk`); `docs/subsystems/tools{.md,.zh.md}` type-equiv blocks mirrored by hand; persistence-catalog and doc-graphs verified up to date; repo typecheck and lint 0/0; traceability §37 tail rewritten and candidateEvidence 6→8.

## Alternatives considered

A named type-only import of `ApprovalRisk` from `dsh-user-approval` was tried first and the typert host-face analyzer rejected it (`type symbol unknown has no declaration`) — the long-standing `import type {}` in this file exists precisely to activate the service augmentation without pulling that package's declarations into the face, so the mirror union is the established shape. Inventing a `permissionRisk` field into the Claude Code hook dialect was rejected: neither reference schema defines one, so the codec would parse a field no emitter can send — dead wire surface. A risk field on tool registrations was rejected too: the spec anchors the §37 ladder to Commands, and tools are not commands.

## Consequences

Hook-origin asks can now be classified end-to-end: a Host-side pre-execute asker that returns `{ kind: 'ask', risk: 'high' }` gets the tier into the wire request, the durable `approval/asked` event, and the §38 panel's Risk row with no further changes. The Claude Code bridge forwards nothing (its dialect carries no tier), so CC-bridged asks keep an honestly unclassified Risk row — the panel hides absent rows by design, per the gen-28 ruling. The embedded api-catalog declaration and both type-equivalence doc blocks now carry the widened union.

## Open follow-ups

No shipped pre-execute asker classifies a tier today; adoption belongs to guard-style plugins or a future bridge speaking a richer dialect. Real multi-device acceptance of the approval surface remains open.
