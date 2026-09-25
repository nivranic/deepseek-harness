# Agent Note: Device roles map onto the section 15 seam through signed admission

Status: implemented

English | [中文](2026-09-20-device-role-admission.zh.md)

- Date: 2026-09-20
- Class: feature
- Scope: `packages/api/device-trust`, `packages/api/gateway`

## Problem

Phase 7 increment 1 landed the device-trust seam with three roles (`viewer`, `collaborator`, `admin`) and process-local permission-less grants; increment 2 made grants durable. Two gaps remained: the spec's section 21 table actually names Viewer/Collaborator/Controller/Owner with five permission columns (查看/发 Prompt/Question/Approval/Device Admin), and the gateway enforced interaction reply permissions from a deployment-wide config switch (`interactionReplyPermissions`) that the section 15 documentation itself said Device Trust roles must replace.

## Decision

Align the role vocabulary to the section 21 table exactly and make the replacement per-client through a signed admission at Remote event stream open.

- `DeviceRole` becomes `'viewer' | 'collaborator' | 'controller' | 'owner'`; `DEVICE_ROLE_PERMISSIONS` (new `src/permissions.ts`) maps each role to exactly the table's columns — `view`, `prompt.send`, `question.respond`, `approval.respond`, `device.admin`. The first version does no arithmetic RBAC, matching the spec's "第一版不要做复杂 RBAC". The durable zod schema changes with it; pre-release, an old stored record with `admin` rejects the domain open (authoritative data).
- `admitDevice` (`device.admit.v1`) verifies the grant, timestamp, signature and replay history under the [nonce-admission rules](2026-09-21-admission-nonce-ledger.md), returning identity, role and permissions. Durable commit rechecks current revocation: a single-device or all-device revocation queued first makes admission fail with `device/already-revoked`.
- Remote event streams carry signed admission in `args.device`; empty `args` retains local-browser identity. Gateway subscribes to revocation before awaiting admission and rechecks lifetime before registration; revoked active streams discard queued frames. The subscription is released on stream teardown or failed admission. An identity presented without the device-trust service fails with `gateway/service-unavailable`. [Per-request device admission](2026-09-21-per-request-device-admission.md) owns reply proofs.

## Alternatives considered

- **Required `static inject = ['deviceTrust']` on the gateway**: forces the storage stack into every gateway composition and every one of its 432 tests, and contradicts the §13 capability-negotigation model where an uncomposed service means unadvertised capabilities. Lazy resolution keeps the seam optional-but-loud.
- **An admission ticket RPC returning a token the stream open presents**: adds replay state and a second secret for no benefit at one-verification-per-connection granularity.
- **Keeping the three-role vocabulary**: the section 21 table is the spec; the moment roles gate behavior is the moment the wire names must match it.

## Consequences

- Revocation covers admission waiting, stream registration and active streams. Reply permissions remain those of the admitted role; proof failure, cancellation and revocation precede delivery consumption.
- The gateway now type-depends on `@deepseek-ai/dsh-api-device-trust` (peer+dev), resolved through `tsconfig.base.json` paths; the host program gains the device-trust project reference.
- Focused tests cover role permissions, the revocation commit queue, admission-to-registration races, queued frames after revocation and device reply lifetime. A recorded Question through the real Web composition proves incorrect identities cannot settle it and its owning device can.
