# Agent Note: Device revocation state closes the cross-section tail phrase in five ledger sections

Status: implemented

English | [中文](2026-10-06-device-revocation-closure.zh.md)

## Problem

Five traceability sections (§12 HostDescriptor, §13 Capability negotiation, §19 Offline, §47 Feature Flag, §55 Contract Compatibility Matrix) carried the byte-identical tail phrase "仍需完整多版本/多语言矩阵、设备撤销状态、闭合错误语义和变更身份确认" — yet a full survey proved the three named items already closed cross-section by the §18 increment family: `device-revoked` is a first-class ConnectionState with a classifier mapping, gateway aborts in-flight business and event streams with `device/already-revoked` and refuses admission, the devices settings page renders revoked rows without actions, Kotlin/Swift contract mirrors pin the error code, and a real-device e2e walks the whole revocation lifecycle. §12/§13's spec text contains no device-revocation requirement sentence at all — the phrase was a cross-section clone. The one real gap found: the revoked row showed only a tag; `DeviceView.revokedAt` (epoch ms) was never surfaced.

## Decision

Two deliveries. First, the visible fact: `DevicesSettingsSection` renders the revocation time on the revoked row only — a conditional span in the row's meta area after `lastSeenAt`, using the page's existing injected `formatTime` hook (`Intl.DateTimeFormat(active locale, { dateStyle: 'medium', timeStyle: 'short' })`), label locale-owned as `revokedAt` ("Revoked {time}" / 「撤销于 {time}」); an absent `revokedAt` renders nothing, and active rows never render a revocation time (asserted). Second, the ledger rewrite: the shared phrase in all five sections now records the three items as closed by the §18 increment family with the evidence files cited inline, while only "跨真实发布版本的多版本/多语言矩阵" (cross-real-release-version matrix) stays open — it needs N/N-1/N-2 interoperability this worktree lane cannot reach. Each of the five sections' candidateEvidence gains the three closure paths (connection state, gateway-stream revocation spec, devices section).

## Alternatives considered

- **An interlock test asserting describe still answers for revoked devices while streams refuse**: rejected — both halves already have direct tests in the gateway suite; a stitched test adds no new fact.
- **Adding the devices spec to the client audit list**: rejected — the audit list is a historical lineage, not an exhaustive client set; the lane's targeted run (14 passed) plus CI's full matrix carry this package, the same treatment as gen-36's host specs.
- **Leaving the phrase for a "real" section PASS**: impossible — the traceability model forbids section PASS without item-level acceptance review, and the honest state is precisely "closed by another section's family, matrix still open".

## Consequences

Five sections' remaining now tell the truth about what is closed and what is open; the only surviving open item in this family is the cross-release-version matrix (device-physical/Swift-shell acceptance lanes stay open separately); future generations reading §12/§13 will not re-derive the already-closed items. The revoked-at presentation gives the management face a durable, user-visible fact consistent with the storage layer.

## Open follow-ups

- Cross-real-release-version (N/N-1/N-2) interoperability matrix — needs published releases, unreachable in this lane.
- Swift shell revocation-state UX (§18 remaining already records it).
- Real-device/physical acceptance lanes (standing open channels).
