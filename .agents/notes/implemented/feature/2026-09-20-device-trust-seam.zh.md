# Agent Note: 设备信任接缝把配对签发与授权落到网关

Status: implemented

[English](2026-09-20-device-trust-seam.md) | 中文

## 问题

Link 接管审计把候选网关定为设备侧接入的唯一归属，并为 Phase 7 排序：先设备授权存储与配对签发。在该接缝存在之前，候选中没有任何包能签发配对码、登记设备密钥或撤销授权——Android 外壳唯一对话过的配对服务端只有模拟器 lane 的夹具。

## 决策

新包 `@deepseek-ai/dsh-api-device-trust` 位于 `packages/api/device-trust/`：一个 `TypertRemoteService`（`ctx.deviceTrust`），四个能力门控 Remote 方法为 `deviceTrust/issuePairing`（`device-pair.issue.v1`）、`deviceTrust/redeemPairing`（`device-pair.redeem.v1`）、`deviceTrust/listDevices`（`device.list.v1`）、`deviceTrust/revokeDevice`（`device.revoke.v1`）。配对码是带配置过期（`pairingTtlMs`，默认五分钟）的一次性机密：第二次兑换以 `device/pairing-invalid` 失败，逾期兑换以 `device/pairing-expired` 失败，非 base64 Ed25519 SPKI DER 的公钥以 `device/key-invalid` 失败。兑换把公钥的 SHA-256 指纹登记进进程内授权存储；列表返回不含密钥材料的视图；撤销保留授权在列表中并记录撤销时间。角色使用第 21 节线上命名（`viewer`、`collaborator`、`admin`），只命名 Client 下一步可以请求什么——权限执行仍归第 15 节接缝，且不开放任何非 localhost 准入。

该包组合进 web-app Host bundle；web client bundle 携带依赖；仓库登记其 Host 程序、源码路径、子系统页（`docs/subsystems/device-trust.{md,zh.md}` 带全部七个线上类型的 type-equivalence 块）、doc graphs 的服务行以及目录条目。

## 备选方案

- **移植遗留 `link-access` 服务端。** 审计决策否决：网关的能力与权限接缝对设备与 web/desktop 客户端同权适用，并行准入模型会分叉权限语义。
- **本增量同时做持久化。** 推迟：持久授权存储带来 persistence-catalog 与格式版本义务，值得单独一个增量；进程内存储如实记录为局限。
- **把新的 `device/*` 码纳入共享呈现词表。** 按词表自身政策推迟：码只有在具备跨 Client 语义后才进入 `REMOTE_FAILURE_CLASSES`；在此之前保持不透明诊断可呈现。

## 后果

Phase 7 在具名接缝上有了首个增量：操作者可签发码值，设备可用其 Ed25519 密钥兑换，授权列表不含密钥材料，撤销以稳定的 `device/*` 失败码执行（已知码 schema 现承载 89 码；Kotlin 与 Swift 契约夹具由再生成投影刷新）。审计笔记中被退役组的引用已改写，package-paths 门禁不再把其读作对新真实包名 `device-trust` 的漂移。Phase 7 下一步：持久授权存储、经第 15 节接缝的角色映射权限检查、请求签名准入；Android 外壳在配对接缝完整后迁到网关准入。
