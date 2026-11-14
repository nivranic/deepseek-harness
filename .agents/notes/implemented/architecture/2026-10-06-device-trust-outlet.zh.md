# Agent Note: 设备信任撤销经 ops 遥测出口在自身同意类门下外发

Status: implemented

[English](2026-10-06-device-trust-outlet.md) | 中文

## Problem

第 44 节余下的非 session 遥测出口随各自生产者落地。deviceTrust 类的本地事实早已存在——每次撤销都更新持久 grants 表并发射 `deviceTrust/grantsRevoked` 事件——但没有出口：任何事实都不离开进程，同意记录里的 `deviceTrustMetadata` 开关也没有可门控的生产者。

## Decision

1. **生产者侧**（`packages/api/device-trust/src/index.ts`）：`revokeDevice` 与 `revokeAllDevices`（仅当真的发生了撤销——零撤销的 revoke-all 与事件条件镜像、零上报）各推一条 ops 记录——`channel:'ops'`、severity info、`attributes['telemetry.op']='device-trust-revocation'`、`body` 只携带 `revokedAt` 与 `deviceCount`——经撤销路径内 `ctx.get('sessionTelemetry')` 现取的可选结构化 owner 外发。记录绝不携带 deviceId、指纹、角色或密钥材料：deviceId 是准标识符，计数加时间是最窄的诚实载荷。owner 缺席或门关：静默零调用零异常，撤销 RPC 行为零变化。
2. **门控时机**：与 crash 记录器不同（boot 一次性事件、构造时快照 owner），撤销是运行期事件——owner 在发射点现取，其暴露的 consent 是遥测服务自身构造时冻结的字段，restart 语义保持且无组合顺序耦合。
3. **出口侧**（`packages/session/session-telemetry-otel/src/index.ts`）：provider 构造门放宽为 `sessionTelemetry || crashDiagnostics || deviceTrustMetadata` 三析取（exporter.url 等加载校验随达 deviceTrust-only opt-in）；ops 发射在任一 ops 生产类开启时创建（crash 代预告的按类放宽）；fiber 拆卸自排空覆盖一切非 session 组合形态；`mode: DISABLED` 仍是总闸。
4. **零运行时依赖**（`device-trust/package.json`）：`dsh-session-telemetry` 是 type-only dev dependency；生产者的类检查是本地 `deviceTrustMetadata === true` 特化、注释点名权威 `telemetryKindAllowed`，镜像记录器先例。
5. **severity**：info 而非 crash 出口的 error——撤销是操作者主动的安全动作，不是故障。

## Alternatives considered

- **外发 deviceId**：拒绝——准标识符；`deviceCount` 加 `revokedAt` 是仍能说清发生了什么的最窄载荷。
- **扩展到 admission/配对/rename**：本切片拒绝——admission 今天不发 cordis 事件，为无 §44 要求的项发明事件只会放宽接缝；撤销才是安全相关事实。
- **照记录器做构造时 owner 快照**：拒绝——撤销是运行期事件；服务注册表加载后静态，发射点查找廉价且无组合顺序耦合，同时 consent 保持 restart 语义。
- **cordis 事件作传输**：暂拒——零运行时依赖与 lazy-get 家族使接缝更小，循 crash 出口先例。

## Consequences

选择开启 deviceTrust 类的部署现在经 ops scope 把撤销上报出进程，url 校验与 shutdown 时限与 session 遥测同等生效；base bundle 的 consent 注释点名该类的生产者（仍默认关）。providerMetadata 与 relayMetadata 仍随生产者待落地（relay 阻塞 §23；provider attribution headers 语义裁定随其出口代际）。顺带修复：device-trust client 叶工程 tsconfig 补上了它实际 import 的两个 storage 工程 reference——陈旧 tsbuildinfo 掩盖的既有缺口，由本代 `tsc -b` 暴露。loader-composition e2e 既有基线红仍钉为开放通道。

## Open follow-ups

- providerMetadata 出口与 attribution headers 语义裁定（含与 sessionTelemetry 类的 usage 双重出口边界）。
- relayMetadata 出口（阻塞于 §23）。
- loader-composition e2e 的 `DSH_TELEMETRY_CONSENT` 设置点（上文开放通道）。
- §56 构建修订标识注入接线。
