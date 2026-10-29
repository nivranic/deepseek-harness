# 实施核验报告 v2

DeepSeek Harness 仓库现状核验

快照：`dev@90ef8b197fe2aa38cc40917cd157077a8d1dc6b9`

核验时间：2026-09-01 至 2026-09-02，Asia/Hong_Kong

对比基线：`21ce4e387c145020f21bd1fe1a9c0438c4235423`，即源方案时间戳 2026-08-30 07:32:17 +08:00 当时或之前的最新提交。

依据优先级：实际执行结果、当前源码、当前 CI/构建/发布配置、当前测试、仓库文档、2026-08-30 核验结论、方案假设。

这是一份特定时间点的核验报告，不授权也不实施 PoC-2 或任何后续功能。

## 报告导航

- 第 1–13 节覆盖架构、Runtime、Contract、安全、Native 进展与各 PoC。
- 第 14–32 节覆盖开发、测试、CI、构建、交付、发布、安全、可观测性、迁移、兼容、回滚与治理。
- 第 33–44 节给出能力清单、矩阵、风险、优先级、建议动作和最终 Ground Truth。

## 1. 执行摘要

架构基础仍然成立：Native 访问复用了 Typert Gateway、Domain Controllers、Session Journal、Projection 和 Interaction 的既有所有者。仓库没有创建第二套业务 Gateway，也没有创建第二个权威 Session 域。

当前 `dev` checkout 不是可工作的 Remote MVP，也不是发布候选。已交付的 base composition 因 `packages/bundle/base/cordis.patch.yml:122` 缺少 YAML 注释标记而无法解析，carrier 级 Link E2E 因此在配对前失败。聚焦的 Gateway stream 测试另有 14 个 setup 失败，因为测试组合没有注入服务，`client-connection` 却读取 `ctx.webServer`。完整文档门禁有 8 个失败项，包括生成目录过期与 type-link/JSDoc 所有权缺失。

2026-08-30 关于 Native、Pairing、Device Trust、角色、allowlist、Push、Relay、Apple/Android 客户端和 Lite 尚不存在的判断已大幅过时。此后 126 个提交改动 616 个文件，新增约 42,726 行。当前已有 Remote Link、设备信任、生成式 Swift/Kotlin Contract、Apple/Android Companion、两端 Lite、macOS Direct Host shell、Relay/Noise、Artifact 与 Handoff L1。

代码存在不等于产品可用。生成式 Native Contract 未覆盖真实 carrier envelope 和完整 Remote Event 协议。Android payload envelope 会被 Host 拒绝；Apple/Android Remote Approval 使用了 Host 不会发送的 wire 字段；首次配对后两端仍持有旧 unpaired wire。Android 保存 SPKI 指纹却未在 JDK HTTP transport 真正校验，follow 失败后也不会自动重连。

PoC-1 当前为 `PARTIAL`；PoC-2、PoC-3 为 `BROKEN`；PoC-4、PoC-5 为 `PARTIAL`；PoC-6、PoC-7 为 `SKELETON`。当前最大缺口是 Runtime composition、跨语言 Contract、Native 真实互操作、安全 scope 与完整 App 交付链。

距里程碑的差距：

- Remote MVP：修复 base composition；统一 carrier/event envelope；修复两端 Native 客户端；证明 pair/list/open/prompt/stream/approval/cancel/reconnect。
- Beta：选择已对齐的 release-candidate SHA；运行所需 CI；闭环遥测同意与脱敏；产出已签名平台产物；完成真实设备验收与 Crash/诊断支持。
- GA：补齐 updater/rollback、商店治理、迁移/兼容策略、灰度控制、事故责任人与生产可观测性。

## 2. 仓库基线

| 字段 | 当前事实 |
|---|---|
| 仓库 | DeepSeek Harness monorepo |
| 默认分支 | `origin/master` |
| 当前分支 | `dev`，跟踪 `origin/dev` |
| HEAD | `90ef8b197fe2aa38cc40917cd157077a8d1dc6b9` |
| HEAD 时间 | 2026-09-01 13:30:14 +08:00 |
| 初始工作树 | clean；无 tracked 或 untracked 条目 |
| Remote | GitHub 上的 `origin`；URL 已省略 |
| 包管理器 | `pnpm@11.7.0` |
| Node | `v22.22.1`；engine 为 `^22.19.0 \|\| >=24.0.0` |
| HEAD 版本 | `0.1.2-alpha.1` |
| 本地 master 版本 | `0.1.2-alpha.3` |
| 主要语言 | TypeScript/TSX、Swift、Kotlin、Python、JavaScript/MJS、C/C++ |
| 主要框架 | Cordis、React/Vite、Electron、Swift/SwiftUI、Kotlin/Jetpack Compose |
| 构建 | pnpm workspaces、TypeScript project references、tsdown、Vite、SwiftPM/XcodeGen、Gradle |
| 测试 | Vitest、pytest、Swift Testing、Kotlin/JUnit、workflow contract tests |
| CI | GitHub Actions 与 GitLab CI |
| 发布 | GitHub Actions 发布 npm/PyPI/native launcher；GitLab Package Registry 发布 Python tag 产物 |

`dev` 与本地 `master` 显著分叉：`master...dev = 351/157`，merge-base 为 `cd5ef814…`。当前 `dev` 是本次事实来源，但不是已证明的发布候选。

顶层 `native/` 负责 Linux Landlock launcher，不是 Apple/Android 产品实现；产品 Native 代码位于 `apps/apple` 与 `apps/android`。

## 3. 核验方法

| Evidence Level | 本报告中的含义 |
|---|---|
| E0 | 仅有文档或方案 |
| E1 | 类型、接口、target 或 skeleton 存在 |
| E2 | 当前实现存在且已检查 |
| E3 | 所述范围内的测试、构建或 generator 存在且通过 |
| E4 | 所述范围内的 Runtime、本地集成、E2E 或线上 workflow 已实际验证 |

