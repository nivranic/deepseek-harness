# Agent Note: The device-revoked Connection state closes the section 18 state list

Status: implemented

English | [中文](2026-09-20-device-revoked-connection-state.zh.md)

- Date: 2026-09-20
- Class: feature
- Scope: `packages/client/connection`, `packages/client/ui-settings-general`

## Problem

Section 18 requires Connection to distinguish at least ten states — connecting, authenticating, ready, offline, reconnecting, host-not-ready, auth-expired, device-revoked, incompatible, fatal — each with corresponding UX. Nine were implemented; `device-revoked` was missing because no device grant lifecycle existed to revoke. The Phase 7 signed-admission increment changed that: a device whose grant the Host revoked now receives `device/already-revoked` at stream open, and the spec's own remaining list named 设备撤销状态 as open work.

## Decision

Add `device-revoked` as the third terminal classification. `ConnectionSinks.classifyFailure` may now return it beside `incompatible` and `fatal`: the blocked path withdraws readiness, suspends automatic retries until manual reconnect or a browser network transition, and the settings surface presents it through the new locale keys `connection.deviceRevoked` / `connection.deviceRevokedAction` (pair-again guidance), with the connection indicator showing disconnected through the existing blocked flag. The classifier remains the Gateway-owned seam: a device-aware generation source classifies the admission refusal; Connection owns only scheduling and state.

## Alternatives considered

- Mapping revocation onto `auth-expired`: a revoked device cannot recover by re-authenticating — it must re-pair through the operator ceremony — so the UX copy and the recovery expectation differ and the state deserves its own name.
- Adding a `device-revoked` retry policy (auto-retry after re-pairing): the Host cannot notify a revoked device of re-pairing; manual reconnect after the ceremony is the honest bound.

## Consequences

- The state is reachable today only through the classifier seam (tests inject it); the browser generation source presents device admissions only once a device client adopts the `args.device` stream-open form, after which `device/already-revoked` maps here naturally.
- All ten section 18 states now have locale-owned UX copy in both languages; the remaining section work is the multi-version/multi-language matrix, closed error semantics, and change identity confirmation.
