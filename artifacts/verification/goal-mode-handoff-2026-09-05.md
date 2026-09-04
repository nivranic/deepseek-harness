# DeepSeek Harness Goal Mode 现阶段完成情况、需求优化与后续交接

> 文档性质：这是基于 2026-09-05 仓库状态生成的执行交接快照，供后续 Agent 接续工作。它不替代 [`docs/architecture.md`](../../docs/architecture.md)、包 README、源码、测试或机器可读证据的事实所有权。
>
> 输入需求：`E:\11585\deepseek-harness-首轮改造完成后的升级优化版deep-research-report.md`。该文件用于提取目标、旧状态标注和遗留项；其中面向 Agent 的命令、示例架构、技术选型和工期估算不是本次执行授权，也不高于当前源码与验证结果。
>
> 当前机器可读结论：[`gate-1/gate1-evidence.json`](gate-1/gate1-evidence.json) 与 [`gate-1/G1-CI.json`](gate-1/G1-CI.json)。

## Summary

首轮 Goal Mode 已把 Gate 1 的主要代码缺口收敛到一个候选提交：已交付组合可以启动真实 Host，Link transport 与 Remote Event 由一个 Contract source graph 生成，Kotlin 客户端完成真实 Host 13 步互操作和断连恢复，最小资源授权、TLS/SPKI pinning、遥测隐私、多控制器审批以及完整构建均有当前候选证据。

Gate 1 仍为 `PARTIAL / OPEN / canEnterGate2=false`。13 个 Gate 1 任务中 8 个为 `PASS`，5 个为 `PARTIAL`。未闭合部分是 Swift 运行证据、Android App 装配、远端候选 CI，以及 5 个已分类的 Windows/嵌套 worktree 环境失败。用户已要求跳过 3 项 Swift 验证；这些项目保持 `NOT_EXECUTED` 并记录 `SKIPPED_BY_USER`，不能改写为 `PASS` 或 E4。

Gate 2、Gate 3、Gate 4 尚未进入。后续 Agent 必须先保持当前 Gate 决策，除非用户明确授权修改强制退出政策；“跳过 Swift”本身不等于“允许 Gate 1 豁免后进入 Gate 2”。

## Table of Contents