Evidence Level 衡量核验深度，不代表成功。复现出的失败可标为 `BROKEN / E4`。能力状态只使用 `VERIFIED`、`PARTIAL`、`SKELETON`、`MISSING`、`BROKEN`、`STALE`、`OBSOLETE`、`UNKNOWN`、`NOT APPLICABLE`；建议动作只使用 `KEEP`、`EXTEND`、`ADD`、`FIX`、`DEFER`、`REMOVE`、`INVESTIGATE`。

| 已执行检查 | 结果 |
|---|---|
| 初始 Git 基线 | clean |
| `verify-link-contracts`，使用临时 Node user-info preload | PASS；manifest、Swift、Kotlin、fixtures、domain/Lite conformance 均为最新 |
| 9 个聚焦 Runtime 测试文件 | 148 passed；14 个 Gateway stream 测试在 setup 失败 |
| `link-session-slice.e2e.ts` | 测试执行前 FAIL：`packages/bundle/base/cordis.patch.yml:122` 为无效 YAML |
| 官方 Host/Client/Web build | PASS；当前 HEAD 记录 220 个 client artifacts |
| dsh release graph | PASS；254 个成员已排序，2 处已说明的 unordered peer declaration |
| vendor release graph | PASS；9 个成员已排序，2 处已说明的 unordered peer declaration |
| Relay self-test | PASS；本地 Noise/rendezvous 流程 |
| `pnpm run test:docs` | PASS；15/15 |
| `pnpm run doc-sync` | FAIL；24/32 通过，7 类仓库漂移失败，另 1 项为宿主 symlink 权限失败 |
| `pnpm run lint` | Host build 后 PASS |
| CI/release workflow tests | 44 passed；Python runtime builder 初次 3 failed |
| Python runtime builder 使用宿主 workaround | 1 passed；2 个 Windows assertion 因 `process.execPath` 引号仍失败 |
| 当前 HEAD 的 GitHub Actions | Android Kotlin push run 成功 |
| 最新相关 Apple workflow | `6b1acf3b9932` 成功 |
| 当前 HEAD 通用 Node CI | 无 run；`ci.yml` 不响应普通 `dev` push |
| GitHub rulesets | 公共端点为 0；legacy protection 返回 HTTP 401，required checks 为 `UNKNOWN` |
| Apple/Android 本地 build | `NOT EXECUTED`；Windows 无 Swift/Xcode，Android 无 Gradle/wrapper |
| Windows packaging | `NOT EXECUTED`，避免覆盖历史 ignored 产物 |
| 真实设备/store/signing/release | `NOT EXECUTED`；缺少平台/凭据且禁止生产动作 |

未修改的 `pnpm` TSX 入口最初因宿主 `os.userInfo()` 返回 `uv_os_get_passwd ENOMEM` 而失败，尽管约有 55 GB 空闲内存。临时 preload 只替换该用户查询；原始失败与 workaround 后的产品结果分别记录。

## 4. 自 2026-08-30 以来的变化

对比范围包含 126 个提交、616 个改动文件、约 42,726 行新增和 219 行删除。

| 提交 | 当前 HEAD 中的变化 |
|---|---|
| `06061227c6` | Remote Link vertical slice |
| `79c7af0f16` | Host settings bridge 与 Link administration |
| `e5aa3e0c6b` / `ffe00b0bce` | Desktop 配对/设备 UI 与 remote-off-by-default composition |
| `6a9498c2d1` | 生成式、带 drift gate 的 Link Contract artifacts |
| `883a38c05d` | Carrier 级 session E2E |
| `3808ed1cb7` / `06b71c1ca5` | Apple Remote Core 与 CompanionUI |
| `c6a39f6ab9` / `4a61c1f0ab` | Apple CI 与 Xcode shells |
| `cc4de62805` 起 | Lite Behavior Spec 与 Apple Lite |
| `3093d6dcd0` 起 | Android Kotlin core、wire client、Compose app 与 Lite |
| `71f3bc0de2` | macOS Direct Host skeleton |
| `5e63be16b4` | Apple/Android 本地 push vocabulary |
| `2fbc031535` / `d85f6da804` | Relay/rendezvous 与 Noise transport |
| `0d304dcbfd` 起 | Artifact event、storage、resource channel、paging |
| `6b1acf3b99` | Handoff L1 vocabulary 与 device senders |

“只缺多设备账户/连接层”的旧结论为 `OBSOLETE`。该层已有大量实现，真实跨语言验收与交付仍不完整。

## 5. Runtime / Gateway 核验

Typert Gateway 与 Remote streams 为 `PARTIAL`。总体证据 E2，官方 build 为 E3，shipped Link composition 失败为 E4。所有者仍是 `@deepseek-ai/dsh-api-gateway`，carrier 为 `client-connection` 与 `link-access`，位置为 `packages/api/gateway`、`packages/client/connection`、`packages/remote/link-access`。

`packages/api/gateway/src/index.ts` 实现 unary `remoteRequest()`、stream mux 与 ready/emit/waterfall/cancel/result。聚焦 stream suite 有 14 个 setup 失败；`apps/cli/tests/link-session-slice.e2e.ts` 无法启动 shipped base YAML。本地 browser/API 与 Native Link 汇入既有 Gateway，Link 只增加 TLS、设备认证、allowlist 和授权，不拥有 Session 状态。

缺失项是可运行的 shipped composition、通过的 Gateway stream composition、跨语言统一 envelope/event Contract 与有界生产背压证据。风险是 build-green/runtime-red。建议 `FIX`。

Domain Controllers 与 Native 复用映射为 `PARTIAL / E2`，Session history 为 E3。Session、Workspace、Settings owner 保留，新增 `packages/api/link-controller`。`packages/remote/link-access/src/protocol.ts` 只将选定 endpoint 加入 Native allowlist；Native 不获得通用 Settings、workspace mutation、credential 或 plugin administration。建议 `KEEP` owner，仅 `EXTEND` 最小授权 Native 子集。

## 6. Session / Projection / Recovery

Host 为 `VERIFIED`，Apple 为 `PARTIAL`，Android 为 `BROKEN`。`packages/api/session-controller/src/history.ts` 与 client transport 实现权威 snapshot、sequence-aware live event 和 tail repair；JSONL/zstd 与 SQLite owner 位于 `packages/session/session-persistence-*`；`session-history-journal.host.spec.ts` 通过。

