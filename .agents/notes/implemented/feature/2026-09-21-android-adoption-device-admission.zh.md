# Agent Note: Android 客户端为每个业务调用签名设备准入

Status: implemented

[English](2026-09-21-android-adoption-device-admission.md) | 中文

- 日期：2026-09-21
- 类别：feature
- 范围：`apps/android/core`（`DeviceAdmission.kt`、`LinkWire.kt`、`LinkClient.kt`）、`apps/android/support`（`link-admission.mjs`、`link-admission.test.mjs`、`link-fixture-host.mjs`）

## 问题

nonce 账本加固了 Host，但没有任何客户端签名准入：Android LinkWire 客户端的业务 RPC 信封与流打开 payload 不携带体内设备身份，网关的按请求准入路径没有生产方，重放防御也缺少端到端检验。

## 决策

每个业务调用现在携带四键准入。`DeviceAdmission.create` 以配对 Ed25519 密钥对三段式 `deviceId\ntimestamp\nnonce` 签名，每次调用全新 UUID nonce。`LinkRequestEnvelope` 将其渲染为 `args` 旁的 `payload.device`——Link 线协议对网关版本化请求信封的镜像——`stream()` 将其放在 `args.device`，对应网关流打开的位置。`currentIdentity()` 收拢了载体头部已在用的配对身份加载。配对与 `/link/describe` 保持无准入：它们先于业务身份或不需要。

夹具 Host 经可测的追踪器（`link-admission.mjs`）校验网关所执行的语义：四键形状、接受窗口、对配对注册密钥的签名，以及重放账本——每设备 seen-nonce（逐条惰性过期，两倍窗口视界）加上最后接受的 timestamp/nonce 对，nonce 在任意时间戳重用与时间戳回退均以 `device/replay-detected` 拒绝。追踪器刻意进程内；持久化归产品网关。`/api` 与 `/link/stream` 现在强制要求准入，未签名的调用过不了 lane。

## 证据

- `:core:test`——`LinkClientTest` 证明携带的签名恰为以存储密钥对三段式的确定性重签，且两次调用 nonce 不同；`LinkWireTest` 钉住 `payload.device` 渲染；两处信封形状 pin 随行为更新。
- `node --test apps/android/support/link-admission.test.mjs`——追踪器五个用例：准入、畸形形状、not-found/expired/外来密钥、两种重放拒绝、账本过期。
- 模拟器 lane（真实应用 UI 经夹具配对）在两条面验证五次准入、五个不同 nonce——`/api/session/list`、`/api/workspaceFiles/list`、`/api/workspaceFiles/read`、`/link/stream/$events`、`/link/stream/workspace/follow`——分类的 `gateway/permission-denied` 拒绝仍正常呈现，证明准入校验先于权限门控，与网关次序一致。

## 备选方案

- 只用载体头部（既有 `x-dsh-*` 请求签名）：那签名的是传输请求而非体内的按请求身份，网关的准入路径看不到它。
- 给 `/link/describe` 加准入：describe 是网关匿名提供的 Host 元数据，签名无增益且把描述与配对状态耦合。

## 后果

- 被捕获的 Link 请求体作为重放已失效：nonce 账本在下一次呈现时拒绝它，重试需要配对密钥签出的全新 nonce。
- 夹具的重放账本进程内；夹具重启遗忘 seen-nonce（lane 工具不声明网关的持久高水位语义）。
- iOS 侧采用仍开放；该客户端表面的 Swift 镜像尚不存在。
