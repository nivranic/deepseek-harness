# Agent Note: Device grants live in the durable device_trust storage domain

Status: implemented

English | [中文](2026-09-20-device-trust-durable-store.zh.md)

## Problem

The device-trust seam's first increment held grants in a process-local `Map`: grants died with the Host process, so a restart silently unpaired every device and forgot every revocation — unacceptable for authoritative access data.

## Decision

Grants now live in the `device_trust` storage domain (`packages/api/device-trust/src/spec.ts`): `defineDomain` with a `grants` table keyed by `DeviceId`, `single` layout (the grant set rewrites wholesale on each ceremony step), version 1, and the rejecting default for invalid records — a stored grant that fails its zod schema refuses the whole open instead of being skipped, because silently dropping a revocation is a security hole, not a cache miss. `DeviceTrustService` injects `storageDomain`, opens the domain in `[Service.init]` with a `ctx.effect` close, and reads synchronously from the domain's in-memory tables while writes (`put`, `update`) land durably first. Pending pairing codes deliberately stay process-local: a one-time expiring secret must not survive a restart, and the ceremony reissues after one. Redemption marks a code consumed only after the durable `put` resolves, so a failed store write leaves the code redeemable; revocation runs as an atomic `update` whose transform throws `device/already-revoked` when the record at its queue slot is already revoked, with the write chain's `missing-key` mapped to `device/not-found`.

Two behavior tests pin the durability contract: grants (including their revocation state) survive a Host restart on the same json root, and a pending code does not.

## Alternatives considered

- **Skip-and-backup for invalid records.** Rejected: that policy is for disposable derived data; grants are authoritative, and an unreadable grant must stop the open loudly rather than vanish.
- **Persist pending pairing codes too.** Rejected: an outstanding one-time code outliving its issuer widens the secret's exposure window across restarts for no operator value.
- **SQLite backend.** Deferred: the shipped composition routes every domain to json under `<dshHome>/storages`; the grant set is tiny, and per-domain routing (`routes`) can move it later without touching this package.

## Consequences

Phase 7's store is durable: pairing survives restarts, revocations cannot be forgotten by a crash, and the failure ordering never burns a code on a store failure. The service now requires a composed `storageDomain` (present in every bundle through the base stack). Remaining Phase 7 steps unchanged: role-mapped permission checks through the section 15 seam and request-signature admission.