Apple `RemoteSessionViewModel.swift` 重连后用权威 snapshot 替换，但未发送 cursor。Android `CompanionModels.kt` 捕获 follow 失败后结束 collection，不自动重连。缺失 Android reconnect、Native Contract 的 cursor/sequence 语义，以及 silent loss 为 0、最终 projection 正确的真实断连验收。风险是 Native UI 静默停止 follow。建议先修 Contract，再 `EXTEND`。

## 7. Approval / Interaction

Host 为 `VERIFIED`，Apple/Android 为 `BROKEN`。`packages/api/gateway/src/index.ts:531-585` fan-out waterfall，接受首个有效 result，把迟到 result 作为 no-op，并取消其他 delivery。`gateway-stream.host.spec.ts:646-698` 规定 first-result-wins，但当前文件更早在 setup 失败。

Apple `InteractionViewModel` 自行生成 client id，没有使用 `ready.clientId`，且从错误层级读取 Host 放在 `request` 下的数据。Android `InteractionModel` 缺少 `clientId`，发送 `result`，Host 期待 `outcome`。Host 并发基础可复用，Native 当前不可复用。建议 `FIX` 完整 Remote Event Contract、Host-assigned client identity 与 waterfall request/result/cancel。

## 8. Contract / Typert

统一 Native Link Contract 为 `PARTIAL`。Freshness 为 E3，所有权不完整为 E2。`scripts/gen-link-contracts.ts` 与 `scripts/verify-link-contracts.ts` 生成 Swift/Kotlin models、manifest、fixtures 与 conformance data，实际 freshness 已通过。

Type graph 未生成 unary/stream request envelope，也未生成完整 `ready/waterfall/cancel/result` Remote Event vocabulary。未找到独立 Native JSON Schema artifact 或 generation lane，为 `MISSING / E2`。风险是 freshness 绿色只能证明生成文件一致，不能证明完整互操作。建议 `EXTEND` transport framing、event state machine、void-result 语义与 versioned compatibility corpus。

## 9. Authentication / Authorization

Browser trust 对 Web carrier 为 `VERIFIED / E2`。`BrowserAuth` 保留 authority-bound HMAC cookie，`isTrustedApiRequest()` 对 loopback 或 trusted authority 执行 Host/Origin 检查；它不是 Remote device identity。

Native authentication 为 `PARTIAL / E2`：`link-access` 校验已知未吊销 device、timestamp、body digest 与 Ed25519 signature，拒绝 unknown、stale、mis-signed、revoked device。Per-request authorization 为 `PARTIAL / E2`：有 endpoint/kind/minimum-role allowlist 与独立 Remote Approval switch，但无完整 Session/Workspace/Interaction/Resource scope。

Android transport security 为 `BROKEN / E2`：`LinkPinning.kt` 只保存 pin，当前 `LinkClient.kt` 使用普通 JDK HTTP client，测试也只覆盖 cleartext loopback HTTP。建议 Remote Beta 前 `FIX` Android pinning。

## 10. Pairing / Device Trust

| 能力 | 状态 | 证据 | 当前所有者 |
|---|---|---:|---|
| 一次性 pairing code/expiry/consume | `VERIFIED` | E2 | `packages/remote/device-trust` |
| Device id/name/public key/role/timestamps/revocation | `VERIFIED` | E2 | SQLite device-trust store |
| observer/controller/administrator vocabulary | `VERIFIED` | E2 | device-trust 与生成 Contract |
| 可配对角色 | `PARTIAL` | E2 | 仅 observer/controller；administrator 预留 |
| Windows QR rendering | `PARTIAL` | E2 | desktop settings UI |
| Apple/Android camera QR scan | `MISSING` | E0 | 仅文本粘贴 |
| Fresh-pair client ownership | `BROKEN` | E2 | 两端 Native App root 保留旧 unpaired wire |

Trust store 独立于 LLM credential，revocation 持久化，授权请求更新 last-seen。无生产 device migration、加密 Host backup 或 per-resource grant migration。建议先 `FIX` Native ownership，再 `EXTEND` lifecycle 与 migration。

## 11. Remote Access

Remote surface 是明确 allowlist，不暴露全部 Gateway endpoint。Observer 可读/follow session、workspace、files、artifacts、subagents 与 Remote events；Controller 额外获得 prompt、cancel、queue、rename、fork、handoff、model selection 与 interaction answer。Carrier 与 Remote Approval 都默认独立禁用。

当前端到端为 `BROKEN / E4`：base Cordis patch 不可解析；Android unary/stream envelope 不符合 `remoteRequest()`；Apple 将无 `value` 的成功 void RPC 判为无效；两端 Approval frame 错误；fresh pairing 后 ViewModel 仍持有 unpaired wire。风险是 fake-server test 绿色而真实 Host 拒绝客户端。建议由单一 Contract owner 完成 `FIX` 后再扩展 surface。

## 12. Native 进展

Apple Remote Core/Companion 为 `PARTIAL / E2`；fresh pairing 和 Approval 损坏。Android Companion 为 `BROKEN / E2`；Host envelope、Approval、wire ownership 和 TLS pinning 不正确。Apple/Android Lite 为 `SKELETON / E2`，均未进入产品 App composition。macOS Direct Host 为 `SKELETON / E1`，没有 Harness sidecar lifecycle。

当前 HEAD 的 Android workflow 与最新相关 Apple workflow 都通过，但只证明各自实现和 fake/local server，不能证明真实 Host 互操作。

Relay 为 `SKELETON`，本地 Push vocabulary 为 `PARTIAL`，APNs/FCM 为 `MISSING`。`node apps/relay/selftest.mjs` 通过；服务有 in-memory single-account forwarding、presence、polling/streaming 和 Noise framing，但无生产 account auth、durable state、APNs/FCM provider、deploy workflow、Host authority integration 或 operational storage。建议 `INVESTIGATE` 产品授权，并 `DEFER` 继续扩展。

## 13. PoC-2 至 PoC-7 状态

