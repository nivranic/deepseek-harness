# Remote link access

English | [中文](remote-link.zh.md)

The remote link subsystem lets paired native companion clients reach one Harness host over the network. `ctx.deviceTrust` owns the durable trust material: a stable host identity, one-time pairing codes stored only as SHA-256 digests, and device records carrying an Ed25519 public key, a role (`observer`, `controller`, reserved `administrator`), Session and Workspace grants, timestamps, and revocation. `ctx.linkAccess` owns the carrier: a TLS listener whose certificate is identified to devices by the SHA-256 fingerprint of its SubjectPublicKeyInfo, device request authentication (timestamp-windowed Ed25519 signatures over method, path, and body digest), and a role-gated endpoint allowlist with fixed resource scopes and an independent remote-approval switch. Unary RPC dispatches through the Connection shared `/api` handler and Remote streams through `typertGateway.wireStream` — the same adapter pair the desktop carrier uses — so the subsystem adds an access layer, never a second business gateway. Session, Workspace, Artifact, Attachment, and Gateway services retain their business relationships and pending-event state.

Pairing is initiated on the host (`ctx.linkAccess.createPairing()` renders a QR payload: host id and name, endpoint, certificate fingerprint, one-time code, expiry). The device verifies the fingerprint during the TLS handshake before any request byte is written, exchanges the code for a device identity, and keeps its signing key in platform secure storage. Pairing persists the deployment's `pairingAccess` grants, defaulting to every Session and Workspace for the explicit single-user pairing flow. The carrier checks those grants before calling a resource owner and projects Host-wide Session, Workspace, and event feeds before writing to the device socket. A remote interaction answer additionally requires a controller role, the independent `allowRemoteApproval` switch, the device's Host-issued Client generation, a delivery the Gateway still owns as pending, and the interaction Session grant; filtered, disabled, revoked, and stopped generations delegate to the existing Host waterfall instead of creating another approval registry. `ctx.linkSettings` registers the `remote` user-settings namespace — enable cross-device access, allow remote approval, device name — and applies every commit live to the carrier. `ctx.linkController` backs the generated `ctx.remote.link` namespace for local UIs: carrier status with the LAN endpoint and bind diagnostics, one-time pairing issuance for the QR display, and trusted-device listing and revocation; the remote allowlist carries none of those endpoints, so a paired device can never administer the host. The executable reference client is [`dsh-link-client`](../../packages/remote/link-client/README.md); the Apple companion's `SharedAppleRemoteCore` mirrors its state machine in Swift over the generated [`dsh-link-contracts`](../../packages/remote/link-contracts/README.md) models, and Kotlin companions follow the same contract.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdevicetrust--devicetruststore"></a>

### `ctx.deviceTrust` — `DeviceTrustStore`

The Host's device trust store: stable Host identity, one-time pairing codes consumed atomically, and device records with role, resource grants, timestamps, and revocation that the link carrier authorizes against.

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
 * @param access - Session and Workspace grants fixed by the Host at pairing.
 * @returns the durable device record just created.
 * @throws {@link DeviceTrustError} when the code is unknown or expired.
 */
async consumePairing( code: string, device: { readonly name: string; readonly publicKeySpki: string }, role: DeviceRole, access: DeviceAccess, ): Promise<PairedDevice>

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

The native remote access carrier service: TLS listener, device authentication, endpoint and resource-scope authorization, pre-socket projection, and pairing ingress over the existing gateway surface.

```ts cordis-catalog
/**
 * The carrier endpoint the pairing QR carries.
 * @returns the bound `https://` endpoint, or `undefined` while stopped.
 * @throws when a bind attempt failed and the carrier was not restarted.
 */
async endpoint(): Promise<string | undefined>

/**
 * The fingerprint devices pin when pairing with this host.
 * @returns lowercase hex SHA-256 of the host certificate's SPKI, or `undefined` while stopped.
 * @throws when a bind attempt failed and the carrier was not restarted.
 */
async spkiFingerprint(): Promise<string | undefined>

/**
 * Live carrier facts for a local administration surface: whether the TLS
 * listener is bound, the endpoint and fingerprint while it is, and why the
 * last bind attempt failed when one did.
 * @returns the current carrier status.
 */
async carrierStatus(): Promise<LinkCarrierStatus>

/** The device-facing host name; the OS hostname until {@link LinkAccessService.setDeviceName} overrides it.
 * @returns the host name carried in pairing payloads and descriptions.
 */
deviceName(): string

/**
 * Override the device-facing host name shown to paired devices.
 * @param name - non-empty replacement name.
 */
