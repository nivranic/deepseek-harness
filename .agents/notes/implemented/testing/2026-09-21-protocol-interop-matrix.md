# Agent Note: The protocol-version interop matrix is pinned as one test

Status: implemented

English | [中文](2026-09-21-protocol-interop-matrix.zh.md)

- Date: 2026-09-21
- Class: testing
- Scope: `packages/api/gateway`

## Problem

Section 14 requires an N/N-1/N-2 compatibility matrix. The gateway implemented every row — protocol 2 current, protocol 1 legacy, explicit `apiProtocolVersion: 0` diagnostics-only discovery tier, unknown versions refused — but the evidence lived scattered across three suites with per-cell specificity, and no single artifact stated the whole grid. The traceability row kept the matrix open for exactly that reason.

## Decision

Pin the grid as one canonical test. `pins the protocol-version by endpoint-class interop matrix` (gateway.host.spec.ts) boots the real gateway with the real `HostDescriptionGateway` so both discovery endpoints resolve, then walks version {0, 1, 2, unknown/malformed} × endpoint class {discovery, business RPC, event-result settlement, stream open}: discovery admits every negotiated tier, business and event results admit 1 and 2 (event-result positive cells prove version admission through the business-level `interaction-closed`), version 0 outside discovery gets the diagnostics refusal message, unknown versions get the generic `gateway/protocol-unsupported`, and stream-open refusal rows run against `wireStream.open` directly. Admitted-version stream rows stay in the stream suite where a registered Remote event source backs them. The README documents the same grid as a bilingual table, so the wire contract is stated once for tests and once for humans.

## Alternatives considered

- Spinning real N-1/N-2 Host builds for cross-release interop: honest qualification, but no released versions exist to test against yet; recorded as the genuinely remaining §14 work rather than faked locally.
- Duplicating the stream positive rows without a registered source: the registration refusal would shadow version admission, so those cells stay where their fixture lives.

## Consequences

- The gateway test tree gains a dev dependency on `@deepseek-ai/dsh-api-host-description` (peer-free, test-only).
- The local matrix is evidence for the version axis only; cross-release, device-revocation-state, closed-error-semantics, and change-identity rows of §14 remain open.