| PoC | 状态 | 证据 | 已通过 | 部分成立 | 缺失或损坏 | 阻断项 |
|---|---|---:|---|---|---|---|
| PoC-1 当前项目核验 | `PARTIAL` | E4 | Host architecture/build/release graph | core tests 多数通过 | base YAML 与 Gateway tests 为红 | 恢复可运行 composition |
| PoC-2 Remote Vertical Slice | `BROKEN` | E4 | Host/TS、pairing/auth/allowlist | source 覆盖多数 verb | E2E 无法启动；Android wire/fresh-pair 损坏 | 统一 envelope + cross-language E2E |
| PoC-3 Multi-device Approval | `BROKEN` | E2 | Host first-valid-wins/no-op/cancel | roles 与 switch | Native event/result 错误 | Host client id 与 waterfall Contract |
| PoC-4 Recovery | `PARTIAL` | E2/E3 | Host recovery；Apple snapshot replacement | Apple auto-resubscribe | Android 失败后停止 | disconnect/reconnect corpus |
| PoC-5 iPhone Remote | `PARTIAL` | E2 | Swift package/target/core/UI | simulator、Keychain/pinning | 无 camera/真实 lifecycle；pair/Approval 损坏 | 修复后真实 iPhone 验收 |
| PoC-6 macOS Full Host | `SKELETON` | E1 | SwiftUI target | empty-state UI | 无 sidecar/lifecycle/signing | Runtime 集成未开始 |
| PoC-7 Native Lite Apple | `SKELETON` | E2 | fold/loop/provider/store/UI | tests/fixtures | 未进入产品 App | App composition |
| PoC-7 Native Lite Android | `SKELETON` | E2/E3 | 等价 source；Android CI 绿 | types/tests | screen/executor/store 未组合 | App composition |

### PoC-2 分步结论

| 步骤 | 结论 | 当前证据 |
|---|---|---|
| Pair | `FAIL` | shipped composition 在配对前因 YAML 失败；isolated tests 通过 |
| Connect | `FAIL` | E2E 无法启动；两端 fresh-pair 后保留 stale wire |
| Host Describe | `PARTIAL` | Host/TS/Apple source 存在；Android envelope 不兼容 |
| Session List/Open | `PARTIAL` | Host/Native source 存在；无真实 Swift/Kotlin-to-Host acceptance |
| History | `PARTIAL` | Host history test 通过；未执行跨语言路径 |
| Follow | `PARTIAL` | Host recovery 存在；Apple 用 snapshot，Android 失败后停止 |
| Prompt/Streaming | `PARTIAL` | source/tests 存在；Android envelope/reconnect 损坏 |
| Approval | `FAIL` | 两端未实现 Host ready/waterfall/result protocol |
| Cancel | `PARTIAL` | source 存在；无真实 Native acceptance |
| Reconnect | `PARTIAL` | TS 可恢复；Apple 重订阅；Android 不恢复 |

### PoC-3 断言结论

| 断言 | 结论 | 当前证据 |
|---|---|---|
| Desktop UI 看见 interaction | `PARTIAL` | UI 存在；shipped composition 不可运行 |
| Remote Client A/B 看见 interaction | `FAIL` | Native projection 与 Host frame 不匹配；无双客户端 run |
| Controller approve | `FAIL` | Native result/client identity 不兼容 |
| Observer denied | `PASS` | 聚焦 carrier authorization test 通过 |
| First valid answer wins | `PARTIAL` | Host 实现存在；聚焦文件 setup 失败 |
| 第二客户端收敛且无重复副作用 | `PARTIAL` | Host cancel/no-op 存在；无跨语言验收 |
| Unauthorized rejected | `PASS` | unknown/stale/mis-signed/revoked/insufficient-role 均被拒绝 |

### PoC-4 恢复结论

| 恢复条件 | 结论 | 当前证据 |
|---|---|---|
| 启动 active shipped Session | `NOT TESTABLE` | base composition 不可解析 |
| Remote 断开而 Host 继续 | `NOT TESTABLE` | 无端到端 Native run |
| Host 保持权威 | `PASS` | 只有一个 Host Session authority |
| Apple reconnect | `PARTIAL` | 自动重订阅并替换 snapshot；无 cursor resume |
| Android reconnect | `FAIL` | follow 失败后终止 |
| silent loss/permanent gap = 0 | `NOT TESTABLE` | 无真实重连验收 |
| duplicate-safe | `PARTIAL` | Host handling 存在；Native corpus 不完整 |
| final projection correct | `NOT TESTABLE` | 无真实网络恢复 run |

## 14. 开发工作流

`dev` 跟踪 `origin/dev`，默认分支为 `master`；两者严重分叉。PR 模板要求 Issue、摘要与验证；Issue policy 验证类型和标签；未找到 `CODEOWNERS`。`AGENTS.md` 要求 focused tests、非平凡变更的 Agent Note、可见变更 snapshot 与 docs/JSDoc。Lefthook pre-commit 检查翻译配对、notes、lint/fix、notices、空白和 vendor scope，pre-push 只运行 typecheck。状态为 `PARTIAL / E2`，外部 protection/review 为 `UNKNOWN`。

## 15. 测试现状

| 类型 | CI 关系 | 最新核验结果 |
|---|---|---|
| Unit/regression | coverage lane 执行多数 specs | 未跑 full suite |
| Coverage | Linux stable verdict，per-file 100% | 当前 HEAD 无 run |
| Integration/Contract | blocking lanes | 148 pass，14 setup fail |
| Native Contract freshness | static/drift | PASS，使用宿主 workaround |
| Carrier E2E | 仓库测试清单 | FAIL：base YAML |
| Snapshot/Web/built smoke | stable consumer verdict | 本地未运行；当前 dev 无 CI |
| Node/Python | stable verdict | 当前 dev 无 CI |
| Windows | mixed blocking | Python-builder 仍有 2 个 assertion 失败 |
| Apple | 独立 path workflow | 相关提交 PASS |
| Android | 独立 path workflow | 当前 HEAD PASS |
| Real API/perf | trusted/manual | 未执行 |
| Real device/store | 缺失 | `MISSING` |
| 文档 quick/full | PR gates | 15/15 PASS；full 24/32 |

测试存在与强制发布门禁并不等价；Apple/Android/release 是否 required 取决于匿名访问无法读取的外部 branch protection。