setDeviceName(name: string): void

/**
 * Whether answering remote approvals and questions is currently allowed.
 * @returns the live approval switch.
 */
isRemoteApprovalAllowed(): boolean

/**
 * Flip the independent remote-approval switch without touching the carrier.
 * Disabling delegates every delivered Link interaction back to the Host chain.
 * @param value - whether paired controllers may answer interactions.
 */
setAllowRemoteApproval(value: boolean): void

/**
 * Bind or unbind the TLS carrier at runtime. Operations serialize, so a
 * rapid off/on sequence never double-binds; enabling an already-bound
 * carrier and disabling a stopped one are both no-ops.
 * @param enabled - whether the carrier should be listening.
 * @throws when a bind attempt fails; a later call may retry it.
 */
async setCarrierEnabled(enabled: boolean): Promise<void>

/**
 * Issue one pairing payload for the QR display: host identity, endpoint,
 * certificate fingerprint, and a one-time short-lived code.
 * @returns the payload rendered into the pairing QR code.
 * @throws when the carrier is stopped or its last bind attempt failed.
 */
async createPairing(): Promise<LinkPairingPayload>

/**
 * List every device record, revoked ones included.
 * @returns the trust store's device records.
 */
async trustedDevices(): Promise<readonly PairedDevice[]>

/**
 * Revoke one paired device; its next request is refused and its active
 * Remote Event generation is delegated and closed.
 * @param deviceId - identity of the device to revoke.
 * @returns the device record after revocation, or `undefined` when unknown.
 */
async revokeDevice(deviceId: DeviceId): Promise<PairedDevice | undefined>
```

Source: [`packages/remote/link-access/src/index.ts`](../../packages/remote/link-access/src/index.ts)

<a id="ctxlinkcontroller--linkcontroller"></a>

### `ctx.linkController` — `LinkController`

Host service backing the generated `ctx.remote.link` namespace. Every method reads the link-access carrier; a composition without the carrier fails each call with `link-unavailable` instead of failing at load.

```ts cordis-catalog
/**
 * Report the live carrier and identity facts the settings page renders:
 * listening state, LAN endpoint, certificate fingerprint, bind diagnostics,
 * device-facing name, the approval switch, and the trusted-device count.
 * @returns the cross-device status row.
 * @throws TypertRemoteFailure when no link carrier is mounted.
 */
@Remote async status(): Promise<LinkStatusValue>

/**
 * Issue one pairing payload for the QR display: host identity, endpoint,
 * certificate fingerprint, and a one-time short-lived code.
 * @returns the payload rendered into the pairing QR code.
 * @throws TypertRemoteFailure when no carrier is mounted or its carrier is stopped or failed to bind.
 */
@Remote async createPairing(): Promise<LinkPairingValue>

/**
 * List every trusted device, revoked ones included, for the device manager.
 * @returns one row per device record; the device public key never rides the wire.
 * @throws TypertRemoteFailure when no link carrier is mounted.
 */
@Remote async devices(): Promise<LinkDeviceValue[]>

/**
 * Revoke one paired device; its next request is refused.
 * @param deviceId - identity of the device to revoke.
 * @returns the device row after revocation, or `undefined` when unknown.
 * @throws TypertRemoteFailure when the id is empty or no link carrier is mounted.
 */
@Remote async revokeDevice(deviceId: string): Promise<LinkDeviceValue | undefined>
```

Source: [`packages/api/link-controller/src/index.ts`](../../packages/api/link-controller/src/index.ts)

<a id="ctxlinksettings--linksettingsservice"></a>

### `ctx.linkSettings` — `LinkSettingsService`

The remote settings bridge: registers the `remote` namespace on mount and pushes every resolved value into the link-access carrier.

Source: [`packages/remote/link-settings/src/index.ts`](../../packages/remote/link-settings/src/index.ts)

<a id="device-trust-events"></a>

### `device-trust/*` events

<a id="device-trustrevoked--parallel"></a>

#### `device-trust/revoked` — parallel

A device's first revocation has committed. Every listener runs so active carriers can close that device even when another observer fails.

```ts cordis-catalog
/**
 * A device's first revocation has committed. Every listener runs so active
 * carriers can close that device even when another observer fails.
 * @param deviceId - durable identity whose trust was just revoked.
 * @mode parallel
 */
'device-trust/revoked'(deviceId: DeviceId): Promise<void> | void
```

Source: [`packages/remote/device-trust/src/index.ts`](../../packages/remote/device-trust/src/index.ts)
<!-- END GENERATED cordis-surface -->
