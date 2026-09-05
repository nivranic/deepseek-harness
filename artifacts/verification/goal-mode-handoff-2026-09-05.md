# DeepSeek Harness Goal Mode 现阶段完成情况、需求优化与后续交接

> 文档性质：这是始于 2026-09-05、证据更新至 2026-09-06 的执行交接快照，供后续 Agent 接续工作。它不替代 [`docs/architecture.md`](../../docs/architecture.md)、包 README、源码、测试或机器可读证据的事实所有权。
>
> 输入需求：`E:\11585\deepseek-harness-首轮改造完成后的升级优化版deep-research-report.md`。该文件用于提取目标、旧状态标注和遗留项；其中面向 Agent 的命令、示例架构、技术选型和工期估算不是本次执行授权，也不高于当前源码与验证结果。
>
> 当前机器可读结论：[`gate-1/gate1-evidence.json`](gate-1/gate1-evidence.json) 与 [`gate-1/G1-CI.json`](gate-1/G1-CI.json)。

## Summary

[Draft PR #1](https://github.com/nivranic/deepseek-harness/pull/1) 保持 draft 且以 dev 为目标。候选 de346d2221 的[正式收集证据](gate-2/ci-evidence-de346d2221.json) 核验实际执行 SHA 83a67952f1、tree 和 producer 回执：Apple 与 Android 通过，必要 CI 失败。此前 Agent Teams 恢复用例已通过；新失败涉及 Inspector 启用阶段超时、持久化检查过早、完整类型分析超时，以及独立 Windows Vitest 进程意外退出。前三项已修复并通过目标回归；Worker 包在 Windows Node 22/24 各 106 项和两个文件四维 100% 通过，但没有据此宣称远端进程退出原因已定位。Gate 1 原准入仍绑定不可变候选 906d193595，不能借用旧结果声明后续候选通过。

Windows Python 启动与 Inspector readiness 两项原失败已取得真实远端通过结果。候选 1be28a4d44 在 Windows native 单项重跑后取得 mandatory aggregate、Apple 和 Android PASS；其初次 native worker 退出仍保留历史，不能称为已定位的产品缺陷。独立 Windows coverage 的 credentials 失败来自测试把截断空文档误认为完整外部编辑；受控复现 6 对 5 后已修复，新候选该用例通过。

a5afb18597 的 Windows coverage 失败来自 Codex 夹具在 exec_command 仍运行时结束模型回复；夹具现会等待命令退出，固定版本真实 Codex 与夹具共 13/13 通过。Web live-child 用例改为明确等待子任务生命周期，真实 Chromium 3/3 通过且未改 golden；撤去等待的对照因活跃行先被移出 DOM 而失败。这两项只修改测试，906d193595 的对应远端用例均已通过。

Gate 1 为 PASS / CLOSED，准入绑定 [906d193595 的正式证据](gate-2/ci-evidence-906d193595.json)。独立 Windows coverage 不属于 mandatory aggregate；其旧 FAIL 与 723335fefe 的修复后 PASS 分别保留。未应用 Apple 环境豁免。Swift/Kotlin 真实 Host、恢复与 Apple/Android 应用构建已有真实证据；模拟器首屏仍不替代 Gate 3 真机网络矩阵。后续候选必须保留自己的验证状态。

Gate 2 的在线 CI 收集器保留真实 PASS/FAIL 与源码核验。候选安全 workflow 已接入 22 个 workflow 的固定 Action/只读权限策略。Windows 完整密钥扫描核验 9,790 个 Git 文件；8e46c66400 的远端 tree 与提交变化扫描也通过，未审查发现项为 0，真实合成密钥拒绝与脱敏自检通过。精确例外只覆盖已审查的完整行；46 个 tree 命中核验为 Git blob，11 个为精确非密钥行。见 [G2-SUPPLY.json](gate-2/G2-SUPPLY.json)。

Dependency review 实际失败：公开 fork 未提供所需 Dependency graph 功能，API 返回 403，浏览器无登录态，未更改设置，也未豁免此项。de346d2221 的 CodeQL Python 与 Swift 通过；Swift 分析完整，原始发现项 1、已审查 1、未审查 0，精确源码上下文审查已取得远端回执。JavaScript 从 91 降为 86，前轮两个线性扫描消除了对应的全部 5 项发现；Kotlin 仍有 7 项和位于 PushNotifications.kt 的阻断提取诊断。此前 d28a442df6 的原始 FAIL 持续保留。

代码检查点 e228177a22 包含三项 CI 测试修复、Kotlin/Compose/JVM 2.2.21 与 AGP 8.10.1 对齐、通知的 javaObjectType 显式 Activity 映射及实际系统 token 验证。Android core 125/125、两套 debug APK 构建和 API 34 instrumentation 2/2 通过；三套 CI 回归在 Windows Node 22/24 和 Linux 均 29/29 通过，最后的类型收窄另有 Windows cache 16/16 及 Linux 29/29。独立 CodeQL 2.26.4/security-extended 实验完成分析，提取 ERROR 为 0，剩余 6 项 Noise 发现；原始提取 WARN 为 168，不能称为零 warning。实验使用 de346 archive 加两文件覆盖，不冒充正式候选准入。test:docs 15/15、doc-sync 32/32、lint 0 warning/0 error；准确源码摘要和边界见[本轮证据](gate-2/security-followup-de346d2221.json)。新候选仍需远端复验；[CI 与供应链计划](../../docs/plans/2026-09-05-gate-2-ci-supply.zh.md) 的其余 scanner、SBOM、provenance、RC 与 Gate 2-4 工作继续执行。

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
| 原规划基线 | `dev@90ef8b197fe2aa38cc40917cd157077a8d1dc6b9` | 用户工作区仍仅有原未跟踪核验文档 |
| 本地 coverage 后检查点 | `c73daa2c6960afb9bfad5bc16edcef1ee2614b27` | 最后只修正测试夹具访问 Context；该包 17/17、单文件四维 100% 与完整 doc-sync 32/32 通过 |
| 完整 coverage 执行候选 | `4dded5f0e9cb4ea00bd092d92740aa718c678be1` | 到最新检查点只有同一 Context 的测试访问修正；产品源码未变 |
| 最近 Swift/Kotlin E4 SHA | `ac42842c38142e13859da4981f9a820906f5ec6b` | PR 合并提交，tree 与 53cd3e79ad 相同；两种语言各 13/13，恢复见原始回执 |
| Android App 输入检查点 | `1b181627e7c723dedb04d5ca429ee17b8701b0c3` | App tree 至最新候选完全相同；装配、签名检查、API 34 首屏通过 |
| 分支 | `codex/goal-mode-full-implementation` | 代码检查点 e228177a22；de346d2221 的 Apple/Android/Swift SAST 通过，CI 与整体供应链 FAIL；新修复待远端复验；draft PR #1，base=dev |
| worktree | `E:\Mix\project\deepseek-harness\.worktrees\goal-mode-full-implementation` | 与用户 dev 隔离 |
| Gate 1 | `PASS / CLOSED` | `canEnterGate2=true`；准入候选 906d193595 |
| Gate 2 / 3 / 4 | `IN_PROGRESS / NOT_STARTED / NOT_STARTED` | 版本、渠道与在线 CI 证据已接线；继续供应链与平台发布工程 |
| 候选推送 / draft PR | `PASS` | PR #1；release 和商店上传仍为 NOT_EXECUTED |
| 生产凭证 | 未读取、未使用 | 只使用本地 debug 签名 |
| 完整 coverage 候选规模 | 462 files, +34,183/-2,252 | 原 dev 至 4dded5，排除 vendor；不含本轮后续 evidence-only 更新 |
| 快照更新日期 | 2026-09-06 | Asia/Hong_Kong |

### 1.3 候选与当前 HEAD 的区别

`abe90fa1d6` 是上一份交接的历史候选。接续提交依次为 `383b1176b8`（Android 依赖兼容）、`1b181627e7`（启动修复与模拟器回归）、`4c2e8f4616`（取消断言与实际会话快照）、`7752b634d1`（fixture 规范化与终端输出）、`9fcde39df0`（17 文件覆盖率补齐）、`4dded5f0e9`（授权日志错误包装断言）、`c73daa2c69`（测试夹具持有 Context）。最后三次只改测试，未修改产品运行源码或 coverage 配置。

本轮证据在各项检查之后写入。后续 evidence-only HEAD 不代表所有检查在该新 SHA 上重跑；旧失败保留在对应 owner JSON 的历史记录内，本轮实际结果见 `G1-PORTABLE-RUNNERS.json` 与 `G1-ANDROID-APP.json`。

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
| Gate 1 — P0 correctness | `PASS` | 13/13 必要任务通过；723335fefe 的独立 Windows coverage 修复也已验证 | 后续候选分别取得新证据 |
| Gate 2 — P1 release foundation | `IN_PROGRESS` | 版本、渠道、CI 与 scanner 已接线；Android/Apple 元数据、完整密钥扫描已验证 | Windows 版本产物、SAST/依赖审查准入、RC、供应链、发布/支持/迁移/回滚 |
| Gate 3 — P2 Beta readiness | `NOT_STARTED` | 旧代码中已有部分 QR、Lite、Handoff、Windows/移动 UI 基线 | 必须重新按 Gate 3 验收，不得沿用旧报告的“完成”字样 |
| Gate 4 — GA handoff | `NOT_STARTED` | 无 | GA dry-run、生产签名交接、商店包、rollout、incident、最终 handoff |
| P3/Future | `DEFER` | 现有 reference 实现保留 | First-party Relay、APNs/FCM、PTY、复杂 RBAC、Handoff L2 等不得顺手扩展 |

Gate 1 的代码侧 P0 修复和双语言 E4 已形成可继续工作的基线。Gate 2 正在准备版本与渠道机制；产品发布、Beta 和 GA 尚未完成。

-----

## 4. Gate 1 完成明细

### 4.1 任务矩阵

| 任务 | 状态 | 当前证据 | 结论 |
|---|---|---|---|
| G1-RC | `PASS` | [`implementation-baseline.json`](gate-1/implementation-baseline.json) | 基线、分叉、worktree 与候选策略已记录；用户 dirty 文件未被修改 |
| G1-COMP | `PASS` | [`G1-COMP.json`](gate-1/G1-COMP.json) | shipped base YAML 可解析；Gateway setup 14 个失败清零；真实 Host slice 启动 |
| G1-DOC | `PASS` | [`G1-DOC.json`](gate-1/G1-DOC.json) | Linux `test:docs` 15/15、`doc-sync` 32/32，原 symlink fixture 阻断已关闭 |
| G1-CONTRACT | `PASS` | [`G1-CONTRACT.json`](gate-1/G1-CONTRACT.json) | unary、stream、Remote Event、void/error、sequence/cursor、版本和 capability 由一个 source graph 所有 |
| G1-GEN | `PASS` | [`G1-GEN.json`](gate-1/G1-GEN.json) | manifest、JSON Schema、Swift、Kotlin、fixtures、domain/Lite conformance 可重复生成且无 drift |
| G1-APPLE | `PASS / E4` | [`G1-APPLE.json`](gate-1/G1-APPLE.json) | SwiftPM、真实 Host 与恢复、三套 Xcode 构建、iOS 首屏均在 d72930ed61 的 merge tree 通过 |
| G1-ANDROID | `PASS / E4` | [`G1-ANDROID.json`](gate-1/G1-ANDROID.json) | Kotlin core 125/125；真实 Host 13/13；debug APK 装配与 API 34 未配对首屏通过；真机网络未验 |
| G1-AUTH | `PASS` | [`G1-AUTH.json`](gate-1/G1-AUTH.json) | Session、Workspace、Interaction、Resource、Path 最小 scope 与撤销/角色/审批开关均已验证 |
| G1-PRIV | `PASS / E4` | [`G1-PRIV.json`](gate-1/G1-PRIV.json) | 遥测默认关闭/白名单导出；匿名 identity、Artifact 路径和 native 证据均做隐私收口 |
| G1-E2E | `PASS / E4` | [`G1-E2E.json`](gate-1/G1-E2E.json) | TypeScript reference、Kotlin 与 Swift 均完成同一 13 步真实 Host corpus |
| G1-MULTI | `PASS / E4` | [`G1-MULTI.json`](gate-1/G1-MULTI.json) | 3 轮共 9 项通过；两个 Controller 获胜顺序、迟到结果、Observer 拒绝均确定性验证 |
| G1-REC | `PASS / E4` | [`G1-REC.json`](gate-1/G1-REC.json) | Swift 与 Kotlin 断流后 Host 离线推进 11 个 sequence，重复重连投影一致 |
| G1-CI | `PASS` | [`G1-CI.json`](gate-1/G1-CI.json) | 906d193595 必要检查与实际源码已核验；独立 Windows 失败继续单列 |

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

Host 在第一个 assistant chunk 后中断两条 active stream，Session 在客户端离线期间继续。最新远端恢复 snapshot 从 sequence 81 前进到 cursor 92，包含 11 个离线 sequence，`hasMore=false`；第二次重连仍为 cursor 92，并与第一次恢复后的投影结构相等。

本轮修复候选 `6dbbcf74570e53c30b823d2f529499c8b4a1bafd` 已正常提交和推送。Linux 的冻结依赖、configuration、focused unit、pwsh、官方构建、Web 5/5 回放、doc-sync 32/32、Lint、Python 实际可执行文件的 advanced/restart 刷新及回放均通过；Windows Node 24.19.0 的原 CI 五套组合为 69 passed / 1 skipped。新候选已取得失败 verdict，准确通过项和剩余失败见 G1-REMOTE-PR.json；隔离 Linux 工作树的 git HEAD 不代表本轮执行源码提交，准确输入说明见 G1-REMOTE-PR.json。

### 4.3 候选验证数字

| 验证面 | 实际结果 | 执行 SHA / 范围 |
|---|---|---|
| 完整 coverage | 1,022 文件、16,441 测试通过；39 测试跳过；逐文件四维 100% | `4dded5f0e9`，Linux Node 22；不等于远端 Node 24 CI |
| coverage-exempt-heavy | 1,157 通过、28 跳过 | `383b1176b8`；后续对应实现与测试未变 |
| Recorded-session replay | 113/113 | `7752b634d1`；后续 fixtures 与运行源码未变 |
| Artifact local 最终复验 | 17/17、单文件四维 100% | `c73daa2c69`，测试类型修正 |
| Contract package focused | 39/39、包内逐文件四维 100% | 补齐后输入固化于 `9fcde39df0` |
| Linux build | 220 client artifacts | `454d26a0b7`；reflog 和日志时间共同核对 |
| NodeNext consumer | 268 workspace declaration APIs | `383b1176b8` |
| Android pure-JVM core | 125/125，28 suites | Android OkHttp 5.3.2 输入 |
| Android debug App | 装配、APK signature、API 34 instrumentation 1/1 | App 输入固化于 `1b181627e7`，后续 App tree 未变 |
| Host↔Kotlin acceptance | 13/13；恢复 82→93，离线 11 sequence、两次 stream replacement、重复投影相等 | `9fcde39df0` |
| 文档快速 / 完整聚合 | 15/15 与 32/32 | 快速检查执行于 `4c2e8f4616`；最新完整 doc-sync 在 `c73daa2c69` 加本轮交接输入后通过 |
| Lint | 0 warnings / 0 errors；最终断言修正 staged lint 通过 | `9fcde39df0` 与 `4dded5f0e9` 提交钩子 |
| 远端 mandatory CI | `PASS` | 906d193595 的 aggregate、Apple 与 Android PASS；CI workflow 因独立 Windows 文档测试仍为 failure |

历史 `abe90fa1d6` 的 `check:ci` 55 PASS / 5 FAIL 保留审计记录。Linux 复跑同时发现了真实的 fixture drift、测试断言错误和 17 文件覆盖率缺口；这些均已修复，不能把它们统称为宿主环境问题。

-----

## 5. 尚未完成与已跳过项目

### 5.1 Swift 验证的最新授权与临时延期

以下 3 项最初记录为 `NOT_EXECUTED / SKIPPED_BY_USER`。用户在本次接续中明确重新授权验证，并允许 macOS/Xcode 专属证据临时延期；历史处置保留，最新处置为 `REOPENED_WITH_APPLE_ENVIRONMENT_DEFERRAL`：

1. `swift test`。
2. Real Host-to-Swift acceptance。
3. Swift disconnect and authoritative recovery。

远端 macOS runner 已完成 `swift test`、真实 Host 13/13 与恢复、三套 Xcode 构建和 iOS 首屏 XCTest。SwiftUI、Apple Security、真实 Apple TLS 和 simulator 的证据来自实际 Apple runner。用户允许暂缓无法取得环境的项目，但当前环境可用；延期不覆盖产品错误或生产发布权限。

### 5.2 本轮已关闭项与剩余条件

| 项目 | 当前状态 | 已取得证据 / 剩余条件 |
|---|---|---|
| Android App 装配与首屏 | `PASS` | 现有 SDK 位于 `E:/Android_Studio_SDK`；debug APK SHA-256、manifest、真实 Activity instrumentation 1/1 |
| 完整 coverage | `PASS` | Linux 16,441 测试通过，逐文件四维 100%；未降低阈值或增加 ignore |
| coverage-exempt-heavy | `PASS` | 独立 Linux checkout 1,157 通过、28 跳过 |
| Recorded-session replay | `PASS` | 官方 keyless refresh 与 packed fixture canonicalization 后 113/113；没有调用真实模型 API |
| 文档站点与 NodeNext | `PASS` | 完整 doc-sync 32/32，NodeNext 268 workspace APIs |
| Remote candidate CI | `PASS` | 906d193595 必要检查已通过；独立 Windows 文档测试失败与本地修复见 G1-REMOTE-PR.json |
| Swift / Apple simulator | `PASS / E4` | SwiftPM、真实 Host、Xcode shell 构建与新模拟器安装首屏通过；真机网络未验证 |
| 真机网络与设备行为 | 未验证 | Android emulator→Host pairing、Android crypto provider、Wi-Fi↔蜂窝等仍不由 JVM/首屏证据替代；真机计划在 G1-ANDROID-APP 中 |

### 5.3 当前 Gate 决策

当前准入绑定已验收的不可变候选：

```json
{
  "status": "PASS",
  "closure": "CLOSED",
  "canEnterGate2": true,
  "acceptedCandidate": "906d19359588584ffe154d9abe8aea752e7b743a"
}
```

该决策使用真实 Apple runner 和全部必要 CI 结果，未使用环境延期代替验收。独立 Windows 文档测试的 FAIL 与修复状态分别保留；后续候选的 pending 结果不能冒称已通过，也不改变 906d193595 这份不可变回执的执行事实。

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

- 旧报告中的“Apple CI 构建绿”“Swift 八项全落”不是运行证据；本交接引用的 SwiftPM、真实 Host/恢复、Xcode 与首屏回执构成已执行的 Apple 验证，不能继续标为只有 E2。
- 本轮已取得 Android debug APK 装配、签名检查、API 34 首屏 instrumentation 和对应 checksum。JVM Host↔Kotlin E4、模拟器首屏与真实设备网络验收仍分别记录，不相互替代。
- PoC-2/PoC-4 的双语言 E4 已有实际 Swift/Kotlin 回执；旧报告自身的“完成”字样不能替代这些新证据。
- 旧报告中的“Contract capability 不完整”已有实质进展；source graph 包含版本和 capability 字段，Swift/Kotlin 真实 Host corpus 均已有 E4 回执。
- 旧报告中的“所有 TS/Apple/Android 车道全绿”不得替代当前 RC SHA 验收；723335fefe 的 CI、Apple、Android 已取得正式 PASS，新扫描器候选的供应链和 CI 结果另行记录。

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

用户已批准 Apple 环境依赖的临时延期；不再因缺少 macOS/Xcode 重复询问或停止下一阶段。下一阶段规划与可独立验证的工程工作继续推进，同时获取非 Apple mandatory CI 的实际结果并修复失败。Gate 1 的平台证据仍如实记录，不能伪造为全平台 E4。

-----

## 8. 优化后的后续任务基线

### 8.1 Gate 1 收尾

| 任务 | 当前状态 | 下一动作 | 关闭证据 |
|---|---|---|---|
| G1-APPLE-RUN | `PASS / E4` | SwiftPM、真实 Host 与恢复、三套 Xcode 构建及 iOS 首屏均通过 | 实际 merge tree 与 d72930ed61 一致 |
| G1-REC-SWIFT | `PASS / E4` | 与 Swift 13/13 同次完成，保留回执 | 断流、离线推进、重连、重复重连投影相等 E4 |
| G1-ANDROID-APP | `PASS` | 保留装配与首屏证据；真机执行按后续计划 | APK、checksum、manifest、instrumentation 1/1 |
| G1-REMOTE-CI | `PASS` | 906d193595 必要 verdict 和 source receipts 已核验；新候选独立验收 | `all checks passed` 与 Android/Apple 平台 verdict |
| G1-PORTABLE-RUNNERS | `PASS` | 保留当前本地证据；远端平台矩阵独立运行 | 五项原阻断与实际产品/测试缺口已在 Linux 关闭 |
| G1-WAIVER | `AUTHORIZED_TEMPORARY` | 仅暂缓 macOS/Xcode 专属证据；其余检查继续 | G1-APPLE-DEFERRAL.json；保留真实执行状态 |

### 8.2 Gate 2 — Release Engineering Foundation

版本与渠道的具体实施路径见 [Gate 2 产品标识计划](../../docs/plans/2026-09-05-gate-2-product-identity.zh.md)；其余任务仍按下表验收。

| 任务 | 状态 | 优化后的目标与验收 |
|---|---|---|
| G2-VERSION | `PARTIAL` | 根 SemVer/build number 已统一，Android APK 与三个 Apple scheme 的实际版本已验证；Windows 可执行文件版本仍待验证 |
| G2-CHANNEL | `PARTIAL` | dev/canary/beta/stable 解析与版本兼容策略已实施；RC 分发递增比较及受保护的上传/晋级策略待实施 |
| G2-CI | `PARTIAL` | required-check 清单、源码回执和在线核验已完成；继续四平台 RC workflow 与当前候选验收；未修改 branch protection |
| G2-SUPPLY | `PARTIAL` | Actions full-SHA pin、最小 permissions、dependency review、CodeQL/SAST、secret scan、SBOM、checksum、portable provenance/attestation hook |
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
                    │     ├── Android App assembly 与首屏（本地已通过）
                    │     ├── Linux runner 与 coverage（本地已通过）
                    │     └── 经授权 push + draft PR，并重新打开 Swift / Remote CI
                    │
                    └── Gate waiver 路径
                          └── 已获 Apple 环境临时延期；不得标 Swift PASS
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

当前授权允许发布候选、获取 PR verdict，并按 Apple 环境临时延期继续下一阶段。执行顺序以最新 `gate1-evidence.json` 和 `G1-APPLE-DEFERRAL.json` 为准，不再重复请求相同授权。

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
| [`gate-1/G1-CI.json`](gate-1/G1-CI.json) | 候选命令、历史本地聚合与实际发布状态 |
| [`gate-1/G1-REMOTE-PR.json`](gate-1/G1-REMOTE-PR.json) | draft PR、远端 jobs、SwiftPM 与最新 Kotlin E4 receipt |
| [`gate-1/G1-COMP.json`](gate-1/G1-COMP.json) | composition 修复前后 |
| [`gate-1/G1-DOC.json`](gate-1/G1-DOC.json) | 文档 drift 与 symlink 环境分类 |
| [`gate-1/G1-CONTRACT.json`](gate-1/G1-CONTRACT.json) | Contract ownership 与协议语义 |
| [`gate-1/G1-GEN.json`](gate-1/G1-GEN.json) | generator 输出与 freshness |
| [`gate-1/G1-APPLE.json`](gate-1/G1-APPLE.json) | Swift E4、三套 Xcode 构建与已通过的模拟器首屏 |
| [`gate-1/G1-ANDROID.json`](gate-1/G1-ANDROID.json) | Android core、pinning、App 装配和首屏证据 |
| [`gate-1/G1-ANDROID-APP.json`](gate-1/G1-ANDROID-APP.json) | SDK/依赖修复、启动崩溃、APK 与模拟器回归、真机计划 |
| [`gate-1/G1-PORTABLE-RUNNERS.json`](gate-1/G1-PORTABLE-RUNNERS.json) | 各项 Linux 检查、实际 SHA、日志 checksum 与历史失败 |
| [`gate-1/G1-CLOSURE-DECISION.json`](gate-1/G1-CLOSURE-DECISION.json) | Gate 决策、发布授权与 Apple 环境临时延期范围 |
| [`gate-1/G1-AUTH.json`](gate-1/G1-AUTH.json) | 最小授权 scope |
| [`gate-1/G1-PRIV.json`](gate-1/G1-PRIV.json) | telemetry、identity、Artifact 与 native evidence 隐私 |
| [`gate-1/G1-E2E.json`](gate-1/G1-E2E.json) | TypeScript/Kotlin/Swift 跨语言矩阵 |
| [`gate-1/G1-MULTI.json`](gate-1/G1-MULTI.json) | 多控制器审批 E4 |
| [`gate-1/G1-REC.json`](gate-1/G1-REC.json) | 断连恢复 E4 与 Swift 缺口 |
| [`gate-1/acceptance/kotlin-9fcde39df023c9dad790f41e6fc46c931e88898e.json`](gate-1/acceptance/kotlin-9fcde39df023c9dad790f41e6fc46c931e88898e.json) | 历史本地真实 Host↔Kotlin privacy-safe acceptance，保留实际执行 SHA |

### 11.1 本交接文档验证

版本接线输入已通过 Linux doc-sync 32/32、test:docs 15/15 与全量 lint；验证在隔离 Linux checkout 的同步源码上执行，不冒称新 commit 的 clean checkout 重跑。聚焦测试与平台元数据的准确范围见 [G2-VERSION.json](gate-2/G2-VERSION.json)。

候选 d72930ed61 的 Swift/Kotlin 两份 E4 回执均执行于 22912379f538c604f2de9f2e19b2ad23f5bd59ec，其 tree 与候选一致。iOS 首屏同次通过；coverage 修复仍需新候选取得远端 verdict。

-----

## 12. 当前结论

Gate 1 已按不可变候选 906d193595 的必要验收关闭。de346d2221 已确认 Apple、Android、完整密钥扫描、Python 与 Swift CodeQL 通过，以及 5 项 JavaScript 发现消失；CI、Kotlin/JavaScript SAST 和 Dependency review 保留实际 FAIL。e228177a22 的 CI 与 Android 修复已通过本地测试及独立 CodeQL 实验，仍需新候选远端验证。下一步确认新候选结果，处理 Noise 计数耗尽及六项密码学发现、剩余 JavaScript 发现、独立 Windows 进程退出和依赖扫描；继续产物/SBOM/provenance、四平台 RC 和第 8 节其余发布工程、Beta、GA，不能声明整个目标完成。

后续 Agent 必须从 Gate 1 closure decision 开始，不能把旧报告中的绿色里程碑、当前文件存在或用户跳过动作提升为未实际执行的平台证据。