## 16. CI 现状

PR pipeline 包含 static/documentation、partitioned per-file coverage、official build、built invariants、snapshots/expected/browser snapshots、packed/built consumer checks、Node compatibility、Python、Wine/Windows 与 `all checks passed` aggregate。Apple、Android、Landlock、release rehearsal、real-API E2E、sandbox、Cloudflare preview、issue policy/lifecycle 为独立 workflow。普通 `dev` push 无通用 Node CI，仅运行 path-filtered Apple/Android。

状态为 `PARTIAL / E4`。当前 HEAD 只有 Android run；本地完整文档门禁为红。非环境失败包括 9 个未分类 public signature type、过期 Cordis inspect/config catalog、2 个缺 `@returns` 的 exported function、缺 Artifact subsystem link、过期 TypeScript paths；symlink 失败另归宿主限制。

### Workflow 清单

| Workflow | Trigger | Runner/platform | Inputs/secrets | Outputs | Blocking 情况 |
|---|---|---|---|---|---|
| Android Kotlin | PR、path push、manual | Ubuntu/JDK17/Gradle8.14 | 无 | tests、debug APK build，不上传 | 外部 `UNKNOWN` |
| Apple Swift | PR、path push、manual | `macos-latest` | 无 | Swift tests、3 个 Xcode builds，不上传 | 外部 `UNKNOWN` |
| Build single-exe | reusable/manual | Linux/macOS/Windows matrix | targets、mode、可选 key | executables/wheels/checksums | parent 要求时 blocking |
| Build PR preview | PR | self-hosted Ubuntu | Cloudflare/GitHub credentials | preview/comment | 非 stable verdict |
| CI master | master/manual | self-hosted 与 hosted matrix | suite selector | check results | 仅 master |
| CI | PR | Ubuntu/Windows/macOS | 可选 trusted key | check results | 内部 aggregate blocking |
| Deploy documentation | manual | Ubuntu | 无 | Pages artifact/deploy | 非 PR |
| E2E E2B / real API / pi-ai | manual/trusted/schedule | Ubuntu | 相应 provider key | test result | stable aggregate 外 |
| Expected filenames / Issue policy | PR | Ubuntu | 无 | check result | 外部 `UNKNOWN` |
| Issue lifecycle | issue/PR events | Ubuntu | GitHub App key | labels/project mutations | 非 code gate |
| Landlock Run | PR/path/manual | Ubuntu/macOS | 无 | build/test | 外部 `UNKNOWN` |
| Landlock Release | manual | platform matrix | publish；npm token | prebuild/tarball，7 天 | environment gate |
| Release Python | manual | Ubuntu/platform build | publish；GitHub OIDC | wheels/runtime/checksums，7 天 | environment gate |
| Release publish dsh/vendor | manual | Ubuntu 24.04 | npm token | registry publication | protected publish |
| Release dsh/vendor | PR/master/manual | Ubuntu 24.04 | 无 | rehearsal tarball，7 天 | 外部 `UNKNOWN` |
| Sandbox | master | OS matrix | 无 | test result | 不阻断 PR |
| GitLab Python | `python-v*` tag | GitLab platform runners | `CI_JOB_TOKEN` | wheels/registry publish | 独立于 GitHub verdict |

## 17. 构建现状

官方 build 执行 Host TypeScript/project-reference compile 与 tsdown bundle、Client compile/bundle、Vite production Web build，并记录 version、commit、public values 与 220 个 client artifacts。当前结果为 `VERIFIED / E3`，但 build 不加载 shipped Cordis YAML，因此 Runtime 损坏时仍可成功。Apple/Android workflow 只构建测试或 debug 目标，不产出 release App artifact。

## 18. 产物现状

| 产物 | 当前事实 |
|---|---|
| npm dsh/vendor | PR/master rehearsal；保留 7 天 |
| Python SDK/runtime | wheels/single-exe、SHA256SUMS；保留 7 天 |
| Landlock launcher | Linux prebuild/npm tarball；保留 7 天 |
| Windows App | 本地 NSIS/portable；历史 ignored 产物无当前 SHA |
| Apple Apps | 无 archive/IPA/DMG/PKG upload |
| Android App | 构建 debug APK 但不上传；无 AAB/signing |
| symbols/maps/SBOM/provenance | 无完整跨平台 release set |

Packages 为 `PARTIAL / E3`；Native Apps 为 `MISSING` 或 `PARTIAL / E2`。

## 19. Windows 交付

Tray、autostart、single-instance、`dsh:` scheme 与 Runtime lifecycle 存在。`scripts/build-desktop-exe.ts` 配置 NSIS/portable、`publish: null`、`signAndEditExecutable: false`，并禁用证书自动发现。Build 为 `VERIFIED / E3`；Package 为 `PARTIAL / E2`；Sign 为 `MISSING / E2`；distribution/update/crash/support/rollback 为 `MISSING / E0`。历史 `dist-desktop` 仅是 `STALE` 证据。

## 20. macOS 交付

Companion source 与 macOS shell 存在；Direct Host 只是声明 Runtime 未嵌入的 empty-state shell。Sidecar、spawn、local carrier、health、restart、runtime logging、entitlements、Hardened Runtime、Developer ID、notarization、staple、DMG/PKG 与分发均缺失。Companion `PARTIAL / E2`；Direct Host `SKELETON / E1`；交付 `MISSING / E0`。

## 21. Apple 移动端交付

iOS/iPadOS target、simulator workflow、生成式 Contract、Remote Core、CompanionUI、Keychain abstraction 与 URLSession pinning 存在。Camera QR、真实设备/lifecycle、marketing/build version、signing/provisioning、entitlements、privacy manifest、Required Reason API inventory、archive/IPA、TestFlight、App Store Connect 与 phased release 缺失。Source 为 `PARTIAL / E2`，交付为 `MISSING / E0`。

## 22. Android 交付

