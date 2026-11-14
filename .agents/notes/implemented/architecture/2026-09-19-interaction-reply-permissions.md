# Agent Note: Host-side enforcement of interaction reply permissions

Status: implemented

English | [中文](2026-09-19-interaction-reply-permissions.zh.md)

## Problem

A pending interaction carries `requiredPermission` (`approval.respond` / `question.respond`), but the Gateway accepted a reply from any client holding the delivery. The field was descriptive data on the wire, not an enforced boundary: specification sections 15/16 require the Host to own interaction settlement, and section 70 requires Host-side tool enforcement — a reply the Host never authorized must not run the tool side effect.

## Current upstream boundary

The official Gateway settles forwarded interaction replies by delivery membership, protocol-version match, and revision match. No permission model exists on the Remote event path; local Web auth treats every connected client as trusted.

## Decision

The Gateway resolves `interactionReplyPermissions` from validated config (both kinds default `true`) into a per-client `replyPermissions` set attached at Remote event stream registration. `receiveRemoteEventResult` checks the pending interaction's `requiredPermission` against that set before consuming the delivery: an unauthorized reply fails with `gateway/permission-denied` (HTTP 403 details), the delivery stays live, the invocation stays unsettled, and the underlying tool side effect never runs. An entitled answerer can still respond later.

## Alternatives considered

Per-route permission claims on the RPC carrier would not see interaction kind; refusing the stream open would deny diagnostics to read-only clients. Enforcing in the approval service instead of the Gateway would miss late replies after delivery removal.

## Contract

Enforcement is Host-authoritative and happens before `removeRemoteEventDelivery`; a denied reply is idempotent-safe to retry by an entitled client. The set is per-client at creation time; Device Trust roles (Phase 7) replace the deployment-wide switch with per-device resolution without touching the settlement path.

## Persistence

None. Permission sets live only on the in-memory Remote event client; Session storage, events, and writer version 3 are untouched.

## Security

A denied reply leaks no interaction content beyond the code/endpoint. The check cannot be bypassed by replaying a revision: permission is re-evaluated on every reply.

## Compatibility

Default configuration grants both permissions, preserving existing behavior (227 gateway tests pass unchanged). The two Config-equality tests now include the defaulted field.

## Failure handling

Missing or removed permissions resolve fail-closed: the reply is rejected and the interaction remains open for entitled answerers or eventual expiry/cancellation.

## Testing

`gateway-stream.host.spec.ts` adds protocol-1 and protocol-2 cases: approval reply rejected with `gateway/permission-denied` while the invocation stays unsettled (no resolve, no reject), and a question reply from the same client settles — proving per-kind enforcement and that denial has no side effect.

## Rollout

Configuration-only; default preserves behavior. Compositions revoke per deployment need.

## Rollback

Remove the config field and the per-client set; the settlement path reverts to delivery+revision checks.

## Consequences

`requiredPermission` is now enforced Gateway state rather than wire decoration: an unauthorized answer can never run the tool, and the seam names exactly where Device Trust roles plug in. Read-only diagnostics remain available because enforcement applies to replies, not stream opens.
