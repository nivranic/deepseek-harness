---
description: "候选网关上的设备信任接缝：一次性配对签发、设备授权与撤销。"
kind: "package-reference"
---
# 设备信任

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-device-trust` 拥有 Host `ctx.deviceTrust` 服务：[Link 接管审计决策](../../../.agents/notes/implemented/architecture/2026-09-20-link-access-takeover-audit.zh.md)命名的设备信任接缝。网关拥有设备侧接入；配对是能力门控的仪式而非复活的 Link 服务器，权限执行仍归交互回复接缝。服务签发一次性过期配对码、以设备新生成的 Ed25519 公钥兑换、经 storage-domain 接缝持有持久授权存储并撤销授权。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Host 组合中加载 `@deepseek-ai/dsh-api-device-trust` 以暴露 `ctx.deviceTrust`。Remote 面携带四个能力门控方法（`deviceTrust/issuePairing`、`deviceTrust/redeemPairing`、`deviceTrust/listDevices`、`deviceTrust/revokeDevice`）；能力声明 `device-pair.issue.v1`、`device-pair.redeem.v1`、`device.list.v1`、`device.revoke.v1`，因此未准备好的 Host 未声明时 Client 拒绝这些操作。

配对码是带过期的一次性机密（`pairingTtlMs`，默认五分钟）：第二次兑换以 `device/pairing-invalid` 失败，过期后兑换以 `device/pairing-expired` 失败，非 base64 Ed25519 SPKI DER 的公钥以 `device/key-invalid` 失败。兑换登记公钥的 SHA-256 指纹；列表返回不含密钥材料的视图。撤销保留授权在列表中并记录撤销时间——后续角色映射的准入必须将其视为拒绝。

角色使用第 21 节线上命名（`viewer`、`collaborator`、`admin`），只命名 Client 下一步可以请求什么，从不直接授予能力或权限。Host 默认角色来自 `defaultRole`（默认 `viewer`）。

<a id="model-experience"></a>
## 模型体验

无，因为配对仪式属于 Client 与 Host 的控制状态，并且不注册提示词、工具或会话事件。

#### KV Cache 影响

无直接影响；设备信任操作不会改变模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 授权存于持久的 `device_trust` 存储域（组合的 json 后端上的 single 布局）：授权在 Host 重启后存活，非法存储记录使 open 拒绝，存储写入失败时配对码保持可兑换。待定配对码按设计保持进程内——一次性过期机密不得在重启后存活。第 15 节接缝的角色映射权限检查与请求签名准入仍是 Phase 7 下一步。
- 新的 `device/*` 失败码在共享呈现词表中保持刻意未分类，直到它们具备跨 Client 语义。
- 此处不开放任何非 localhost 准入：LAN TLS/pinning 决策之前 localhost 防线保持关闭。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`.agents/notes/implemented/architecture/2026-09-20-link-access-takeover-audit.md` 记录的审计决策拥有归属：退役的 `packages/remote/link-*` 与 `device-trust` 组保持退役，本接缝是候选网关上设备侧接入的唯一归属。

</details>

**运行时不变式：** 不发布伴生入口。授权经 `device_trust` 域持久而配对码进程内；角色命名 Client 的下一步，权限执行仍归交互回复接缝。