Kotlin core、Compose App、Java17/Gradle8.14 CI、tests 与 debug APK assembly 存在，当前 workflow 通过。App 为 `versionName 0.1.0` / `versionCode 1`，与仓库 `0.1.2-alpha.1` 不同；无 committed wrapper、release build/signing、AAB、R8 mapping、Play track、staged rollout 或 Data Safety workflow。Build 为 `PARTIAL / E3`，release delivery 为 `MISSING / E0`。

## 23. 版本 / Channel

dsh npm family 共用版本和 `dsh-v*` tag；prerelease 使用 npm `next`，Python 使用独立 `python-v*` 与 OIDC。Session format 为 version 0，无兼容承诺；SQLite schema 为 19。Native App 版本不统一：repository/Windows 为 `0.1.2-alpha.1`，Android 为 `0.1.0`，Apple 无明确 marketing/build version。Package channel 为 `PARTIAL / E2`；Native product channel 为 `MISSING / E0`。

## 24. Secret 管理

Provider credential 只注入 trusted/manual E2E；npm `NPM_TOKEN` 只进入 environment-gated publish；PyPI 使用 GitHub OIDC；GitLab 使用 `CI_JOB_TOKEN`；未找到平台 signing workflow。未发现 tracked `.env`、PEM、P12、JKS 或 service-account key。Rotation owner 与 environment reviewer 为 `UNKNOWN`，npm 仍使用长期 token。状态为 `PARTIAL / E2`。

## 25. 供应链安全

已有 frozen lockfile、默认拒绝 lifecycle script 的 reviewed allowlist、Dependabot、license/notices/publint/runtime-closure/packed-install、registry integrity、Python SHA256SUMS、Node checksum 与 PyPI OIDC。缺失 immutable Action SHA、dependency review、CodeQL/SAST、secret-scanning workflow、SBOM、cosign/SLSA、npm provenance 与 Native App provenance；Python attestation 明确禁用。状态为 `PARTIAL / E2`，成熟度 L3。

## 26. Telemetry / Observability

Base bundle 加载 OTel logs backend，默认 `FEEDBACK_ONLY`；`DSH_TELEMETRY_MODE` 支持 FULL/DISABLED，非空 `DSH_TELEMETRY_DISABLED` 为 hard opt-out，CI 禁用 telemetry。Pipeline 可含 session id、event、service version、anonymous identity、agent/turn/step 与 error；shipped base 无 redaction rule，可能导出 message、tool arguments/results、system prompt 与 workspace path。无生产 metrics backend、dashboard、alert 或 release-health view。状态为 `PARTIAL / E2`。

## 27. Crash / Diagnostics / Support

Runtime invariant 与 Session recovery 不是 crash reporting。Sentry/Crashlytics、minidump、dSYM/source-map、ANR、release health、diagnostics export、connection diagnostics、support bundle 与自动脱敏均缺失。Runtime diagnostics 为 `PARTIAL / E2`；Crash 与 Support bundle 为 `MISSING / E0`。

## 28. Feature Flag / Kill Switch

已有 telemetry hard opt-out、runtime-invariant filter、CI failover、Python release switch，以及默认禁用 remote access/approval。无集中 dynamic config、staged rollout 或 security kill switch。状态为 `PARTIAL / E2`。

## 29. Migration

`SESSION_FORMAT_VERSION=0` 无通用兼容承诺，未知 version/event 与 corruption fail closed。SQLite schema 19 拒绝不兼容 identity，不迁移任意旧数据库。JSONL-to-SQLite 有一次性 cutover。无通用 backup/restore、forward migration、downgrade、device trust 或 Native storage migration。状态为 `PARTIAL / E2`。

## 30. Compatibility

Node 22.19/24/26、Python、glibc、macOS deployment target 有自动检查，Link DTO/fixture 有 drift gate。无 old/new Host-client、N/N-1、protocol/Contract mismatch 或 production-shaped Native compatibility matrix。状态：runtime/toolchain `VERIFIED / E2`；product protocol/data `PARTIAL / E2`。

## 31. Rollback / Incident

npm/PyPI registry integrity 不是应用回滚。无 updater/data/feature/Remote kill switch/signed App rollback，当前只能手工发布新版本。已有 postmortem 与 CI failover guidance，但无 Incident Commander、on-call、severity policy 或 rollback runbook。Rollback 为 `MISSING / E0`；Incident 为 `PARTIAL / E0`，成熟度 L1。

## 32. 发布治理

已有 family version、tag prefix、environment-gated publish、serialization、official build record、deterministic package order、packed-install smoke 与 registry integrity。缺少 Release Owner/Captain、QA/Security owner、checklist、Go/No-Go、release notes、hotfix policy、Native approval 与 production rollback。`release:bump` 不强制 clean branch/index，publish validation 未证明 tag commit 是 `master` ancestor。所有者为 `OWNER NOT DEFINED`。

Feature DoD 与 Release DoD 均为 `PARTIAL / E2`；Native App delivery、telemetry/privacy、crash、signing、release notes、signoff、update、support 与 rollback 未形成完整闭环。

## 33. 已核验的现有能力

- `KEEP` 单一 Cordis business runtime、Session authority、Typert Gateway、Domain Controllers、Journal/persistence、Projection 与 Host approval owner。
- `KEEP` browser-only local trust、Remote Link carrier 分离、明确 allowlist、device identity、revocation、roles 与独立 Remote Approval switch。
- `KEEP` 生成式 Swift/Kotlin DTO、fixture、conformance input、freshness check、官方 build record 与 npm/Python release graph。
- `KEEP` Electron tray/autostart/single-instance/local scheme 架构。

## 34. 自 2026-08-30 新增的实现

- Remote Link、Link controller/settings、Device Trust 与 desktop pairing/device UI。
- Link manifest、Swift/Kotlin model、fixture、domain/Lite conformance data。
- Apple Remote Core、CompanionUI、平台 shell 与 Lite；Android Link core、Compose Companion、Keystore、projection 与 Lite。
- Remote files、diff、artifact、subagent、Handoff vocabulary、macOS Direct Host skeleton、本地 push hook、Relay/Noise reference。

这些是代码存在性，不代表 production readiness。

## 35. 缺失 / 部分能力

