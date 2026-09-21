# 设备信任

[English](device-trust.md) | 中文

候选网关上设备信任接缝的线上类型。[Link 接管审计决策](../../.agents/notes/implemented/architecture/2026-09-20-link-access-takeover-audit.zh.md)拥有归属决策；本页记录 [`packages/api/device-trust/src/types.ts`](../../packages/api/device-trust/src/types.ts) 的精确字段。

## 标识与角色

`DeviceId` 与 `PairingCodeId` 是[品牌化标识](core.zh.md#branded-ids)。角色使用第 21 节表格命名，并恰好持有该表格的权限列；权限执行仍归交互回复接缝。

```ts type-equiv
/**
 * Section 21 role table wire names: Viewer, Collaborator, Controller, Owner.
 * A role names what the Client may ask next; permission execution stays with
 * the section 15 Host-authoritative seam, which reconciles roles onto
 * `requiredPermission` checks.
 */
type DeviceRole = 'viewer' | 'collaborator' | 'controller' | 'owner'
```

```ts type-equiv
/**
 * One grantable capability kind from the section 21 table columns. Roles hold
 * these as sets via {@link DEVICE_ROLE_PERMISSIONS}; the section 15 seam checks
 * the two `*.respond` kinds against pending interactions' `requiredPermission`.
 */
type DevicePermission =
  | 'view'
  | 'prompt.send'
  | 'question.respond'
  | 'approval.respond'
  | 'device.admin'
```

## 配对仪式

```ts type-equiv
/** One issued one-time pairing code with its expiry and assigned role. */
interface PairingIssuance {
  readonly pairingId: PairingCodeId
  /** The single-use secret the device presents at redemption. */
  readonly code: string
  readonly role: DeviceRole
  /** Epoch ms after which redemption fails with `device/pairing-expired`. */
  readonly expiresAt: number
}
```

```ts type-equiv
/** Device-side redemption request over the wire. */
interface RedeemPairingRequest {
  readonly code: string
  readonly deviceName: string
  /** Base64 SPKI DER of the device's freshly generated Ed25519 key. */
  readonly devicePublicKey: string
  /** Client-declared platform label, e.g. `android`; absent when unnamed. */
  readonly platform?: string
}
```

```ts type-equiv
/** Acknowledged grant identity returned once at redemption. */
interface RedeemPairingResult {
  readonly deviceId: DeviceId
  readonly role: DeviceRole
  readonly keyFingerprint: string
  readonly pairedAt: number
}
```

## 授权与撤销

```ts type-equiv
/** Grant projection for listing: key material stays in the store. */
interface DeviceView {
  readonly deviceId: DeviceId
  readonly deviceName: string
  readonly role: DeviceRole
  readonly keyFingerprint: string
  readonly pairedAt: number
  /** Client-declared platform label, e.g. `android`; absent when unnamed. */
  readonly platform?: string
  /** Epoch ms of the newest accepted admission; absent before the first. */
  readonly lastSeenAt?: number
  readonly revokedAt?: number
}
```

```ts type-equiv
/** Revoke request for one grant. */
interface RevokeDeviceRequest {
  readonly deviceId: DeviceId
}
```

```ts type-equiv
/** Revoke acknowledgement. */
interface RevokeDeviceResult {
  readonly deviceId: DeviceId
  readonly revokedAt: number
}
```

```ts type-equiv
/** Revoke-all acknowledgement: the shared revocation time and the count. */
interface RevokeAllDevicesResult {
  readonly revokedAt: number
  /** How many still-active grants this call revoked. */
  readonly count: number
}
```

```ts type-equiv
/** Rename request for one grant. */
interface RenameDeviceRequest {
  readonly deviceId: DeviceId
  /** The replacement display name, non-empty. */
  readonly deviceName: string
}
```

## 签名准入

```ts type-equiv
/**
 * Signed admission request a device presents when opening a Gateway Remote
 * event stream. The signature is base64 Ed25519 over the UTF-8 bytes of
 * `deviceId + "\n" + timestamp (decimal epoch ms) + "\n" + nonce` made with
 * the paired key. Every request carries a fresh nonce; a replayed admission
 * is refused.
 */
interface AdmitDeviceRequest {
  readonly deviceId: DeviceId
  /** Epoch ms when the device signed; accepted within the admission window. */
  readonly timestamp: number
  /** Fresh per-request value the device never reuses across admissions. */
  readonly nonce: string
  /** Base64 Ed25519 signature over the canonical admission message. */
  readonly signature: string
}
```

```ts type-equiv
/** Admission outcome: the device's identity, role, and its permission set. */
interface DeviceAdmission {
  readonly deviceId: DeviceId
  readonly deviceName: string
  readonly role: DeviceRole
  readonly permissions: readonly DevicePermission[]
  /** Epoch ms when the Host accepted the admission. */
  readonly admittedAt: number
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdevicetrust--devicetrustservice"></a>

### `ctx.deviceTrust` — `DeviceTrustService`

Device-trust service (`ctx.deviceTrust`) over the durable device_trust domain.

```ts cordis-catalog
/**
 * Issue one one-time pairing code. The code is a single-use secret: a
 * second redemption fails with `device/pairing-invalid`, and redemption
 * after the expiry fails with `device/pairing-expired`.
 * @param role - role assigned to the redeeming device; omission uses the
 * deployment default.
 * @returns the issuance the operator shows the device (for example as QR
 * content).
 */
@Remote('issuePairing') issuePairing(role?: DeviceRole): PairingIssuance

/**
 * Redeem one pairing code with the device's freshly generated Ed25519 key.
 * The grant is durable before the code is consumed: a failed store write
 * leaves the code redeemable instead of burning it.
 * @param request - the single-use code, a device name, and the base64 SPKI
 * DER public key.
 * @returns the created grant identity.
 * @throws RemoteError `device/pairing-invalid`, `device/pairing-expired`,
 * `device/key-invalid`, or `gateway/bad-request`.
 */
@Remote('redeemPairing') async redeemPairing(request: RedeemPairingRequest): Promise<RedeemPairingResult>

/**
 * List every grant, active and revoked; key material stays in the store.
 * Reads come from the domain's in-memory state — the same state every
 * write mutated only after durability — so a read can never go around the
 * write chain to the medium.
 * @returns fresh views in iteration order.
 */
@Remote('listDevices') listDevices(): readonly DeviceView[]

/**
 * Revoke one grant. A revoked grant stays listed with its revocation time;
 * a later role-mapped admission must treat it as refused.
 * @param request - the addressed grant.
 * @returns the revoke acknowledgement.
 * @throws RemoteError `device/not-found` or `device/already-revoked`.
 */
@Remote('revokeDevice') async revokeDevice(request: RevokeDeviceRequest): Promise<RevokeDeviceResult>

/**
 * Revoke every still-active grant — the lost-device panic path. Already
 * revoked grants keep their original revocation time; the event carries
 * exactly the identities this call revoked.
 * @returns the shared revocation time and how many grants it revoked.
 */
@Remote('revokeAllDevices') async revokeAllDevices(): Promise<RevokeAllDevicesResult>

/**
 * Rename one grant's display name; the identity, key, and role are
 * untouched, so an operator reconciling a re-paired device can relabel the
 * stale and current identities without touching access.
 * @param request - the addressed grant and its replacement name.
 * @returns the renamed grant's fresh view.
 * @throws RemoteError `device/not-found` or `gateway/bad-request`.
 */
@Remote('renameDevice') async renameDevice(request: RenameDeviceRequest): Promise<DeviceView>

/**
 * Verify one signed admission and return the device's identity with its
 * section 21 permission set. Checks run cheapest-first: the grant must
 * exist and be active, the signed timestamp must sit inside the admission
 * window, and the Ed25519 signature over `deviceId + "\n" + timestamp +
 * "\n" + nonce` (UTF-8) must verify against the paired key. An admission
 * that replays an already-accepted one — a timestamp older than the grant's
 * durable high-water mark, or a nonce this process or the persisted
 * last-admission pair has already seen — is refused as replay before the
 * grant records the new high-water mark. The Gateway resolves one
 * admission per Remote event stream open and derives the client's reply
 * permissions from the returned set.
 * @param request - the device's signed admission message.
 * @returns the admitted identity, role, and permissions.
 * @throws RemoteError `device/not-found`, `device/already-revoked`,
 * `device/admission-expired`, `device/key-invalid`, `device/replay-detected`,
 * or `gateway/bad-request`.
 */
@Remote('admitDevice') async admitDevice(request: AdmitDeviceRequest): Promise<DeviceAdmission>
```

Source: [`packages/api/device-trust/src/index.ts`](../../packages/api/device-trust/src/index.ts)

<a id="devicetrust-events"></a>

### `deviceTrust/*` events

<a id="devicetrustgrantsrevoked--emit"></a>

#### `deviceTrust/grantsRevoked` — emit

Grants became revoked — by one revocation or revoke-all — so holders of still-open admitted streams must terminate them immediately.

```ts cordis-catalog
/**
 * Grants became revoked — by one revocation or revoke-all — so holders of
 * still-open admitted streams must terminate them immediately.
 * @param revocation - the shared revocation time and the revoked identities.
 * @mode emit
 */
'deviceTrust/grantsRevoked'(revocation: { readonly revokedAt: number; readonly deviceIds: readonly DeviceId[] }): void
```

Source: [`packages/api/device-trust/src/index.ts`](../../packages/api/device-trust/src/index.ts)
<!-- END GENERATED cordis-surface -->
