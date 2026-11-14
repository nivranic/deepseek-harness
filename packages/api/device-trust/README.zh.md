---
description: "候选网关上的设备信任接缝：一次性配对签发、持久设备授权、签名准入与撤销。"
kind: "package-reference"
---
# 设备信任

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-device-trust` 拥有 Host `ctx.deviceTrust` 服务：[Link 接管审计决策](../../../.agents/notes/implemented/architecture/2026-09-20-link-access-takeover-audit.zh.md)命名的设备信任接缝。网关拥有设备侧接入；配对是能力门控的仪式而非复活的 Link 服务器，权限执行仍归交互回复接缝。服务签发一次性过期配对码、以设备新生成的 Ed25519 公钥兑换、经 storage-domain 接缝持有持久授权存储、验证签名准入并撤销授权。已完成的撤销在 `deviceTrustMetadata` 同意门下经可选的 telemetry owner 以一条 ops 记录外发——仅携带撤销时间与撤销数量。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Host 组合中加载 `@deepseek-ai/dsh-api-device-trust` 以暴露 `ctx.deviceTrust`。Remote 面携带七个能力门控方法（`deviceTrust/issuePairing`、`deviceTrust/redeemPairing`、`deviceTrust/admitDevice`、`deviceTrust/listDevices`、`deviceTrust/revokeDevice`、`deviceTrust/revokeAllDevices`、`deviceTrust/renameDevice`）；能力声明 `device-pair.issue.v1`、`device-pair.redeem.v1`、`device.admit.v1`、`device.list.v1`、`device.revoke.v1`、`device.revoke-all.v1`、`device.rename.v1`，因此未准备好的 Host 未声明时 Client 拒绝这些操作。issue、list、revoke、revoke-all 与 rename 声明 `requiredPermission: device.admin`：持有该权限的设备标识 Gateway 请求可调用它们；redeem 与 admit 保持未声明，因为它们先于任何设备身份。

配对码是带过期的一次性机密（`pairingTtlMs`，默认五分钟）：并发或后续重复兑换以 `device/pairing-invalid` 失败，过期后兑换以 `device/pairing-expired` 失败，非 base64 Ed25519 SPKI DER 的公钥以 `device/key-invalid` 失败。兑换登记公钥的 SHA-256 指纹；列表返回不含密钥材料的视图。撤销保留授权在列表中并记录撤销时间——后续准入必须将其视为拒绝。

角色使用第 21 节表格命名（`viewer`、`collaborator`、`controller`、`owner`），并恰好持有该表格的权限列（经 `DEVICE_ROLE_PERMISSIONS`：`view`、`prompt.send`、`question.respond`、`approval.respond`、`device.admin`）；从不授予表外能力或权限。Host 默认角色来自 `defaultRole`（默认 `viewer`）。

`admitDevice` 使用配对密钥验证对 `deviceId + "\n" + timestamp + "\n" + nonce` 的 UTF-8 字节生成的 base64 Ed25519 签名。每个请求携带全新 nonce，时间戳必须落在 `admissionWindowMs` 内（默认五分钟）。未知设备、已撤销授权、过期时间戳与无效签名均在持久化准入前失败。全新证明允许按时间戳乱序到达。串行存储更新重新检查撤销与有效期；nonce 哈希已消耗或时间戳低于持久化淘汰下界时，以 `device/replay-detected` 拒绝，并在返回前持久化获准的哈希。全部保留记录跨 Host 重启生效。`lastAdmittedAt` 仅为展示记录最新获准时间戳。

`maxAdmissionNonces` 限制每台设备保留的哈希数（默认 4096）。账本满时以 `device/admission-capacity` 拒绝（`host-state`，详情为 `deviceId`、`limit`、`retryAt`），不会驱逐仍有效的记录；记录过期后，后续显式请求可获准。单调不减的淘汰下界防止时钟回拨或窗口扩大使已丢弃证明重新有效。`device_trust` 域要求版本 2，无迁移地拒绝版本 1。[准入决定](../../../.agents/notes/implemented/bug-fix/2026-09-26-durable-unordered-device-admission.zh.md)记录设计理由与重放先到达的限制。

<a id="model-experience"></a>
## 模型体验

无，因为配对仪式与准入属于 Client 与 Host 的控制状态，并且不注册提示词、工具或会话事件。

#### KV Cache 影响

无直接影响；设备信任操作不会改变模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 授权存于持久的 `device_trust` 存储域（组合的 json 后端上的 single 布局）：授权在 Host 重启后存活，非法存储记录使 open 拒绝，存储写入失败时配对码保持可兑换。待定配对码按设计保持进程内——一次性过期机密不得在重启后存活。
- 准入提交在同一存储更新内重新检查撤销、有效期、nonce 消耗记录与容量，排在撤销之后的请求不能获准。Gateway 从流准入等待开始观察撤销，并要求设备交互回复携带原设备的新签名；[Gateway README](../gateway/README.zh.md)拥有流与回复规则。
- 共享呈现把 `device/admission-expired` 与 `device/key-invalid` 分类为 authentication，把 `device/not-found` 分类为 unavailable，把 `device/already-revoked` 分类为 conflict。其他配对失败保留其所有者定义的错误码。
- 本服务不打开网络监听器。[原生 Remote Connection](../native-remote/README.zh.md) 提供按需启用的加密设备入口，不放松本地 Web 认证。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`.agents/notes/implemented/architecture/2026-09-20-link-access-takeover-audit.zh.md` 记录的审计决策拥有归属：退役的 `packages/remote/link-*` 与 `device-trust` 组保持退役，本接缝是候选网关上设备侧接入的唯一归属。第 44 节外发在每条撤销路径内探测 `ctx.get('sessionTelemetry')`——同意状态在 owner 自身构造时冻结，探测因此不引入组合顺序耦合——记录只携带 `revokedAt` 与 `deviceCount`：任何 deviceId、密钥指纹、角色或密钥材料都不会离开。

</details>

**运行时不变式：** 不发布伴生入口。授权经 `device_trust` 域持久而配对码进程内；角色命名第 21 节权限列，权限执行仍归交互回复接缝，准入把一次签名验证绑定到一次流打开。