- 统一 carrier/Remote Event Contract、可运行 base composition、通过的 Gateway stream composition、真实 Host-to-Swift/Kotlin acceptance。
- Native fresh-pair ownership、正确 Approval、Android pinning/reconnect、resource-scoped authorization、camera QR 与真实 lifecycle。
- product-composed Lite、macOS Full Host sidecar、signed App artifact、flight/store、updater、staged rollout。
- Crash、support bundle、脱敏可观测性、通用 migration、compatibility matrix、rollback 与 incident governance。

## 36. 过时 / 错误的旧假设

| 2026-08-30 说法 | 当前结论 |
|---|---|
| Pairing/Device Trust/roles 缺失 | `STALE`；实现存在，但 fresh-pair ownership 损坏 |
| Remote allowlist/auth 缺失 | `STALE`；已有 allowlist/role/signature，scope 不完整 |
| Push/Relay 仅属于未来 | `STALE`；本地 hook 与 reference Relay 已存在，生产服务缺失 |
| Native/Swift/Kotlin 不存在 | `OBSOLETE` |
| macOS Host 不存在 | `PARTIAL`；已有 skeleton，无 Full Host |
| Lite 仅属于未来 | `STALE`；isolated implementation 已存在 |
| `apps/apple` shell 不存在 | Apple README 为 `STALE`；shell/workflow 已存在 |
| PoC-1 完成 | 当前为 `PARTIAL`，Runtime/tests 为红 |
| 只剩多设备层 | `OBSOLETE`；交付、互操作、恢复与集成成为主要缺口 |

## 37. 当前端到端交付流程

```text
开发 PARTIAL → 测试设计强但当前聚焦为红 → CI 设计强但 dev 无通用 run
→ 官方 build VERIFIED → npm/Python packaging 较成熟，Native Apps 弱
→ Native signing/artifact/Beta/store/update/crash/rollback MISSING
→ telemetry PARTIAL → incident PARTIAL/手工
```

## 38. 平台交付矩阵

| 能力 | Windows | macOS | iOS/iPadOS | Android |
|---|---|---|---|---|
| Source | `VERIFIED / E2` | Companion `PARTIAL`；Host `SKELETON` | `PARTIAL / E2` | Remote `BROKEN`；Lite `SKELETON` |
| Build | `VERIFIED / E3` | `PARTIAL / E3` | simulator `PARTIAL / E3` | current CI `PARTIAL / E3` |
| Package | NSIS/portable `PARTIAL` | `MISSING` | `MISSING` | debug APK `PARTIAL` |
| Sign | `MISSING`，已禁用 | `MISSING` | `MISSING` | `MISSING` |
| Artifact/Beta/Store/Update/Rollout/Crash/Support/Rollback | 均缺失或历史 `STALE` | `MISSING` | `MISSING` | `MISSING` |
| Telemetry | 共享 Harness `PARTIAL` | platform `MISSING` | `MISSING` | `MISSING` |

## 39. PoC 状态矩阵

| PoC | 状态 | Evidence Level | 已通过 | 部分成立 | 缺失 | 阻断项 |
|---|---|---:|---|---|---|---|
| PoC-1 | `PARTIAL` | E4 | architecture/build | 当前核验 | runnable composition | YAML/test regressions |
| PoC-2 | `BROKEN` | E4 | Host/TS substrate | broad source | working Native slice | Contract/client defects |
| PoC-3 | `BROKEN` | E2 | Host race semantics | roles/switch | Native protocol | event Contract |
| PoC-4 | `PARTIAL` | E3 | Host recovery | Apple snapshot restart | Android reconnect | cross-platform corpus |
| PoC-5 | `PARTIAL` | E2 | Apple source/targets | simulator | real device/correct pair | client ownership |
| PoC-6 | `SKELETON` | E1 | target shell | workflow build | sidecar/delivery | runtime absent |
| PoC-7 | `SKELETON` | E2/E3 | isolated Apple/Android | tests/fixtures | product composition | App ownership |

## 40. 交付成熟度矩阵

| 表面 | 等级 | Ground Truth |
|---|---:|---|
| Development/Testing | L3 | controls 成熟；当前 focused red，外部 protection 未知 |
| CI/Build | CI 设计 L4、当前 SHA L2；Build L4 | aggregate 存在；dev 无通用 run；official build 通过 |
| Contract/Security | L3 / 当前产品 L2 | 生成文件 fresh，但 event 不完整；pinning/scope/privacy 有缺口 |
| Supply Chain | L3 | 有 lock/allowlist/checks；无 SBOM/attestation/SAST |
| Packaging/Signing | packages L3、Apps L1；signing L0 | Native Apps 弱且未签名 |
| Beta/Store/Updater/Crash | L0 | 缺失 |
| Telemetry/Diagnostics | transport L3、privacy L1；diagnostics L2 | OTel 存在；无脱敏、ops 与 export |
| Migration/Compatibility | L2 | fail-closed 与 runtime matrix；无产品 N/N-1 |
| Rollback/Incident | L1 | 只能新发版本；治理碎片化 |
| Release Governance | L2 | tags/environments 存在；owner/checklist 缺失 |

## 41. 架构不变量风险

- 关键 carrier/event 语义仍在 Swift/Kotlin 手写，单一业务 Contract 存在风险。
- Android 记录 pin 却不执行，形成误导性安全状态。
- Fresh-pair 后 stale wire 留在 ViewModel，破坏单一 Runtime view。
- Lite Handoff UI 可能在未调用 sender 时声称 Host 已继续。
- Relay/Noise 超出旧 Phase 顺序；进一步扩展仍需产品授权。当前 reference 仍保留 Host Session authority。
- 良好不变量仍保持：单一 Host Session authority、无第二业务 Gateway、本地/远程 carrier 分离、无 mobile Full Node runtime、无 Windows/Harness Core 重写。

## 42. P0 / P1 / P2 / P3

### P0 — 阻断项

