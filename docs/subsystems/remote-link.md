# Remote link access

English | [中文](remote-link.zh.md)

The remote link subsystem lets paired native companion clients reach one Harness host over the network. `ctx.deviceTrust` owns the durable trust material: a stable host identity, one-time pairing codes stored only as SHA-256 digests, and device records carrying an Ed25519 public key, a role (`observer`, `controller`, reserved `administrator`), timestamps, and revocation. `ctx.linkAccess` owns the carrier: a TLS listener whose certificate is identified to devices by the SHA-256 fingerprint of its SubjectPublicKeyInfo, device request authentication (timestamp-windowed Ed25519 signatures over method, path, and body digest), a role-gated remote endpoint allowlist with an independent remote-approval switch, and the pairing ingress. Unary RPC dispatches through the Connection shared `/api` handler and Remote streams through `typertGateway.wireStream` — the same adapter pair the desktop carrier uses — so the subsystem adds an access layer, never a second business gateway.

Pairing is initiated on the host (`ctx.linkAccess.createPairing()` renders a QR payload: host id and name, endpoint, certificate fingerprint, one-time code, expiry). The device verifies the fingerprint during the TLS handshake before any request byte is written, exchanges the code for a device identity, and keeps its signing key in platform secure storage. Revoking a device cuts its authorization on its next request; answering remote interactions additionally requires the `allowRemoteApproval` switch, so the ability to prompt never implies the ability to approve. The executable reference client is [`dsh-link-client`](../../packages/remote/link-client/README.md); native companions reimplement its state machine against the same wire vocabulary.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdevicetrust--devicetruststore"></a>

### `ctx.deviceTrust` — `DeviceTrustStore`

The Host's device trust store: stable Host identity, one-time pairing codes consumed atomically, and the device records the link carrier authorizes against.

```ts cordis-catalog
/** Resolve this store's stable Host identity, creating it on first use.
 * @returns the Host identity record.
 */
async hostIdentity(): Promise<HostIdentity>

/**
 * Issue one pairing code. The code is 256 random bits shown once (QR) and
 * stored only as its SHA-256 digest, so a database read cannot mint credentials.
 * @param ttlSeconds - lifetime of the code, from issue to expiry.
 * @returns the pending pairing to display to the device being paired.
 */
async createPairing(ttlSeconds: number): Promise<PendingPairing>

/**
 * Consume one pairing code and register the device. Consumption is atomic:
 * the code row is deleted first and a second consumer of the same code
 * fails, whether the two calls race or follow one another.
 * @param code - pairing code from {@link DeviceTrustStore.createPairing}.
 * @param device - user-chosen name and verified public key of the pairing device.
 * @param role - authorization role granted to the device.
 * @returns the durable device record just created.
 * @throws {@link DeviceTrustError} when the code is unknown or expired.
 */
async consumePairing( code: string, device: { readonly name: string; readonly publicKeySpki: string }, role: DeviceRole, ): Promise<PairedDevice>

/**
 * Read one device record, including revoked ones.
 * @param deviceId - identity of the device to read.
 * @returns the record, or `undefined` when no such device exists.
 */
async device(deviceId: DeviceId): Promise<PairedDevice | undefined>

/**
 * List every device record, revoked ones included, oldest first.
 * @returns every device record in the store.
 */
async devices(): Promise<readonly PairedDevice[]>

/**
 * Revoke one device. A revoked device keeps its record (audit) and loses
 * authorization immediately; revoking twice is a no-op.
 * @param deviceId - identity of the device to revoke.
 * @returns the device record after revocation, or `undefined` when unknown.
 */
async revoke(deviceId: DeviceId): Promise<PairedDevice | undefined>

/**
 * Record that a trusted device just made an authorized request. Revoked
 * devices are never touched, so re-pairing cannot resurrect `lastSeenAt`.
 * @param deviceId - identity of the device that was just authorized.
 * @returns resolution after the write settles.
 */
async touch(deviceId: DeviceId): Promise<void>

/** Close the database; every later primitive rejects. Idempotent.
 * @returns resolution after the medium is released.
 */
async close(): Promise<void>
```

Source: [`packages/remote/device-trust/src/index.ts`](../../packages/remote/device-trust/src/index.ts)

<a id="ctxlinkaccess--linkaccessservice"></a>

### `ctx.linkAccess` — `LinkAccessService`

The native remote access carrier service: TLS listener, device authentication, remote endpoint authorization, and the pairing ingress over the existing gateway surface.

```ts cordis-catalog
/**
 * The carrier endpoint the pairing QR carries.
 * @returns the bound `https://` endpoint, or `undefined` while disabled.
 * @throws when the carrier failed to bind.
 */
async endpoint(): Promise<string | undefined>

/**
 * The fingerprint devices pin when pairing with this host.
 * @returns lowercase hex SHA-256 of the host certificate's SPKI, or `undefined` while disabled.
 * @throws when the carrier failed to bind.
 */
async spkiFingerprint(): Promise<string | undefined>

/**
 * Issue one pairing payload for the QR display: host identity, endpoint,
 * certificate fingerprint, and a one-time short-lived code.
 * @returns the payload rendered into the pairing QR code.
 * @throws when the carrier is disabled or failed to bind.
 */
async createPairing(): Promise<LinkPairingPayload>

/**
 * List every device record, revoked ones included.
 * @returns the trust store's device records.
 */
async trustedDevices(): Promise<readonly PairedDevice[]>

/**
 * Revoke one paired device; its next request is refused.
 * @param deviceId - identity of the device to revoke.
 * @returns the device record after revocation, or `undefined` when unknown.
 */
async revokeDevice(deviceId: DeviceId): Promise<PairedDevice | undefined>
```

Source: [`packages/remote/link-access/src/index.ts`](../../packages/remote/link-access/src/index.ts)
<!-- END GENERATED cordis-surface -->
