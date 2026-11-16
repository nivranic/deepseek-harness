# Agent Note: 崩溃诊断经 ops 遥测出口在自身同意类门下外发

Status: implemented

[English](2026-10-06-crash-diagnostics-outlet.md) | 中文

## Problem

§44 四个非 session 类遥测出口随生产者落地。crash 类已有本地源——诊断记录器在 boot 时检测不干净关机并维护持久 crash log——但没有出口：任何事实都不离机，同意记录的 crashDiagnostics 开关无生产者可门控。遥测 seam 的文档自始承诺双 instrumentation scope（ledger 与 ops 记录分置不同 logger scope），但 OpenTelemetry 后端只建单一 scope 且把一切直接记录丢弃在地。

## Decision

Producer 推出口+可选结构化 owner，外加 seam 早已承诺的出口侧收窄：

1. **生产者侧**（`packages/api/host-diagnostics/src/recorder.ts`）：boot 检测发现不干净关机 crash fact 时，recorder 推出一条 ops 记录——`channel:'ops'`、severity error、`attributes['telemetry.op']='diagnostics-crash'`（coordinator 的 agent-error/shutdown ops 先例所用判别子）、`body` 携带可恢复的 `pid`/`runStartedAt` 字段——经 `ctx.get('sessionTelemetry')` 一次性快照的可选 owner（本包既有 lazy-resolve 家族）。owner 缺席或该类被保留：静默零调用零异常——§44 默认即关，且与用户提交了反馈却无处上传不同，被保留的崩溃报告无可感知损失，故不告警。只外发本次 boot 检测到的 fact，历史绝不重发（重发会让每个崩溃每次 boot 重复一次，给 fact 打已上报标记则会改变 crash log 语义）。运行期 agent-error 环（携带 message 文本）维持本地——先做最小外发面。
2. **出口侧**（`packages/session/session-telemetry-otel/src/index.ts`）：provider 构造门从仅 `sessionTelemetry` 放宽为 `sessionTelemetry || crashDiagnostics`（加载期校验——尤其 exporter.url——随达 crash-only opt-in）；新增独立 `/ops` logger scope，兑现 seam 双 scope 承诺；直接 emit 覆写从丢弃一切收窄为丢弃 `channel:'ledger'` 直发、放行 `channel:'ops'` 记录进 ops scope——且 ops 发射仅在 crashDiagnostics 类开启时创建，使后端门与构造门、生产者自查对称。crash-only 组合下无 coordinator 排空 provider，fiber 拆卸 effect 调用 `shutdown()`（受 shutdown 截止时限界定、失败含告警遏制）——崩溃记录绝不能随进程消亡。`mode: DISABLED` 仍是总闸：零 SDK 状态、零外发、consent 照常解析。feedback-withheld 告警移至「sessionTelemetry 关」分支，语义不变。
3. **零运行时依赖**（`host-diagnostics/package.json`）：`dsh-session-telemetry` 为 type-only dev 依赖；生产者的类检查是本地 `crashDiagnostics === true` 特化、注释注明权威 `telemetryKindAllowed`——发射的声明面不含对 telemetry 包的 import（构建产物 `lib/types/recorder.d.ts` 实证）。

## Alternatives considered

- **复用捕获 coordinator**：拒绝——`captureSession` 绑定 Session 且部署模式不注册监听；coordinator 自己的 ops 先例（`relayAgentError`）就是直接 deliver 给 backend，正是此处采纳的通道。
- **cordis 事件作传输**：暂拒——零运行时依赖与既有 lazy-get 家族使接缝更小；事件声明可日后替代直调而不改两侧测试。
- **发射时重读 settings**：拒绝——`applies:'restart'` 下构造时快照即有效同意；运行中切换不得泄漏用户刚关闭的外发。
- **错误环一并外发**：本刀拒绝——message 是自由文本；crash facts（pid、时间戳）是最窄诚实载荷。

## Consequences

开启 crash 类的部署现在经独立 ops scope 把不干净关机报出机外，url 校验与 shutdown 时限与 session 遥测同格适用；其余三个出口仍随生产者待落地（relay 阻塞于 §23；provider attribution headers 语义裁定留待该类出口代际）。loader-composition e2e 存在与本改动无关的既有基线失败（全仓无 `DSH_TELEMETRY_CONSENT` 设置点、Windows source 启动形态不物化 `.sessions`）——钉为开放通道。

## Open follow-ups

- providerMetadata 出口与 attribution-headers 语义裁定。
- deviceTrustMetadata 出口。
- relayMetadata 出口（阻塞于 §23）。
- loader-composition e2e 的 `DSH_TELEMETRY_CONSENT` 设置点（上述开放通道）。
- §56 构建修订号注入接线。
