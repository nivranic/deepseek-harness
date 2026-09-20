# Agent Note: Link 接管审计——候选网关拥有设备侧接入

Status: implemented

[English](2026-09-20-link-access-takeover-audit.md) | 中文

## 问题

规格 §48 列出 pre-upstream 的 `packages/remote/link-access`、`packages/remote/device-trust`、`packages/remote/link-contracts`，并禁止默认原样继续：Agent 必须先审计官方当前 API/Connection 能否接管这些责任，再按最新 upstream 包归属做最终放置。模拟器 lane 现在用迁入的 Link 客户端协议对夹具 Host 说话，而候选 harness 不提供 `/link/pair` 端点——归属问题卡着 Phase 7（Device Trust）与 Phase 8（Remote Transport）。

## 审计发现

- **遗留三件套拥有的东西**：二维码配对仪式（一次性码值，§70 的 nonce + expiry + single-use）、设备授权（可撤销，observer/controller/administrator 三角色，§20–§22 的 last-seen/指纹记录）、Noise/pinning TLS 传输与 Ed25519 请求签名，以及 `/link/pair`、`/link/describe`、`/api/$method`、`/link/stream/$endpoint` 的线上契约。这些服务端代码候选里都不存在：历史源码只带 Android 客户端，夹具 Host（`apps/android/support/link-fixture-host.mjs`）是 lane 工具而非产品面。
- **候选已有的**：Typert RPC 网关（`@deepseek-ai/dsh-api-gateway`）在 Connection 共享 `/api` 载体上提供分发、校验、取消、流、事件转发、能力协商（§13）、诊断层级（§14）与交互回复权限（§15）；webserver 从 Host 服务 web/desktop 客户端。请求元数据明确不是授权，今天的信任边界是 Host 的 localhost 载体线（§70 的“不关闭 Host 原有 localhost 防线”）。共享失败词表及其 Kotlin/Swift 镜像是 `dsh-typert-protocol` 与 `apps/*/contract` 里已封存的契约列。
- **缺失的**：任何设备身份、配对、授权、角色、撤销面；任何非 localhost 载体准入；LAN 设备接入的 TLS/pinning 方案。

## 决策

1. **不复活。** `packages/remote/link-*` 与 `packages/remote/device-trust` 保持退役；不从 pre-upstream 树移植任何东西。
2. **候选网关是设备侧接入的唯一归属。** 设备配对与信任作为既有网关 + Connection 载体上的能力门控接缝落地（§13 风格的 `device-pair.v1` 声明），而不是并行的 Link 服务器。网关既有的准入、能力、权限、失败面对设备与对 web/desktop 客户端完全同权适用。
3. **线上协议仍归客户端。** `apps/android/core` 迁入的 Link 客户端栈保持为设备侧载体，直到候选原生的设备接缝存在；夹具 Host 把该线上协议记为 lane 工具。Phase 7 开启时，配对仪式、设备密钥登记、角色、撤销都按网关的契约生成来规格化，§21 的角色表（Viewer/Collaborator/Admin）经既有 §15 接缝调和，而不是沿用 Link 协议的 observer/controller/administrator 命名。
4. **顺序。** Phase 7 从本决策起步：先设备授权存储与配对签发，其次经既有 §15 接缝做角色映射的权限检查，最后撤销与 lost-device UX（§22）。LAN 载体（§24：发现是便利，不是信任）在任何非 localhost 准入前需要 TLS/pinning 决策；localhost 防线在此之前保持关闭。

## 备选方案

- **原样移植遗留 link-access 服务端。** 被规格自身的 audit-first 规则否决；遗留服务端代码不在候选树里，其信任模型早于网关的能力/权限接缝。
- **Link 协议永久作为设备接缝。** 否决：两套并行准入模型（网关能力 vs Link 角色）会分叉权限语义；§15 已在 Host 侧权威执行权限。
- **推迟决策直到 Phase 7 完全开启。** 否决：模拟器 lane 与 Android 外壳的下一步现在就需要具名归属；推迟会让夹具成为隐式答案。

## 后果

设备接入有唯一具名归属（网关 + Connection 载体）与唯一权限执行者（§15 Host 权威接缝）。Android 外壳为模拟器 lane 保留 Link 客户端，在配对接缝落地后迁到网关准入。夹具证书、码值与驱动保持为 lane 工具，不作产品声明。该决策解锁 Phase 7 的首个增量（设备授权存储 + 配对签发），并记录了候选布局里 `packages/remote/*` 保持缺席的原因。
