# 远程链接访问

[English](remote-link.md) | 中文

远程链接子系统让已配对的原生伴侣客户端经网络接入单个 Harness 宿主。`ctx.deviceTrust` 拥有持久信任材料：稳定的宿主身份、仅以 SHA-256 摘要存储的一次性配对码，以及携带 Ed25519 公钥、角色（`observer`、`controller`、预留的 `administrator`）、时间戳与吊销状态的设备记录。`ctx.linkAccess` 拥有载体：一个 TLS 监听器，其证书以 SubjectPublicKeyInfo 的 SHA-256 指纹向设备标识；设备请求认证（带时间窗的 Ed25519 签名，覆盖方法、路径与请求体摘要）；带角色门控与独立远程审批开关的远程端点 Allowlist；以及配对接入。单次 RPC 经 Connection 共享 `/api` 处理器分发，Remote 流经 `typertGateway.wireStream`——与桌面载体使用的同一对适配器——因此本子系统增加的是访问层，绝不是第二套业务网关。

配对由宿主发起（`ctx.linkAccess.createPairing()` 渲染 QR 载荷：宿主 id 与名称、端点、证书指纹、一次性配对码、过期时间）。设备在 TLS 握手期、写出任何请求字节之前校验指纹，用配对码换取设备身份，并把签名密钥保存在平台安全存储中。吊销设备会在其下一个请求生效；回答远程交互还额外要求 `allowRemoteApproval` 开关，因此"能发 Prompt"绝不意味着"能审批"。两个宿主侧组件补齐 Phase 1 管理面。`ctx.linkSettings` 注册 `remote` 用户设置命名空间——启用跨设备访问、允许远程审批、设备名——并把每次提交实时应用到载体，桥接挂载后这三项字段以设置文档为属主。`ctx.linkController` 支撑面向本地 UI 生成的 `ctx.remote.link` 命名空间：带 LAN 端点与绑定诊断的载体状态、供二维码展示的一次性配对签发、受信设备列表与吊销；远程 Allowlist 不收录这些端点，因此已配对设备永远无法管理宿主。可执行参考客户端是 [`dsh-link-client`](../../packages/remote/link-client/README.zh.md)；原生伴侣端按同一套线缆词汇复刻其状态机。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
 * Revoke one paired device; its next request is refused.
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
<!-- END GENERATED cordis-surface -->