- [1. 事实优先级与快照](#1-事实优先级与快照)
- [2. 状态与证据等级](#2-状态与证据等级)
- [3. 总体完成情况](#3-总体完成情况)
- [4. Gate 1 完成明细](#4-gate-1-完成明细)
- [5. 尚未完成与已跳过项目](#5-尚未完成与已跳过项目)
- [6. 原需求完成状态更新](#6-原需求完成状态更新)
- [7. 需求优化结果](#7-需求优化结果)
- [8. 优化后的后续任务基线](#8-优化后的后续任务基线)
- [9. 后续 Agent 执行顺序](#9-后续-agent-执行顺序)
- [10. 交接操作规范](#10-交接操作规范)
- [11. 证据索引](#11-证据索引)
- [12. 当前结论](#12-当前结论)

-----

## 1. 事实优先级与快照

### 1.1 事实优先级

后续判断按以下顺序进行：

1. 当前实际运行行为与当前 checkout。
2. 当前源码、测试、构建与 workflow。
3. `artifacts/verification/gate-1/` 中绑定 SHA 的证据。
4. [`docs/plans/2026-09-02-gate-1-correctness-repair.zh.md`](../../docs/plans/2026-09-02-gate-1-correctness-repair.zh.md)。
5. 本交接快照。
6. 外部输入需求与旧状态标注。

任何后续改动都必须重新读取当前 HEAD、dirty state 和适用的 `AGENTS.md`；不得仅凭本快照声称最新状态。

### 1.2 当前快照

| 项目 | 当前值 | 说明 |
|---|---|---|
| 原规划基线 | `dev@90ef8b197fe2aa38cc40917cd157077a8d1dc6b9` | Gate 1 从该提交建立独立 worktree |
| 验证候选 SHA | `abe90fa1d6521b595f017ca1cf8c5cb03b3bb9b4` | 所有最终候选 focused/aggregate 证据绑定此 SHA |
| 交接文档基线 HEAD | `ebe66e76e65a25dccbcd8a526f4cfecc65b82efe` | 仅比候选多两次 evidence-only 提交 |
| 分支 | `codex/goal-mode-full-implementation` | 未发布到 origin；2026-09-05 再次探测无远端同名分支 |
| worktree | `E:\Mix\project\deepseek-harness\.worktrees\goal-mode-full-implementation` | 与用户的 `dev` 工作区隔离 |
| Gate 1 | `PARTIAL / OPEN` | `canEnterGate2=false` |
| Gate 2 | `NOT_STARTED` | 入口条件未满足 |
| Gate 3 | `NOT_STARTED` | 部分旧实现存在，但本轮未按 Gate 3 验收 |
| Gate 4 | `NOT_STARTED` | 依赖 Gate 3 |
| 推送/发布 | `NOT_EXECUTED` | 未 push、未创建 release、未上传商店 |
| 生产凭证 | 未读取、未使用 | 未签生产包，未执行不可逆外部动作 |
| 候选改动规模 | 406 files, +29,441/-2,167 | `90ef8b...abe90fa`，排除 `vendor/` |
| 快照时间 | `2026-09-05T07:24:49.7041521+08:00` | Asia/Hong_Kong |

### 1.3 候选与当前 HEAD 的区别

`abe90fa1d6` 是实际接受最终候选验证的代码提交。`b93dbde5d5` 固化候选证据，`ebe66e76e6` 记录用户跳过 Swift 验证的处置；两者都不改变候选运行输入。后续 Agent 不得把 evidence-only HEAD 误称为重新跑过完整候选验证的新代码 SHA。

-----

## 2. 状态与证据等级

### 2.1 状态

| 状态 | 含义 | 能否满足 Gate |
|---|---|---|
| `PASS` | 对应验收条件已在允许的证据等级下通过 | 可以 |
| `PARTIAL` | 只完成部分验收，或不同平台证据不对称 | 不可以 |
| `FAIL` | 已执行且不满足验收 | 不可以 |
| `NOT_EXECUTED` | 没有执行，不能推导通过或失败 | 不可以 |
| `SKIPPED_BY_USER` | 用户决定不继续执行；它是处置字段，不是执行结果 | 不可以，除非另有正式 Gate 豁免 |
| `HOST_ENVIRONMENT` | 失败或未执行由当前宿主能力限制导致 | 不可以自动转为 `PASS` |
| `MANUAL_EXTERNAL_REQUIRED` | 需要生产账号、身份、签名或外部审批 | 只允许在规定的生产动作上保留 |
| `DEFER` | 明确排除于当前版本，需重新立项 | 不计当前 Gate 欠账 |

### 2.2 证据等级

| 等级 | 含义 |
|---|---|
| E0 | 只有文档说明 |
| E1 | 类型、接口或 skeleton 存在 |
| E2 | 实现已经过源码检查 |
| E3 | 测试、构建或 generator 实际通过 |
| E4 | 运行时、跨语言或端到端路径实际通过 |

Gate 1 的 Remote correctness、recovery 和 multi-device approval 要求 E4。源码、测试定义、fake server 或 workflow 文件存在都不能替代 E4。

-----

## 3. 总体完成情况

| Gate | 状态 | 完成内容 | 主要剩余项 |
|---|---|---|---|
| Gate 1 — P0 correctness | `PARTIAL` | 8/13 任务 PASS；Host↔Kotlin、授权、隐私、多设备、恢复、构建均有证据 | Swift 3 项已跳过；Android App 未装配；远端 CI 未运行；5 个环境失败 |
| Gate 2 — P1 release foundation | `NOT_STARTED` | 现有官方构建、CI 和版本字段可作为输入 | 统一版本、channel、RC pipeline、供应链、四平台 release artifact、支持/迁移/回滚 |
| Gate 3 — P2 Beta readiness | `NOT_STARTED` | 旧代码中已有部分 QR、Lite、Handoff、Windows/移动 UI 基线 | 必须重新按 Gate 3 验收，不得沿用旧报告的“完成”字样 |
| Gate 4 — GA handoff | `NOT_STARTED` | 无 | GA dry-run、生产签名交接、商店包、rollout、incident、最终 handoff |
| P3/Future | `DEFER` | 现有 reference 实现保留 | First-party Relay、APNs/FCM、PTY、复杂 RBAC、Handoff L2 等不得顺手扩展 |

Gate 1 的代码侧 P0 修复已经形成可继续交付的地基，但“整个目标完成”仍不成立。更准确的表述是：Remote Host↔Kotlin 主路径达到 E4；Apple 源码达到 E2；产品发布、Beta 和 GA 工程尚未开始。

-----

## 4. Gate 1 完成明细

### 4.1 任务矩阵

| 任务 | 状态 | 当前证据 | 结论 |
|---|---|---|---|
| G1-RC | `PASS` | [`implementation-baseline.json`](gate-1/implementation-baseline.json) | 基线、分叉、worktree 与候选策略已记录；用户 dirty 文件未被修改 |
| G1-COMP | `PASS` | [`G1-COMP.json`](gate-1/G1-COMP.json) | shipped base YAML 可解析；Gateway setup 14 个失败清零；真实 Host slice 启动 |
| G1-DOC | `PASS` | [`G1-DOC.json`](gate-1/G1-DOC.json) | 仓库内容 drift 已清除；`test:docs` 15/15；完整文档聚合仅剩宿主 symlink 限制 |
| G1-CONTRACT | `PASS` | [`G1-CONTRACT.json`](gate-1/G1-CONTRACT.json) | unary、stream、Remote Event、void/error、sequence/cursor、版本和 capability 由一个 source graph 所有 |
| G1-GEN | `PASS` | [`G1-GEN.json`](gate-1/G1-GEN.json) | manifest、JSON Schema、Swift、Kotlin、fixtures、domain/Lite conformance 可重复生成且无 drift |
| G1-APPLE | `PARTIAL / E2` | [`G1-APPLE.json`](gate-1/G1-APPLE.json) | fresh-pair、authoritative `clientId`、void/result、reconnect 源码已修；Swift 未编译和运行 |
| G1-ANDROID | `PARTIAL / E4` | [`G1-ANDROID.json`](gate-1/G1-ANDROID.json) | Kotlin core 125/125；真实 Host 13/13；wrong pin 在请求字节发出前被拒绝；App 未装配 |
| G1-AUTH | `PASS` | [`G1-AUTH.json`](gate-1/G1-AUTH.json) | Session、Workspace、Interaction、Resource、Path 最小 scope 与撤销/角色/审批开关均已验证 |
| G1-PRIV | `PASS / E4` | [`G1-PRIV.json`](gate-1/G1-PRIV.json) | 遥测默认关闭/白名单导出；匿名 identity、Artifact 路径和 native 证据均做隐私收口 |
| G1-E2E | `PARTIAL / E4` | [`G1-E2E.json`](gate-1/G1-E2E.json) | TypeScript reference 与 Kotlin 完成同一 13 步真实 Host corpus；Swift 未执行 |
| G1-MULTI | `PASS / E4` | [`G1-MULTI.json`](gate-1/G1-MULTI.json) | 3 轮共 9 项通过；两个 Controller 获胜顺序、迟到结果、Observer 拒绝均确定性验证 |
| G1-REC | `PARTIAL / E4` | [`G1-REC.json`](gate-1/G1-REC.json) | Kotlin 断流后 Host 离线推进 11 个 sequence，重复重连投影一致；Swift 未执行 |
| G1-CI | `PARTIAL` | [`G1-CI.json`](gate-1/G1-CI.json) | 候选 focused evidence 完整；aggregate 55 PASS/5 HOST_ENVIRONMENT；远端候选 CI 未执行 |

### 4.2 已完成的核心修复

#### Shipped composition 与 Host 启动

`packages/bundle/base/cordis.patch.yml` 的无效 YAML 已修复，Connection 对 WebServer 的可选注入关系已收口。修复前 Gateway stream 为 8 pass/14 fail，修复后为 22/22；Connection package regression 为 116/116；shipped Link slice 可以实际启动 Host 并完成配对、Session 列表、Remote event 和审批开关路径。

#### Canonical Link Contract 与生成链

Contract source graph 统一拥有 authenticated unary `{payload:{args}}`、NDJSON stream、`ready.clientId`、emit/waterfall/cancel/result/outcome、void success、structured error、Session sequence/snapshot cursor、`linkProtocolVersion`、`contractVersion`、`sessionFormatVersion`、`hostVersion` 和 capabilities。生成链产生 manifest、JSON Schema、Swift、Kotlin 和共享 fixtures；二次生成无 tracked drift。

#### Android Remote correctness 与安全

Kotlin core 28 个 suite 共 125 个测试全部通过。真实 Host↔Kotlin corpus 的 pair、connect、describe、list、open、history、follow、prompt、stream、approval、cancel、reconnect、revoke 共 13 步全部通过。TLS fixture 验证 right pin 成功、wrong pin 在任何应用请求字节发送前失败；fresh-pair ownership、carrier refusal code、取消、重连和资源释放均有测试。

#### 资源级授权

Device Trust 独立持久化 Session/Workspace grant，并在 pairing transaction 中原子写入。Remote 请求在进入现有业务 owner 前检查设备身份、角色、Session、Workspace、Interaction、Resource 和 Path；集合和事件输出也会按授权过滤。Observer mutation、越权资源、stale generation、重复 interaction、审批关闭和设备撤销都走拒绝路径。

#### 遥测与 Artifact 隐私

Session telemetry 未显式配置 `FULL` 或 `FEEDBACK_ONLY` 时不创建 OpenTelemetry transport。出站事件只允许 event type、sequence、time、安全整数 turn/step 和固定 severity，不导出 prompt、source、system context、工具名/参数/结果、feedback 正文、error detail、credential 或 workspace path。Session id 使用私有根种子派生 pseudonym；ArtifactId 在模型输入、wire、durable invariant 与 filesystem provider 入口统一解析。

#### 多控制器审批

真实 TLS Link carrier 下，Controller A 与 Controller B 的两个获胜顺序都经过受控 barrier。第一份有效答案完成交互，已进入处理的 loser 获得幂等 void success 与一次 cancel，新的迟到答案被拒绝；Observer 不接收可回答交互；每轮 Session 只追加一组匹配的 approval asked/decided 记录。

#### Kotlin 恢复

Host 在第一个 assistant chunk 后中断两条 active stream，Session 在客户端离线期间继续。恢复 snapshot 从 sequence 82 前进到 cursor 93，包含 11 个离线 sequence，`hasMore=false`；第二次重连仍为 cursor 93，并与第一次恢复后的投影结构相等。

### 4.3 候选验证数字

| 验证面 | 当前候选结果 |
|---|---:|
| Contract/conformance | 113/113 |
| Authorization/TLS/Remote regression | 181/181 |
| Telemetry privacy | 99/99 |
| Telemetry Loader | 3/3 |
| SDK server | 32/32 |
| Android pure-JVM core | 125/125 |
| Host↔Kotlin acceptance | 13/13 |
| Multi-device deterministic repeats | 9/9 |
| Official client artifacts | 220 |
| Built Web | 8/8 |
| Documentation quick gates | 15/15 |
| Full `check:ci` | 55 PASS / 5 FAIL，5 项均分类为宿主环境 |

-----

## 5. 尚未完成与已跳过项目

### 5.1 用户已要求跳过的 Swift 项

以下 3 项在两份总证据中记录 `status=NOT_EXECUTED`、`userDisposition=SKIPPED_BY_USER`，处置时间为 `2026-09-05T02:10:56.6188413+08:00`：

1. `swift test`。
2. Real Host-to-Swift acceptance。
3. Swift disconnect and authoritative recovery。

这些项目不再由后续 Agent 自动重试。若用户希望严格关闭 Gate 1，必须在 Swift-capable macOS runner 上重新打开这些项目并取得 E3/E4；若用户希望永久豁免，必须单独授权修改 Gate 1 Exit Criteria，并保留 waiver 记录。无论哪条路径，都不得把跳过标为通过。

### 5.2 仍可执行但尚未完成的 Gate 1 项

| 项目 | 状态 | 原因 | 闭合条件 |
|---|---|---|---|
| Android App `:app:assembleDebug` | `NOT_EXECUTED` | 当前宿主无 Android SDK 和 `local.properties` | 在具备 SDK 的环境完成装配并记录 artifact/manifest |
| Remote candidate CI | `NOT_EXECUTED` | 候选分支未发布到 origin；未获 push 授权 | 经用户授权 push 后，在候选 SHA 上运行远端 mandatory workflow |
| `test:coverage` | `FAIL / HOST_ENVIRONMENT` | 37 个 Windows symlink `EPERM`，2 个 Codex temp `EBUSY` | 在支持 symlink 且无外部目录锁的 runner 复跑 |
| `test:coverage-exempt-heavy` | `FAIL / HOST_ENVIRONMENT` | 嵌套 worktree 到共享 pnpm store 的 Typert snapshot 路径深度不同 | 在标准 checkout/CI runner 复跑，不修改产品语义掩盖路径差异 |
| `test:snapshot` | `FAIL / HOST_ENVIRONMENT` | macOS/Linux-owned fixtures 在 Windows 出现 shell/path/browser 差异 | 在 fixture 所属平台运行 |
| Documentation site checks | `FAIL / HOST_ENVIRONMENT` | 临时 symlink fixture 创建时 `EPERM` | 在有 symlink 权限的 runner 运行 |
| NodeNext consumer | `FAIL / HOST_ENVIRONMENT` | verifier 创建 workspace directory symlink 时 `EPERM` | 在有 symlink 权限的 runner 运行 |

### 5.3 当前 Gate 决策

当前必须保留：

```json
{
  "status": "PARTIAL",
  "closure": "OPEN",
  "canEnterGate2": false
}
```

-----

## 6. 原需求完成状态更新

### 6.1 旧报告“尚未完成”15 项的当前映射

| # | 原需求欠账 | 2026-09-05 状态 | 当前结论/后续归属 |
|---:|---|---|---|
| 1 | macOS Direct Full Host | `NOT_STARTED` | DirectHostMac 仍是 shell；进入 G2-MAC、G2-MACSIGN、G3-MACHOST |
| 2 | iPhone/Android 真机端到端 | `NOT_EXECUTED` | Kotlin pure-JVM/Host E4 不等于真机；归 G3-LIFE 与 Beta rehearsal |
| 3 | Lite 内置工具真实执行体 | `PARTIAL_BASELINE` | 静态目录与分发入口存在；web_search/url_fetch/image_inspect/attachment_read/calculator 仍需实现与验收 |
| 4 | Lite System Prompt/Persona | `NOT_STARTED` | 未由 Gate 1 覆盖；归 G3-LITE-A/G3-LITE-D |
| 5 | LAN mDNS/Bonjour discovery | `NOT_STARTED` | QR endpoint 直连存在；Discovery 不等于 Trust；归 G3-DISC |
| 6 | 完整 capability/version 协商 | `PARTIAL / CODE_COMPLETE` | `contractVersion`、`hostVersion`、`sessionFormatVersion`、capabilities 与 unknown-field 语义已进入 Contract；Kotlin E4，Swift runtime 未验证 |
| 7 | Windows Role 编辑与 Diagnostics | `PARTIAL_BASELINE` | Pairing、device list/revoke、approval/LAN 设置存在；Role edit 与 Diagnostics 归 G3-WINUX/G2-SUPPORT |
| 8 | iPad/Android adaptive layout | `NOT_STARTED` | iPad target 与 Compose 基线存在；专属布局、Window Size Class 和输入形态未验收 |
| 9 | Diff 行号与语法高亮 | `NOT_STARTED` | 只读文件/hunk 基线存在；产品化归 G3-MOBILEUX |
| 10 | 统一 `HarnessRuntime` 门面 | `NOT_STARTED` | RemoteHostRuntime 与 LocalLiteRuntime 仍为并列入口；归 G3-LITE-A/G3-LITE-D |
| 11 | Session 运行位置与多 Host 列表 | `NOT_STARTED` | 当前仍以单 Host 为主；多 Authority 禁止不变 |
| 12 | Follow UX/Private-network UX 深化 | `UNSPECIFIED / NOT_STARTED` | 先补可验收的 UX 需求，再进入 G3；不得以模糊条目驱动重构 |
| 13 | 网络与兼容矩阵 | `PARTIAL` | Kotlin 离线恢复达到 E4；Wi-Fi↔蜂窝/VPN/丢包真机和 N/N-1 仍归 G3-LIFE/G2-COMPAT |
| 14 | Steer 与 Model read/select | `NOT_STARTED` | 不在 Gate 1 allowlist 扩展范围；需先定义最小权限与 capability，再单独实施 |
| 15 | `/readyz`、`/healthz`、契约稳定度、命令风险分级 | `PARTIAL` | version/capability Contract 已补；健康探针、stable/experimental/internal 与命令风险分级仍待立项 |

### 6.2 原 0–85 章状态索引

以下索引用于把旧报告章节快速映射到现状；章节正文仍是需求背景，不是当前行为证据。

| 状态 | 原章节 | 当前解释 |
|---|---|---|
| 当前候选已证明或约束已满足 | 0、4–17、19、22–24、26–29、31、35、37–40、54、56、61、64、80、85 | 对应 composition、单一 owner、授权、恢复语义、Handoff L1 边界、Artifact/File 与禁止项有当前源码/测试支持 |
| 部分完成或存在证据不对称 | 1–3、18、20–21、25、30、32–34、36、42–44、49–53、55、58–70、71–74、76–77、79、81–84 | 代码基线可能存在，但缺完整产品 composition、目标平台运行、真机、发布或 GA 证据 |
| 未启动 | 45–48、75，以及 PoC-5/PoC-6 的真实执行部分 | macOS Full Host、签名/公证和真机路径没有当前验收 |
| 明确延后 | 41、57、78 | Handoff L2、Terminal、First-party Relay、APNs/FCM、PTY、Lite Subagent、替代 transport、公网续连等需重新立项 |

### 6.3 对旧“完成”声明的校正

- 旧报告中的“Apple CI 构建绿”“Swift 八项全落”不是当前候选的 Swift runtime 证据。当前候选只能确认 Apple 源码和测试定义存在，证据等级为 E2。
- 旧报告中的 Android APK 产出不属于本轮候选证据。当前候选只确认 pure-JVM core 与 Host↔Kotlin E4，`:app:assembleDebug` 明确为 `NOT_EXECUTED`。
- 旧报告中的“PoC-2/PoC-4 完成”在当前更严格的双语言 Exit Criteria 下只能是 `PARTIAL`，因为 Swift E4 缺失并被用户跳过。
- 旧报告中的“Contract capability 不完整”已有实质进展；当前 source graph 已包含版本和 capability 字段，但 Apple runtime 仍未验证。
- 旧报告中的“所有 TS/Apple/Android 车道全绿”不得作为当前 RC SHA 的远端 CI 结论；当前分支未发布，Remote candidate CI 没有运行。

-----

## 7. 需求优化结果

### 7.1 删除与当前仓库冲突的泛化架构

外部报告开头提出集中账号服务、微服务拆分、Kafka/RabbitMQ、Redis、PostgreSQL 集群、Kubernetes、通用 REST API、Flutter/React Native 等选型。这些内容没有当前仓库证据，并与“一个 Harness Business Runtime、一个 Gateway、一个 Session Authority、原生 Swift/Kotlin 客户端”的已锁定方向冲突。本交接基线不把这些选型列为后续任务；任何一项都必须由新的产品需求和架构决策单独立项。

### 7.2 用平台角色替代“全端功能一致”

Windows/macOS Full Host、Apple/Android Remote Companion 与 Native Lite 的职责不同。验收要求语义和 Contract 一致，不要求每个平台运行同一 Runtime 或拥有完全相同的能力。Mobile 继续禁止嵌入完整 Node/Cordis Runtime；Windows 继续禁止 WinUI/WPF 重写；macOS Harness Core 继续禁止重写为 Swift。

### 7.3 用证据终态替代完成百分比

后续任务只能使用 `PASS / FAIL / PARTIAL / NOT_EXECUTED / DEFER`，并绑定 commit、command、runner、artifact 和 evidence level。不得根据文件存在、测试定义、旧里程碑、代码行数或主观百分比推导完成。

### 7.4 用 Gate 依赖替代工期估算

旧报告的 1–3 个月、13 周和 130 人日没有当前仓库测量依据，已从执行基线移除。后续排序只依赖 Gate、风险、证据和外部条件；时间箱只限制故障收敛循环，不代表工期承诺。

### 7.5 拆分工程可完成项与生产外部动作

签名 workflow、metadata、SBOM、provenance、dry-run 和 Runbook 属于可自动完成项。生产证书注入、notarization submission、TestFlight/Play/Store 上传、审核、发布、证书旋转与 staged rollout activation 属于 `MANUAL_EXTERNAL_REQUIRED`，必须保留 `NOT_EXECUTED`，不得用缺少凭证阻止其余工程准备。

### 7.6 收紧下一阶段入口

Gate 1 未闭合时不开始 Gate 2 的产品实现。允许提前做的只有不改变产品的环境准备、runner 能力确认和 Gate waiver 决策材料。若用户选择豁免 Swift，证据必须记录被豁免的 Exit Criteria、原因、风险、批准者角色和日期；Gate 1 不能伪造为全平台 E4。

-----

## 8. 优化后的后续任务基线

### 8.1 Gate 1 收尾

| 任务 | 当前状态 | 下一动作 | 关闭证据 |
|---|---|---|---|
| G1-APPLE-RUN | `SKIPPED_BY_USER` | 默认不重试；严格关闭时在 macOS 重新打开 | `swift test` E3 + Host↔Swift 13/13 E4 |
| G1-REC-SWIFT | `SKIPPED_BY_USER` | 默认不重试；严格关闭时与 Apple lane 同次执行 | 断流、离线推进、重连、重复重连投影相等 E4 |
| G1-ANDROID-APP | `NOT_EXECUTED` | 在 Android SDK 环境运行装配 | `:app:assembleDebug`、artifact checksum、manifest 与 SHA |
| G1-REMOTE-CI | `NOT_EXECUTED` | 仅在用户授权 push 后发布候选 | 远端 workflow 对唯一候选 SHA 给出统一 verdict |
| G1-PORTABLE-RUNNERS | `PARTIAL` | 在标准 Linux/macOS/Windows runner 复跑 5 个环境失败 | 不再出现 symlink/path/fixture 宿主误差；产品失败单独修复 |
| G1-WAIVER | `NOT_AUTHORIZED` | 只有用户明确放宽 Gate 1 才创建 | machine-readable waiver；保留 Swift `NOT_EXECUTED`，不得标 PASS |

### 8.2 Gate 2 — Release Engineering Foundation

| 任务 | 状态 | 优化后的目标与验收 |
|---|---|---|
| G2-VERSION | `NOT_STARTED` | 统一 app SemVer/build number owner，并与 protocol/contract/session version 解耦；当前 root/desktop `0.1.2-alpha.1`、Android `0.1.0` 的漂移必须由测试拒绝 |
| G2-CHANNEL | `NOT_STARTED` | 定义 dev/canary/beta/stable distribution policy；不得 fork 业务代码或把 channel 当 protocol major |
| G2-CI | `NOT_STARTED` | 固化 PR aggregate、RC workflow、platform matrix、artifact/evidence summary；无法读取 branch protection 时输出准确 required-check 清单 |
| G2-SUPPLY | `NOT_STARTED` | Actions full-SHA pin、最小 permissions、dependency review、CodeQL/SAST、secret scan、SBOM、checksum、portable provenance/attestation hook |
| G2-WIN | `NOT_STARTED` | 保留 Electron + NSIS/portable；完成 unsigned RC、installer smoke、update feed、checksum mismatch 与 failed-update recovery |
| G2-MAC | `NOT_STARTED` | 实现 DirectHostMac 的 Sidecar Supervisor、单一 local carrier、health、timeout、shutdown、restart、log 与 no-orphan |
| G2-MACSIGN | `NOT_STARTED` | 建 nested executable inventory、最小 entitlement、Hardened Runtime、Developer ID/notary/staple 验证 dry-run；生产提交保持 `NOT_EXECUTED` |
| G2-IOS | `NOT_STARTED` | 建 Bundle ID/scheme/version/signing abstraction、privacy manifest/SDK inventory、archive/export workflow；上传 job 默认禁用 |
| G2-AND | `NOT_STARTED` | 提交可重复 toolchain，补 release build/AAB/R8/mapping/signing abstraction/bundle validation；当前 `compileSdk`/`targetSdk` 35 需升级到需求规定的 36 |
| G2-CRASH | `NOT_STARTED` | 建 privacy-safe crash/ANR/diagnostics schema，关联 version/build/SHA/platform/runtimeClass/errorClass，不包含业务 payload |
| G2-SUPPORT | `NOT_STARTED` | 生成 allowlist-based Support Bundle，包含版本、健康、连接、脱敏日志、协议、角色、capability 与更新状态；secret scan 必须为 0 |
| G2-MIG | `NOT_STARTED` | 为 Session/settings/device trust/native storage 建 version、backup-first forward migration、corruption recovery；不承诺 arbitrary downgrade |
| G2-COMPAT | `NOT_STARTED` | 只维护 N/N-1 corpus：old/new Host/client、additive field、unknown capability/event、major/session mismatch |
| G2-ROLL | `NOT_STARTED` | 按平台区分 updater rollback、forward fix、feature kill 与 migration recovery；不得把商店重新发版写成本地 binary rollback |
| G2-GOV | `NOT_STARTED` | 机器可读 Release Checklist/DoD/Go-No-Go/owner role/manual boundary；不写具体人员 |
| G2-RC | `NOT_STARTED` | 同一 SHA 生成 Windows、macOS、Apple mobile、Android candidate，并用 manifest/checksum/SBOM/provenance 绑定；缺 runner 只能标 blocker |

### 8.3 Gate 3 — Productization and Beta Readiness

| 任务 | 状态 | 优化后的目标与验收 |
|---|---|---|
| G3-QR | `PARTIAL_BASELINE` | 完成 Apple/Android camera QR pairing、permission denial 与 manual fallback；expired/replay/wrong fingerprint 必须失败 |
| G3-DISC | `NOT_STARTED` | mDNS/Bonjour 只做发现；必须继续独立验证 pairing fingerprint；多个 Host 显示确定性 |
| G3-LIFE | `PARTIAL_BASELINE` | 执行 background/foreground/process kill/cold-start 与真机网络矩阵；移动端死亡不得影响 Host authority |
| G3-LITE-A | `PARTIAL_BASELINE` | 将 Apple Lite 接入统一 HarnessRuntime 产品 composition；实现严格 Lite P0 与 `requiresFullRuntime` |
| G3-LITE-D | `PARTIAL_BASELINE` | Android 使用同一 behavior corpus；不得引入第二 Session domain 或完整 Node Runtime |
| G3-HAND | `PARTIAL_BASELINE` | 验证 sender 真实调用、失败不显示成功、provenance、幂等和新 Full Session 创建；禁止 Handoff L2 |
| G3-MACHOST | `NOT_STARTED` | 完成 macOS Host Controller、sidecar health UI、pairing/admin、Remote enable/disable、diagnostics、restart recovery |
| G3-OBS | `FOUNDATION_PRESENT` | 复用 G1-PRIV 的安全投影，增加 release health 指标、synthetic alert 和 SHA/version correlation |
| G3-FLAG | `PARTIAL_BASELINE` | Remote Access/Approval 已有开关；补 File/Artifact/experimental capability 独立 kill，并与 capability negotiation 分离 |
| G3-WINUX | `PARTIAL_BASELINE` | 完成 role edit、Diagnostics、update UI；每个设置必须驱动真实 owner |
| G3-MOBILEUX | `PARTIAL_BASELINE` | 完成 Hosts/Sessions/Conversation/Plan/Todo/Goal/Tools/Artifacts/Approvals 导航、iPad 三栏与 Android Window Size Class |
| G3-STORE | `NOT_STARTED` | 建 machine-readable store metadata 与 privacy/data-safety inventory；缺人工值标 `MANUAL_INPUT_REQUIRED`，不提交 |
| G3-APPLEBETA | `NOT_STARTED` | TestFlight group/review/info/API dry-run；任何 mutation 需要 protected environment 和人工批准 |
| G3-PLAYBETA | `NOT_STARTED` | AAB internal/closed track payload dry-run、release notes、Data Safety 与 signing placeholder；不上传 |
| G3-ANDROIDVERIFY | `NOT_STARTED` | 输出 package id、签名证书公开 fingerprint 与账号前置清单；身份提交保持人工 |
| G3-BETA | `NOT_STARTED` | 从 clean RC SHA 完成 gates→artifacts→SBOM→install→diagnostics→rollback→store payload dry-run，并生成 Beta readiness report |

### 8.4 Gate 4 — GA Engineering Readiness

| 任务 | 状态 | 优化后的目标与验收 |
|---|---|---|
| G4-GA | `NOT_STARTED` | 锁定 SHA/version/channel，只 promote 已验证 CI artifact；禁止本机重建替代物 |
| G4-SIGN | `NOT_STARTED` | 生成四平台 Production Signing Handoff；只记录 secret identifier/scope/rotation role，不记录 secret value |
| G4-NOTARY | `NOT_STARTED` | 生成 macOS sign→notary→staple→Gatekeeper 单步执行包；真实 submission 为 `NOT_EXECUTED` |
| G4-STORES | `NOT_STARTED` | 生成 TestFlight/Play/Microsoft Store/App Store submission bundle；所有 mutation 禁用 |
| G4-ROLLOUT | `NOT_STARTED` | 定义 staged rollout、pause、kill、forward-fix 与健康阈值；不触发真实 rollout |
| G4-INC | `NOT_STARTED` | 定义 severity、Incident Commander/Runtime/Release/Security 角色并执行 synthetic tabletop |
| G4-GOV | `NOT_STARTED` | 生成 `GA_READINESS.json/.md`；任何工程 `FAIL` 都阻断，只有生产外部项可保留 `NOT_EXECUTED` |
| G4-P3 | `NOT_STARTED` | 固化 P3 defer 清单，确认 reference Relay/Noise 未接生产路径，不删除既有 reference 实现 |
| G4-HANDOFF | `NOT_STARTED` | 生成最终 Release Candidate Handoff，绑定 SHA、版本、artifact、checksum、tests、SBOM、provenance、manual steps 与 blocker |

-----

## 9. 后续 Agent 执行顺序

```text
确认当前 HEAD / dirty state / 用户授权
                    │
                    ├── 严格 Gate 1 路径
                    │     ├── macOS Swift test + Host↔Swift + recovery
                    │     ├── Android SDK App assembly
                    │     ├── 标准 runner 复跑环境失败
                    │     └── 经授权发布候选并运行 Remote CI
                    │
                    └── Gate waiver 路径
                          └── 仅在用户明确批准后记录 waiver；不得标 Swift PASS
                                      │
                                      ▼
                              Gate 1 closure decision
                                      │
                                      ▼
                         G2-VERSION + G2-CI + G2-SUPPLY
                                      │
                        ┌─────────────┼─────────────┐
                        ▼             ▼             ▼
                     Windows        Apple         Android
                        └─────────────┼─────────────┘
                                      ▼
                         Support/Migration/Compat/Rollback
                                      ▼
                                  G2-RC
                                      ▼
                              Gate 3 productization
                                      ▼
                               Beta rehearsal
                                      ▼
                              Gate 4 GA handoff
```

在当前授权下，后续 Agent 的第一项工作不是直接实施 Gate 2，而是读取最新 `gate1-evidence.json`，确认用户选择严格闭合还是正式 waiver。若没有新授权，保持 `canEnterGate2=false`。

-----

## 10. 交接操作规范

### 10.1 工作区保护

1. 使用 `E:\Mix\project\deepseek-harness\.worktrees\goal-mode-full-implementation` 和分支 `codex/goal-mode-full-implementation`。
2. 不切换、清理、stash、reset 或覆盖用户的 `dev` 工作区；基线证据记录该工作区存在用户拥有的未跟踪核验文档。
3. 每轮先运行 `git status --short --branch`、`git rev-parse HEAD`，再检查 candidate/evidence SHA 的关系。
4. 不修改 `vendor/`，不编辑 `.agents/notes/archived/`。

### 10.2 开始修改前

1. 读取根 [`AGENTS.md`](../../AGENTS.md) 与更具体的规则。
2. 修改 `packages/` 前读取 [`docs/architecture.md`](../../docs/architecture.md)。
3. 生命周期、并发、subprocess、teardown 工作先读取 [`docs/defensive-patterns.md`](../../docs/defensive-patterns.md)。
4. 只执行当前任务需要的检查；不要为了交接重复完整候选套件。

### 10.3 证据与提交

1. 每项任务记录 source SHA、准确命令、runner/OS、结果、artifact、限制和下一依赖。
2. 先更新事实 owner，再更新生成物和汇总证据；不得手工修改生成式 Contract artifact。
3. `NOT_EXECUTED` 必须写明原因；`SKIPPED_BY_USER` 作为独立处置字段保留。
4. 产品代码提交与 evidence-only 提交分开；提交前运行目标检查和 `git diff --check`。
5. 未获用户明确授权时不 push、不创建 PR、不发布、不使用生产凭证。

### 10.4 Gate 1 可移植复跑入口

```powershell
pnpm run verify-link-contracts
pnpm run test:docs
pnpm run build:official
gradle --no-daemon -p apps/android :core:test --rerun-tasks
gradle --no-daemon -p apps/android :app:assembleDebug
```

Apple 的 SwiftPM 与 Host↔Swift 命令由 [`.github/workflows/apple-swift.yml`](../../.github/workflows/apple-swift.yml) 和 [`apps/cli/tests/link-native-acceptance.e2e.ts`](../../apps/cli/tests/link-native-acceptance.e2e.ts) 共同拥有。后续 Agent 应执行 owner workflow，不从本快照复制可能漂移的完整命令行。

-----

## 11. 证据索引

| 证据 | 用途 |
|---|---|
| [`gate-1/implementation-baseline.json`](gate-1/implementation-baseline.json) | 分支、worktree、dev/master 分叉与 dirty preservation |
| [`gate-1/gate1-evidence.json`](gate-1/gate1-evidence.json) | Gate 1 总状态、Exit Criteria、blocking items 与用户跳过处置 |
| [`gate-1/G1-CI.json`](gate-1/G1-CI.json) | 候选命令、focused 结果、aggregate 55/5、toolchain 与 restoration |
| [`gate-1/G1-COMP.json`](gate-1/G1-COMP.json) | composition 修复前后 |
| [`gate-1/G1-DOC.json`](gate-1/G1-DOC.json) | 文档 drift 与 symlink 环境分类 |
| [`gate-1/G1-CONTRACT.json`](gate-1/G1-CONTRACT.json) | Contract ownership 与协议语义 |
| [`gate-1/G1-GEN.json`](gate-1/G1-GEN.json) | generator 输出与 freshness |
| [`gate-1/G1-APPLE.json`](gate-1/G1-APPLE.json) | Apple E2 与未执行 Swift 项 |
| [`gate-1/G1-ANDROID.json`](gate-1/G1-ANDROID.json) | Android E4 core、pinning 与 App assembly 缺口 |
| [`gate-1/G1-AUTH.json`](gate-1/G1-AUTH.json) | 最小授权 scope |
| [`gate-1/G1-PRIV.json`](gate-1/G1-PRIV.json) | telemetry、identity、Artifact 与 native evidence 隐私 |
| [`gate-1/G1-E2E.json`](gate-1/G1-E2E.json) | TypeScript/Kotlin/Swift 跨语言矩阵 |
| [`gate-1/G1-MULTI.json`](gate-1/G1-MULTI.json) | 多控制器审批 E4 |
| [`gate-1/G1-REC.json`](gate-1/G1-REC.json) | 断连恢复 E4 与 Swift 缺口 |
| [`gate-1/acceptance/kotlin-abe90fa1d6521b595f017ca1cf8c5cb03b3bb9b4.json`](gate-1/acceptance/kotlin-abe90fa1d6521b595f017ca1cf8c5cb03b3bb9b4.json) | 最终候选 Host↔Kotlin privacy-safe acceptance |

### 11.1 本交接文档验证

| 检查 | 结果 |
|---|---|
| 相对文件链接检查 | `PASS`，49 个链接目标存在 |
| `pnpm --config.verify-deps-before-run=false run test:docs` | `PASS`，15/15 |
| `pnpm --config.verify-deps-before-run=false run doc-sync` | `PARTIAL`，31/32；唯一失败是 Windows 创建测试 symlink 时 `EPERM`，站点测试 68/69 |
| `pnpm --config.verify-deps-before-run=false run lint` | `PASS`；首次沙箱构建写入本地产物被拒绝，宿主环境原命令通过 |
| `git diff --check` | `PASS` |

-----

## 12. 当前结论

当前成果足以交给后续 Agent 继续，但不足以声明完整目标、Gate 1 或 Beta readiness 已完成。可确认的最高层结论是：Gate 1 的 Host/Contract/Android/authorization/privacy/multi-device 主体已经收敛，Kotlin Remote correctness 与 recovery 达到 E4；Swift 当前只有 E2 且已由用户标记跳过；Gate 2–4 尚未开始。

后续 Agent 必须从 Gate 1 closure decision 开始，不能把旧报告中的绿色里程碑、当前文件存在或用户跳过动作提升为未实际执行的平台证据。
