---
description: "候选网关上的设备信任接缝：一次性配对签发、持久设备授权、签名准入与撤销。"
kind: "package-reference"
---
# 设备信任

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-device-trust` 拥有 Host `ctx.deviceTrust` 服务：[Link 接管审计决策](../../../.agents/notes/implemented/architecture/2026-09-20-link-access-takeover-audit.zh.md)命名的设备信任接缝。网关拥有设备侧接入；配对是能力门控的仪式而非复活的 Link 服务器，权限执行仍归交互回复接缝。服务签发一次性过期配对码、以设备新生成的 Ed25519 公钥兑换、经 storage-domain 接缝持有持久授权存储、验证签名准入并撤销授权。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Host 组合中加载 `@deepseek-ai/dsh-api-device-trust` 以暴露 `ctx.deviceTrust`。Remote 面携带五个能力门控方法（`deviceTrust/issuePairing`、`deviceTrust/redeemPairing`、`deviceTrust/admitDevice`、`deviceTrust/listDevices`、`deviceTrust/revokeDevice`）；能力声明 `device-pair.issue.v1`、`device-pair.redeem.v1`、`device.admit.v1`、`device.list.v1`、`device.revoke.v1`，因此未准备好的 Host 未声明时 Client 拒绝这些操作。issue、list 与 revoke 声明 `requiredPermission: device.admin`：持有该权限的设备标识 Gateway 请求可调用它们；redeem 与 admit 保持未声明，因为它们先于任何设备身份。

配对码是带过期的一次性机密（`pairingTtlMs`，默认五分钟）：第二次兑换以 `device/pairing-invalid` 失败，过期后兑换以 `device/pairing-expired` 失败，非 base64 Ed25519 SPKI DER 的公钥以 `device/key-invalid` 失败。兑换登记公钥的 SHA-256 指纹；列表返回不含密钥材料的视图。撤销保留授权在列表中并记录撤销时间——后续准入必须将其视为拒绝。

角色使用第 21 节表格命名（`viewer`、`collaborator`、`controller`、`owner`），并恰好持有该表格的权限列（经 `DEVICE_ROLE_PERMISSIONS`：`view`、`prompt.send`、`question.respond`、`approval.respond`、`device.admin`）；从不授予表外能力或权限。Host 默认角色来自 `defaultRole`（默认 `viewer`）。

`admitDevice` 验证一次签名准入：签名是设备以配对密钥对 `deviceId + "\n" + timestamp + "\n" + nonce` 的 UTF-8 字节生成的 base64 Ed25519，时间戳必须落在接受窗口内（`admissionWindowMs`，默认五分钟），且每个请求携带全新 nonce。检查按代价从低到高执行——未知设备（`device/not-found`）、已撤销授权（`device/already-revoked`）、过期或超前时间戳（`device/admission-expired`）、然后是签名（`device/key-invalid`）——重放的准入以 `device/replay-detected` 拒绝，判断先于授权记录新的高水位：时间戳早于授权持久化的 `lastAdmittedAt`，或 nonce 已在本进程见过、或等于持久化的 `lastAdmittedNonce`。持久化高水位对跨 Host 重启生效；进程内 nonce 账本在两倍接受窗口后过期——超过该视界后，重放的准入本就无法通过窗口检查。网关在每次 Remote 事件流打开与每个设备标识请求上各解析一次准入，并从返回的角色集派生该 client 的回复权限与端点的权限门控。

<a id="model-experience"></a>
## 模型体验

无，因为配对仪式与准入属于 Client 与 Host 的控制状态，并且不注册提示词、工具或会话事件。

#### KV Cache 影响

无直接影响；设备信任操作不会改变模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 授权存于持久的 `device_trust` 存储域（组合的 json 后端上的 single 布局）：授权在 Host 重启后存活，非法存储记录使 open 拒绝，存储写入失败时配对码保持可兑换。待定配对码按设计保持进程内——一次性过期机密不得在重启后存活。
- 准入在每次 Remote 事件流打开时验证一次；撤销在设备下次重连时生效，按请求的业务 RPC 签名保持延期。接受窗口是重放卫生，不是防重放的 nonce 账本。
- `device/*` 失败码在共享呈现词表中除 `device/admission-expired`（authentication：重新签名后重试）外保持刻意未分类；配对仪式码尚不具备跨 Client 语义。
- 此处不开放任何非 localhost 准入：LAN TLS/pinning 决策之前 localhost 防线保持关闭。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`.agents/notes/implemented/architecture/2026-09-20-link-access-takeover-audit.zh.md` 记录的审计决策拥有归属：退役的 `packages/remote/link-*` 与 `device-trust` 组保持退役，本接缝是候选网关上设备侧接入的唯一归属。

</details>

**运行时不变式：** 不发布伴生入口。授权经 `device_trust` 域持久而配对码进程内；角色命名第 21 节权限列，权限执行仍归交互回复接缝，准入把一次签名验证绑定到一次流打开。