- `FIX` `packages/bundle/base/cordis.patch.yml:122` 与 Gateway stream test composition/injection。
- `FIX` 7 类仓库 `doc-sync` drift；symlink 权限继续归为宿主限制。
- `EXTEND` 统一 Link Contract，纳入 unary/stream envelope 与完整 Remote Event state machine，再 `FIX` 两端 client。
- `FIX` Apple/Android fresh-pair ownership、Remote Approval、Android TLS pinning 与自动 reconnect。
- `EXTEND` 最小 Session/Workspace/Interaction/Resource scope。
- Beta 前 `FIX` telemetry consent/redaction，否则保持默认禁用。
- 选择对齐的 release-candidate SHA，解决 `dev/master` 版本分叉，运行 required CI，并授权核验 branch protection。

### P1 — Beta / GA 前必须完成

- 已签名 Windows/macOS/iOS/Android artifact 与 commit/version 绑定；TestFlight/Play/internal distribution。
- Crash、diagnostics/support bundle、安全脱敏、Native updater/rollback/migration/backup。
- Immutable Action SHA、dependency review/SAST/secret scanning 与 npm credential ownership。
- Release Owner、QA/Security signoff、checklist、Go/No-Go、release notes、hotfix policy。

### P2 — 产品化

- Camera QR、真实设备 lifecycle、长期 artifact retention、SBOM/provenance、dashboard/alert。
- Staged rollout、窄范围 kill switch、store metadata/privacy declaration/support operations。

### P3 — 未来事项

- Remote MVP 证据与产品范围明确前，`DEFER` 进一步 Relay/public Internet。
- `DEFER` interactive PTY、复杂 RBAC、替代 transport、完整 mobile runtime、repository sync 与架构重写。

## 43. 建议的 KEEP / EXTEND / ADD / DEFER / REMOVE

| 动作 | 对象 |
|---|---|
| `KEEP` | Gateway/Controller/Session/Projection/Interaction owner |
| `KEEP` | carrier 分离、Remote allowlist、device trust、remote-off-by-default |
| `KEEP` | 生成式 DTO/fixture pipeline 与 release build record |
| `FIX` | base YAML、Gateway injection、Native event/envelope、fresh-pair、Android pinning/reconnect、错误 Handoff 状态 |
| `EXTEND` | 统一 transport/event Contract、resource scope、真实 Host conformance、diagnostics、compatibility |
| `ADD` | signed Native App release/flight/update/crash/support/rollback owner |
| `INVESTIGATE` | GitHub protection、environment reviewer 与 required workflow set |
| `DEFER` | 生产 Relay、advanced transport、PTY、复杂企业 policy、Handoff L2 |
| `REMOVE` | 当前无能力具有足够移除证据；不能只因 Relay 提前实现就删除 |

## 44. 最终 Ground Truth

本节已合并原独立 `CURRENT_GROUND_TRUTH.md`；最终只保留本报告一个 Markdown 文件。

### 架构与已核验事实

- 一个 Cordis business runtime、一个 Typert Gateway、一个权威 Session owner 保持完整；Native access 是 TLS/device carrier 加 allowlist/authorization，不是第二业务 Gateway。
- 当前官方 Host/Client/Web build 通过并记录 220 个 client artifacts；Link manifest、Swift/Kotlin DTO、fixture、domain/Lite conformance 均 fresh。
- Device Trust、一次性 pairing、revocation、roles、endpoint allowlist、request signature、独立 Remote Approval switch 已存在。
- dsh/vendor release graph、当前 Android workflow、最新相关 Apple workflow 与 Relay self-test 通过。

### 部分成立与损坏

- Host Gateway、Journal recovery、Projection、multi-client approval 基础存在，但 Gateway stream tests setup 失败。
- Native authorization 缺少完整 resource scope；Apple 以 snapshot 恢复但无 cursor resume；Android 不自动恢复 follow。
- `packages/bundle/base/cordis.patch.yml:122` 为无效 YAML，shipped Link E2E 无法启动。
- Android envelope 不符合 Host `{ payload: { args } }`；两端 Approval 未实现 Host `ready/clientId` 与 waterfall request/result；fresh pairing 后均保留 stale wire。
- Android SPKI pin 未执行；Lite Handoff 可在未调用 sender 时报告 continuation。
- `doc-sync` 有 7 类真实漂移与 1 个宿主 symlink 权限问题；普通 `dev` push 无通用 Node CI，required checks 为 `UNKNOWN`。

### 缺失

- 真实 Host-to-Swift/Kotlin acceptance、真实设备 Remote recovery、camera QR、生产 Lite composition、macOS Full Host sidecar。
- Signed Native App artifact、TestFlight/Play/internal distribution、updater、staged rollout、crash、support bundle、rollback。
- 产品 migration/N/N-1 policy、Release Owner、QA/Security signoff、checklist、Go/No-Go 与 incident governance。

### 平台、PoC 与阻断结论

- Windows 有 Electron/NSIS 基础但 signing 明确禁用；macOS Direct Host 无 sidecar/signing；iOS fresh-pair/Approval 与交付缺失；Android envelope/Approval/pairing/pinning/reconnect 损坏且只有 debug APK。
- PoC-1 `PARTIAL`；PoC-2、PoC-3 `BROKEN`；PoC-4、PoC-5 `PARTIAL`；PoC-6、PoC-7 `SKELETON`。
- 必须先修 base YAML、Gateway composition、`doc-sync`、统一 Contract、两端 Native client、Android pinning/resource scope，并选定 release-candidate SHA、获得真实 required CI、闭环 telemetry privacy。

### 不要重建与下一门禁

- 不要重建 Gateway、Session domain、Approval registry、Projection、browser trust 或 Windows desktop architecture；不要增加第二 Gateway、第二 Session authority、CRDT、mobile Full Node runtime 或架构重写。
- 下一工程门禁应收敛为单 Agent、Contract-owned 深度修复：先修 shipped composition 与跨语言 wire 语义，再做真实 Host acceptance 与 release-candidate delivery check。在此之前不继续扩展 Relay 或后续 PoC。

最终结论：仓库已从架构规划进入大规模但内部不一致的实现阶段。Host 基础与工程 build/release substrate 可复用；当前 HEAD 的 Native Remote 产品不可运行，因为 shipped composition、生成式协议覆盖、Native client 与平台交付均未满足自身验收路径。下一逻辑工程门禁不是继续增加功能，而是一次 Contract-owned 修复与跨语言验收，随后进行 release-candidate 与交付核验。
