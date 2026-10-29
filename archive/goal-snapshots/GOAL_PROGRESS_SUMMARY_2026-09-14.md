# DeepSeek Harness 初始完整目标与当前进度总结

快照日期：2026-09-14，Asia/Hong_Kong。本文是按用户要求整理的单份中文目标与进度报告，覆盖原始全平台原生化目标、后续 Gate 1–4 验收范围、已经取得的实现与验证结果，以及尚未完成的事项。本文不提出上游整合、技术替换或后续实施方案。

**当前整体状态：原目标尚未完成。Gate 1 已在指定历史候选上验收关闭；Gate 2 已完成多项实现和局部平台验收，但整体仍为 `PARTIAL / IN_PROGRESS`；Gate 3、Gate 4 尚未完成阶段验收。最新本地实现已推进到 Session SQLite 迁移与恢复，未发布到现有 draft PR。**

用户提供的新背景是：上游已经推出官方 macOS、Windows 应用，并已将最新代码同步到本项目本地 `master`。本次确认 `master` 包含三种正式桌面构建目标及相应运行、签名、公证、更新代码；这些事实单列于第 12 节，不据此把原目标的桌面、移动端或跨端要求自动改判为完成。

## 目录

- [1. 资料范围与状态口径](#1-资料范围与状态口径)
- [2. 初始完整产品目标](#2-初始完整产品目标)
- [3. 原阶段划分与接续验收目标](#3-原阶段划分与接续验收目标)
- [4. 已完成的 Gate 1 正确性基线](#4-已完成的-gate-1-正确性基线)
- [5. 各平台的当前进度](#5-各平台的当前进度)
- [6. 诊断与 Support Bundle](#6-诊断与-support-bundle)
- [7. Contract 与跨候选兼容性](#7-contract-与跨候选兼容性)
- [8. 存储版本迁移与恢复](#8-存储版本迁移与恢复)
- [9. 发布工程安全与治理状态](#9-发布工程安全与治理状态)
- [10. 进行中与未完成事项总表](#10-进行中与未完成事项总表)
- [11. 提交工作树与远端交付状态](#11-提交工作树与远端交付状态)
- [12. 上游官方桌面应用与本地-master-事实](#12-上游官方桌面应用与本地-master-事实)
- [13. 原报告遗留事项的当前校正](#13-原报告遗留事项的当前校正)
- [14. 证据索引与本报告核验范围](#14-证据索引与本报告核验范围)

## 1. 资料范围与状态口径

### 1.1 本报告使用的资料

| 资料 | 用途 | 使用限制 |
|---|---|---|
| [原始研究报告][research]，其中附录第 0–85 章为全平台原生化方案 | 还原初始目标、平台角色、功能边界、PoC、Phase 和验收要求 | 2026-09-01 的完成标注属于旧快照，不能作为当前验收结果 |
| [2026-09-05 起持续追加的交接文档][handoff] | 还原 Goal 接续范围、Gate 1–4、历史提交及平台验证 | 顶部更新较新，后半部表格和文末结论存在滞后 |
| [Gate 1 总回执][gate1]、[Gate 2 证据目录][gate2] | 核对机器状态、来源 SHA、实际执行与未完成条件 | 不同 owner JSON 和子记录可能绑定不同提交 |
| [最新 release/checklist.json][checklist] | 核对发布基础阶段 16 项工程要求和 6 项生产外部动作 | 清单存在不代表全部验收通过 |
| 独立工作树中的提交、审阅回执、测试回执 | 纳入交接后半部尚未反映的最新实现 | 本地提交、编译、真实平台执行分别记录 |
| 本地 `master` 的 Git 对象 | 记录上游桌面代码当前事实 | 未下载或安装上游正式发行包，未核验线上 Release 状态 |

原研究报告在交接中记录的路径为 `E:/11585/deepseek-harness-首轮改造完成后的升级优化版deep-research-report.md`；本次在该路径未找到文件，实际读取的是 `E:/11585/工作相关/deepseek-harness-首轮改造完成后的升级优化版deep-research-report.md`。

**交接存在一处明确滞后：**最新 Session SQLite 提交 `16482eec880f40bb472c9328acf5a8819bc988f9` 及总回执已经生成，交接和 `G2-MIG.json` 的回写候选尚未应用。本文直接依据实际提交及 [Session 验证回执][session] 纳入该进展，不沿用“Session 迁移尚未实现”的旧结论，也不声称回写已经完成。

### 1.2 完成状态的含义

| 本文用语 | 对应状态 | 含义 |
|---|---|---|
| 已完成，限定子范围 | `PASS`、已提交且相关验证通过 | 必须同时指出通过的功能、候选和运行环境；不自动关闭其所属 Gate |
| 进行中、部分完成 | `PARTIAL`、`IN_PROGRESS`、`PARTIAL_BASELINE` | 已有实现或部分证据，完整验收尚未满足；不表示当前仍有测试进程运行 |
| 未完成，已经执行失败 | `FAIL` | 有具体失败回执；与没有执行分开 |
| 未执行 | `NOT_EXECUTED` | 没有对应运行结果，不能推导通过或失败 |
| 未启动阶段验收 | `NOT_STARTED` | 尚未完成该阶段组织和验收；可能存在早期代码或其他阶段产生的基础能力 |
| 环境受限 | `HOST_ENVIRONMENT` | 失败发生在环境准备或运行条件，不自动归为产品失败，也不能转为通过 |
| 用户允许延期 | `SKIPPED_BY_USER` 或 Apple 环境延期处置 | 允许继续独立工作，不等于免除最终证据要求 |
| 生产外部动作未执行 | `MANUAL_EXTERNAL_REQUIRED / NOT_EXECUTED` | 签名身份、商店账户、生产发布等动作与工程准备分开 |
| 明确不属本期 | `DEFER` | 不列为本期遗漏实现 |

证据等级沿用交接：E0 为文档，E1 为接口或骨架，E2 为实现检查，E3 为测试或构建，E4 为实际运行、跨语言或端到端路径。真实 Host 配合测试模型可以证明协议和运行链路，但不能证明真实 DeepSeek API、真实手机或商店发布。

本文没有计算完成百分比。跨提交测试数量不相加成“当前全量通过”；历史候选的成功也不重标为最新本地提交的成功。

## 2. 初始完整产品目标

### 2.1 最终产品定位与平台角色

目标是将 DeepSeek Harness 发展为能够在桌面运行完整智能体、在手机和平板进行原生远程操作与本地轻量运行的产品。统一的是 Harness 业务语义、应用 Contract 和状态模型，各平台可以采用不同语言、运行时和传输方式。

| 平台 | 初始完整目标 | 核心职责 |
|---|---|---|
| Windows | Full Harness Runtime Host，保留既有 Electron 桌面体系 | 完整 Agent、Session、Tool、Workspace、Plugin、Sandbox、LLM；提供跨端访问和设备管理 |
| macOS Companion | SwiftUI 原生 Remote Companion | 连接其他 Full Host，共享 Apple Remote Core 与原生领域 UI；原目标要求不以 WebView 壳代替此 Companion |
| macOS Direct Full Host | SwiftUI App、Host Controller、Sidecar Supervisor、内嵌 Harness Runtime | 在 Mac 本地拥有完整 Runtime Authority；负责启动、健康、停止、重启及原生系统集成，Harness Core 不重写成 Swift |
| iOS | Native Remote Companion + Native Harness Lite | 远程观察和控制桌面 Session，也可在 iPhone 本地运行受限的轻量 Agent |
| iPadOS | 同一 Apple 语义下的 Remote + Lite，专门的大屏交互 | Hosts/Sessions 侧栏、Conversation 主区和 Inspector；键盘、指针、拖拽、多窗口 |
| Android | Kotlin + Jetpack Compose 的 Remote + Lite | 覆盖手机、平板和折叠屏，按 Window Size Class 自适应；不嵌入完整 Node/Cordis |
| 既有 Web/本地入口 | 保持现有能力与语义 | 复用既有 Gateway、Controller 和本地 Carrier，不为 Native 再造一套业务系统 |

原研究报告开头另有一段通用扩展建议，涉及 Linux 桌面、统一账号、SSO、微服务、Redis、Kafka/RabbitMQ、PostgreSQL 集群、Kubernetes、Flutter/React Native、OpenAPI 等。交接第 7 节已明确将与实际项目及上述原生方向冲突的选型移出执行基线。因此，这些建议在本文仅作为资料背景记录，不把它们列为已获确认的本期必交付项，也不把未实现这些选型计为目标欠账。

### 2.2 单一业务语义与运行权威

业务概念继续使用 Session、Agent、Tool、Approval、Question、Plan、Todo、Goal、Artifact、Workspace、Subagent、Capability、Event，不创建平行的 Native Session、Native Tool 或第二套 Approval 注册系统。

每个活动 Session 恰有一个 Runtime Authority。Full Session 的权威在 Windows/macOS Host；远程设备持有投影、缓存和视图状态，不能与 Host 同时向同一个 Session 做权威追加。移动 Lite 有自己的本地 Session，转交 Full Host 时创建新的 Full Session。

Native Remote 路径复用现有业务链：Native Client → 安全 Access Carrier → Remote Assembly/Authorization → 既有 Gateway → Domain Controllers → Full Runtime。Carrier 负责 TLS、设备认证、连接生命周期、帧大小和背压，不拥有 Session、Workspace、Approval 或业务 DTO 注册。

本地和远程 Carrier 可以不同；统一 Contract 不意味着强制统一认证、传输、物理分帧和连接生命周期。Windows 保留既有本地入口；原 macOS Full Host 方案首选 stdio，不同时建设 stdio、UDS、localhost HTTP 三套方案。实际后续 Mac 实现的落点见第 5 节。

### 2.3 原生客户端状态与恢复目标

| 数据类别 | 原始要求 | 恢复含义 |
|---|---|---|
| Journal | Session 时间线和执行历史有序、可分页、带 cursor/sequence、可发现缺口 | 复用既有 follow/page/gap-fill；无静默丢失、重复安全、可重建 |
| Snapshot | Workspace、Queue、Jobs 等当前聚合状态 | 新权威快照替换旧本地基线，不要求重放所有中间快照 |
| Notification | 当前连接代际内的非关键通知 | 遗漏不能破坏业务正确性，重要状态可通过权威接口恢复 |
| Remote Interaction | Approval、Question 等待客户端返回结果的交互 | 维护 pending 状态和收件箱，不只显示一次性 Toast |

断线后的目标路径是重新连接、读取权威历史或状态、去重、重建投影、继续实时观察。移动端后台、进程被杀和冷启动不得中止桌面 Host 的 Agent。没有实测性能证据时，不先引入第二套 Resume Protocol、原子 cursor 订阅、压缩或替代传输。

### 2.4 Contract、能力与跨语言一致性

Contract 由现有 Typert/Gateway/Session/Interaction 等真实 owner 形成唯一来源，生成 Canonical Manifest、JSON Schema、Swift Models、Kotlin Models 和 Golden Fixtures。三端不长期分别手写三份业务 DTO；源变更必须能够被生成漂移检查发现。

能力判断依赖 Host/Runtime 描述，而不是按 Windows、Mac、iPhone、Android 硬编码分支。目标包含 `linkProtocolVersion`、`contractVersion`、`sessionFormatVersion`、`hostVersion`、`runtimeClass` 和 capabilities。新增可选字段可忽略，未知 capability 视为不支持，不兼容主协议必须明确拒绝。

原目标还包含 stable/experimental/internal 稳定度分层、experimental 显式启用、旧新 Host/client 兼容矩阵，以及 Swift/Kotlin/TypeScript 对相同 fixtures 产生一致领域状态。Codex 参考范围是应用与 Runtime 解耦、服务端事件、握手、背压、生成纪律、风险分类和策略模板，不是照搬其业务词汇或嵌入另一套 Core Runtime。

### 2.5 配对、设备信任和授权

V1 网络范围为 LAN 或用户自行维护的 Private Overlay Network。mDNS/Bonjour 用于发现 Host，发现不等于信任，不承诺 NAT 穿透或 Wi-Fi 切换蜂窝后仍能访问家庭 Host。

配对目标是 Host 开启 Remote、生成短时 QR、移动端扫码校验 Host、完成配对并持久化设备凭据。配对数据包含 Host 标识和名称、endpoint、证书/SPKI fingerprint、一次性高熵 nonce、有效期和协议版本；nonce 要求原子消费、过期拒绝和防重放。QR 不包含长期 Host secret、LLM/API credential 或长期设备 bearer token。

Host 维护独立 Device Trust Store，记录设备身份、公钥、角色、授权范围、创建/最近访问/吊销状态；Apple 使用 Keychain，Android 使用 Keystore 支持的安全存储。设备信任与 LLM Provider 凭据分离。

首版角色为 observer、controller、administrator。Remote allowlist 只说明端点可远程开放，每次请求还必须检查 Device Identity、Role、Capability、Session、Workspace、Interaction 和资源路径范围。`Allow Remote Approval` 独立于 Remote Access 和 Prompt 权限。

多个合法 Controller 同时回答一个 pending interaction 时，第一份有效答案获胜，其他客户端收敛到已解决状态，不得产生第二份 Runtime 副作用。审计进入既有 Session/Approval 语义，不创建平行审批域。

### 2.6 Remote 功能完整范围

| 功能组 | 初始目标 |
|---|---|
| Host/Workspace/Session | Host describe、Workspace browse、Session list/open/history/follow，明确会话实际运行位置 |
| 会话控制 | Prompt、Queue、Steer、Cancel/Stop、在授权允许时读取和选择模型 |
| 智能体状态 | Streaming、Plan/Todo/Goal、Tool 状态、Trajectory、Subagent 导航 |
| 人机交互 | Approval、Question、待处理收件箱、多端回答收敛 |
| 输入与产物 | 图片/附件输入、Artifact 浏览与下载、File browse/read/preview、只读 Diff |
| 跨端体验 | Attach、低干预 Follow、多 Host、私网状态提示、可靠重连、Handoff L1 |

Remote 默认不开放凭据值、插件安装/管理、动态插件执行、任意 Host 路径、原生文件选择器、环境变量修改、任意可执行程序启动、不受限制的 Host 配置或本地凭据修改。

文件读取要求工作区授权、规范化、根目录包含检查、路径穿越拒绝、大小上限、MIME、二进制保护及范围读取。Artifact 是一等对象，可表示 Markdown、文本、图像、报告、Patch、测试结果、结构化输出和文件；Journal 只承载引用、元数据和状态，大内容通过独立资源通道读取。Diff 首版包含文件列表、hunk、行号和语法高亮，不包含移动 Patch 编辑器、交互式 Merge 或完整 PR Review。

### 2.7 Native Lite 与 Handoff L1

移动端最终应成为可独立使用的轻量 Agent，而不只是遥控器。Apple 用 Swift、Android 用 Kotlin 实现 Lite，通过共享 Behavior Spec 和 fixtures 保证语义一致，不要求实现代码相同。

Lite P0 包含 LLM Provider、流式输出、Lite Agent Loop、Session、Conversation Context、System Prompt/Persona、静态工具目录、Web Search、URL Fetch、图片和附件输入、Plan、Todo、Artifact、本地历史及 Handoff 检测。工具必须随 App 内置、静态、可审查；原清单包括 `web_search`、`url_fetch`、`image_inspect`、`attachment_read`、`artifact_create`、`calculator`。

原生 UI 应通过统一的 `HarnessRuntime` 面向 `RemoteHostRuntime` 与 `LocalLiteRuntime`，复用领域状态和组件，而不是维护两套独立 Session UI。Lite 不支持的能力显式返回 `requiresFullRuntime`，提供在指定 Host 继续的入口。

Handoff L1 是语义快照交接：Lite Session → `HandoffSnapshot` → 选择 Host → 创建新 Full Session，并记录 origin/provenance。原候选字段包括源 Session、目标、摘要/近期上下文、Plan、Todo、附件、Artifact 引用、模型偏好和所需能力；字段取舍与实际实现分别记录，不能把过程称为运行中 Session 迁移。

### 2.8 原生 UI、生命周期与非功能目标

Apple 目标为 Minimal Neumorphic 与 System Liquid Glass 双风格，共享导航、领域状态、组件层级、交互、权限和同步语义，只切换语义 token、材质、阴影、模糊、层级和动效。代码、Diff、长 Markdown、日志和工具结果要求高可读实体背景。Android 当前只要求 Minimal Neumorphic。

iPhone/iPad/Android 导航覆盖 Hosts、Sessions、Conversation、Plan/Todo/Goal、Tools、Artifacts、Approvals、Settings。iPad 不只是放大手机画面；Android 包含手机、平板和折叠屏适配。还包含相机/通知权限拒绝和回退、后台前台切换、进程死亡恢复、冷启动、键盘遮挡和安全区。

性能目标首先是测量配对、连接、Session 列表、首事件、Journal 分页、重连、快照恢复、原生内存/CPU/电量以及 Mac sidecar 启动，再按实际数据判断优化。安全测试范围含错误证书、MITM、过期/重放配对、吊销、窃取凭据、角色/Session 越权、审批关闭、重复审批、畸形/超长帧和路径穿越。网络测试范围含 Wi-Fi 断连、路由器重连、LAN IP 变化、VPN、高延迟、丢包、连接重置、重复投递和生成中重连。

### 2.9 明确排除与延期的范围

本期不包括第二套业务 Gateway/Session/Approval、CRDT、多 Authority、复杂企业 RBAC/ABAC、全仓同步、Windows WinUI/WPF 重写、移动完整 Node/Cordis、动态可执行插件/Skill、任意 Shell/Subprocess/LSP、移动长期后台 Coding Agent、Lite Subagent、完整 MCP Runtime。

Handoff L2、运行中进程/PTY/Shell/LSP/Plugin 内存迁移、Interactive PTY、First-party Relay、APNs/FCM Remote Wake、WebRTC/QUIC/WireGuard/TURN、自定义 NAT 穿透、替代传输、公网 Continuation 均属重新立项范围。已有自托管 Relay/Noise reference 是历史实现事实，其存在不等于 First-party Relay 已纳入生产路径或完成公网产品验收。

## 3. 原阶段划分与接续验收目标

### 3.1 原 Phase 与 PoC

| 原阶段 | 原始交付内容 | 当前对应进度 |
|---|---|---|
| Phase 1 | Remote Foundation + Windows Host；Carrier、Device Trust、授权、生成器、参考客户端、配对和设备管理 | Gate 1 核心正确性已取得指定候选验收；Windows 产品化仍部分完成 |
| Phase 2 | Apple Remote Companion、共享 Remote Core、领域 UI、双主题 | 已有真实 Swift/Host/模拟器验证；完整视觉、大屏和真机验收未完成 |
| Phase 3 | Apple/Android LocalLiteRuntime，统一 Runtime 门面 | 有实现和行为基线；真实工具执行体、Persona、统一门面及完整产品验收未完成 |
| Phase 4 | macOS Direct Full Host、内嵌 Runtime、生命周期、签名/公证 | 已超出旧报告“只有壳”的状态；运行和重启有实证，no-orphan 和正式发行未完成 |
| Phase 5 | Android Remote Companion、自适应 UI | Kotlin/真实 Host、APK/AAB、部分模拟器验收已完成；最新存储变更原生验收和真机/大屏未完成 |
| Phase 6 | Handoff L1、Follow UX、多 Host、私网 UX | 有 Handoff/Follow 基线，完整产品验收未完成 |

| 原 PoC | 当前证据判断 |
|---|---|
| PoC-1 当前项目核验 | 已完成基线核对，接续又修复了 shipped composition 等实际缺陷 |
| PoC-2 Remote Vertical Slice | TypeScript、Swift、Kotlin 真实 Host 13 步路径已有 E4 |
| PoC-3 Multi-device Approval | 已执行确定性多控制器并发与 Observer 拒绝，3 轮共 9 项通过 |
| PoC-4 Recovery | 双语言已验证断流、Host 离线推进、重连及重复重连投影一致 |
| PoC-5 iPhone Remote | 模拟器首屏和 Swift Host 证据已有；原定义的真实 iPhone 扫码至后台/前台完整路径仍未验收 |
| PoC-6 macOS Full Host | 实际 App/sidecar 生命周期和 UI 已部分通过；Developer ID、公证及完整 no-orphan 未完成 |
| PoC-7 Native Lite | 旧实现和 conformance 基线存在；不能据此认定真实 Web 工具、完整 Lite 产品和设备体验已经交付 |

### 3.2 Goal 接续的四个 Gate

| Gate | 接续目标 | 当前结论 |
|---|---|---|
| Gate 1 / P0 correctness | 修复 composition、Contract、授权、隐私、真实 Remote、并发审批、恢复和必要 CI | `PASS / CLOSED`，只绑定 `906d19359588584ffe154d9abe8aea752e7b743a` |
| Gate 2 / P1 release foundation | 产品标识、渠道、CI/供应链、四平台候选、诊断支持、迁移、兼容、恢复与治理 | `IN_PROGRESS / PARTIAL`，不满足完整 RC 或发布准入 |
| Gate 3 / P2 Beta readiness | 产品 UX、Lite、真机生命周期、发现/配对、多端布局、Beta/商店工程准备 | 阶段验收 `NOT_STARTED`；保留已有基础实现 |
| Gate 4 / GA engineering readiness | 不可变产物晋级、生产签名交接、商店提交包、rollout、事故演练、最终交接 | `NOT_STARTED` |

后续用户授权过候选推送、以 `dev` 为目标的 draft PR，以及重新开启 Swift/Apple 验证；对于只能依赖 macOS/Xcode 且暂时无法取得环境的项目，允许延期并继续独立工作，无须重复询问。用户另外批准了一份精确 SAST 绑定/测试凭据例外补丁。上述动作的实际完成和限制见第 9、11 节。

当前用户把任务调整为先总结目标与进度，因此本轮只做资料核验和本文件整理，没有继续实现、推送、更新 PR、重启原生验证或处理上游整合。

## 4. 已完成的 Gate 1 正确性基线

### 4.1 13 项必要任务

依据 [Gate 1 总回执][gate1]，`status=PASS`、`closure=CLOSED`、`canEnterGate2=true`。这是一份不可变候选的准入事实，不是所有后续提交的全量测试结论。

| 任务 | 已完成内容 | 证据范围 |
|---|---|---|
| G1-RC | 原 dev 基线、隔离 worktree、分叉和候选策略 | 用户原有 dirty 文档得到保留 |
| G1-COMP | 修复 base YAML 和 Connection/WebServer 注入，shipped Host slice 实际启动 | Gateway stream 从 8 pass/14 fail 修复为 22/22；Connection 回归 116/116 |
| G1-DOC | 文档与生成门禁恢复 | Linux `test:docs` 15/15、`doc-sync` 32/32 |
| G1-CONTRACT | unary、NDJSON、事件/取消/结果、错误、sequence/cursor、版本和 capabilities 的唯一来源 | authenticated unary 使用 `{payload:{args}}`，包含 void success 和 structured error |
| G1-GEN | Manifest、JSON Schema、Swift/Kotlin、领域/Lite fixtures 可重复生成 | 二次生成无 tracked drift |
| G1-APPLE | SwiftPM、真实 Host、恢复、Xcode 构建与 iOS 模拟器首屏 | 已有 Apple runner E4，不能继续写成“Swift 从未运行” |
| G1-ANDROID | Kotlin core、真实 Host↔Kotlin、APK 及首屏 | core 125/125、Host 13/13、API 34 instrumentation 1/1 |
| G1-AUTH | 资源级授权、角色、Session/Workspace grant、撤销和审批开关 | 集合/事件过滤、stale generation、重复/越权交互拒绝 |
| G1-PRIV | 遥测默认关闭和白名单投影、匿名标识、ArtifactId/路径隐私 | 未配置时不建立遥测 transport；不导出 prompt、源码、凭据等内容 |
| G1-E2E | 三语言同一真实 Host corpus | pair/connect/describe/list/open/history/follow/prompt/stream/approval/cancel/reconnect/revoke |
| G1-MULTI | 两 Controller 获胜顺序、迟到响应、Observer 拒绝 | 真实 TLS carrier，3 轮共 9 项；每轮只追加一组审批记录 |
| G1-REC | 断流后 Host 继续、客户端恢复和重复恢复 | 双语言观察到离线推进 11 个 sequence，最终投影一致 |
| G1-CI | 必要 CI 与实际源码核验 | 准入候选 `906d193595...`；独立 Windows 历史失败另外保留 |

### 4.2 重要实现语义

Device Trust 的 Session/Workspace grant 随配对事务原子写入。远程调用在进入业务 owner 前检查身份、角色、Session、Workspace、Interaction、Resource 和 Path；Observer mutation、审批关闭、撤销设备等均有拒绝路径。

多控制器审批保留 first-valid-wins：已进入处理的 loser 得到幂等 void success 与一次 cancel，新到达的迟到答案被拒绝；Observer 不得到可回答交互。这些行为经过受控并发验证，不只是从宿主语义推测。

遥测只保留白名单事件类型、sequence、时间、安全整数 turn/step 和固定 severity，Session id 使用私有根种子派生 pseudonym。ArtifactId 在模型输入、wire、durable invariant 和文件提供方入口统一解析。

### 4.3 历史广范围验证记录

| 验证 | 实际结果 | 来源与限制 |
|---|---|---|
| 完整 coverage | 1,022 文件、16,441 测试通过，39 跳过；逐文件四项 100% | `4dded5f0e9...`，Linux Node 22；不是最新本地提交的 coverage |
| coverage-exempt-heavy | 1,157 通过、28 跳过 | `383b1176b8...` 的对应范围 |
| Recorded-session replay | 113/113 | `7752b634d1...`；keyless，没有调用真实模型 API |
| NodeNext consumer | 268 个 workspace declaration APIs | `383b1176b8...` |
| Artifact local 最终复验 | 17/17，单文件四项 100% | `c73daa2c69...` |

这些数字用于说明曾实际完成的工程验证，不替代后续源码变化的定向测试、最新 CI、真机矩阵或发行验收。

## 5. 各平台的当前进度

### 5.1 Windows Full Host

已保留 Electron 体系，新增或接通 Remote Access、QR 配对、设备列表/撤销、Remote Approval 独立开关与 LAN 状态；没有进行 WinUI/WPF 重写。候选生产已覆盖 NSIS installer、portable、版本字段、依赖库存和离线扫描资源。

在已发布历史候选 `fae45bae1f09c59b2dd1a69403f89db2dc3cd355` 上，安装版与 portable 均实际打开 Settings 和 provider form，页面错误数为 0，应用退出码为 0；产品版本为 `0.1.2-alpha.1`。两种形态各实际保存 2,155 字节诊断文件，独立扫描零发现；取消、缺少扫描器、扫描器污染和发现测试秘密时拒绝保存，以及关机时关闭对话框均有通过回执。[Windows 平台证据][windows-native]

最新 Windows 本地提交 `faef020b9afedfafc025d459f1f672650f8f3945` 将应用 commit/tree 与扫描器来源分开绑定，并接入 Support 导出。Linux 初始相关 TypeScript 78 pass/4 skip，Python 9/9，`support.ts` 四项覆盖率 100%，实际 Desktop composition 10/10；最终修正后相关回归 20 pass/3 skip、typecheck、lint、Knip、duplication 通过。Windows 仅执行源状态/PE 夹具 11/11 和 Python 9/9，没有运行最新 Electron、安装器或系统保存对话框。[Windows 来源验证][windows-source]

仍未完成：Role 编辑和完整管理 UX、完整运行健康/有效角色/更新诊断、update feed 与失败更新恢复的完整验收，以及最新来源绑定提交的 installed/portable 实际导出。历史 installer `0xC0000005`、超时、Vitest fork/后代清理和深链间歇问题的根因没有全部关闭；后续某候选成功不能抹去这些记录。

### 5.2 macOS Direct Full Host

旧报告中的“只有 DirectHostMac 壳、未实现 sidecar”已经过时。接续已实现单一 Swift 生命周期 owner、固定本地 dsh profile 启动、Swift/C 进程组 helper、健康观察、启动超时、退出发现、停止/重启及 Runtime 资源组装。实际实现使用临时本地 HTTP health/WebView carrier，属于既有执行结果，与原方案首选 stdio 分别记录。

真实 macOS 验证已完成应用首屏、Continue/Configure later/New session、停止后旧 PID 消失、重新启动、重启后出现不同且唯一的新 PID、最终停止等路径。`fae45ba...` 的 Mac Full Host 归档约 83.8 MB，独立核验源码、producer、证据和 bundle 清单，原生 XCTest 2/2 通过。[Mac 平台证据][mac-native]

尚未完成的关键条件是 `noOrphan=INCOMPLETE`：detached 工具进程组、PTY 和 helper 突然死亡时的外部进程所有权仍未验收。签名为 ad-hoc；Developer ID、正式公证为 `NOT_EXECUTED`，`completeRc=false`。曾出现重启期间应用终止，后续未复现但根因未关闭；`NO_REPORT` 只表示未取得报告，不等于证明没有崩溃。

原目标的完整 Host Controller 管理 UX、配对/管理员/Remote 开关产品验收、iPhone 实际接入该 Mac、正式发行和安装恢复仍不能认定完成。

### 5.3 Apple Remote Companion：macOS、iOS、iPadOS

共享 Swift Remote Core、Contract/领域投影、Session、Approval/Question、Plan/Todo/Goal、Tool/Subagent、Files/Diff/Artifact 和 Lite 基线已经存在。三套 Xcode scheme 及 iOS/iPadOS target family 已有构建记录，Host-only 代码与 Companion targets 隔离。

用户重新开启验证后，真实 Apple runner 已执行 Swift tests、Host↔Swift 13 步、断线恢复和 iOS 首屏；后续还完成 iOS device arm64 和 macOS Companion arm64/x86_64 归档与 Mach-O/清单核验。归档通过不等于设备安装或商店 export。

`fae45ba...` 上 Swift 157/157、真实 Host 13 步、Mac/iOS 模拟器各 23 项 scanner 原生断言以及实际取消/保存通过，两端保存文件各 1,470 字节，完整 Support Bundle 仍为 false。[Apple 原生验证][apple-native]

最新未发布链中的 Swift 配对/响应校验、交互归属、未知 Session 事件和 N/N−1 矩阵尚未取得新 Apple 编译/运行证据。真实 iPhone/iPad 扫码配对、网络切换、后台前台、物理设备存储恢复，大屏专属布局、输入形态、双主题完整视觉验收、TestFlight/正式签名与分发均未完成。

### 5.4 Android Remote Companion

Kotlin/Compose Remote Core、TLS/SPKI、配对、领域投影、会话控制和资源读取已经实现，Host↔Kotlin 13 步与恢复已有 E4。早期 API 34 debug 首屏通过；历史候选 `fa3e66e6428d5418520b40c35853cc6e571e3895` 还取得实际 `apiLevel=36`、`pageSizeBytes=16384` 及首屏/通知 2/2 证据。后续已有 release AAB、R8 mapping、临时签名派生 APK、包字节/ELF 对齐和一次性模拟器验收，不能继续写成“只有 JVM、从未装过 App”。

`fae45ba...` 的 PR 和手动 Android 运行各有 instrumentation 9/9、Host 13 步，系统实际保存各 1,727 字节，保存字节核验通过；该未配对导出观察到 `selected=false`，不证明配对后的 Session 导出已验收。[Android 原生验证][android-native]

此后本地已完成应用源码独立绑定、按应用构建归属的退出历史、配对恢复诊断、凭据原子保存和版本迁移。最新凭据迁移提交的 app/test APK 已从干净提交构建并核验来源，但没有实际安装和执行 AndroidKeyStore/Activity 迁移恢复用例。

最近原生环境尝试属于环境失败：私有 Linux KVM 模拟器 v3 在引导阶段 QEMU exit `-11`；软件 CPU v4 未在原 240 秒内引导完成。应用未安装，目标 instrumentation 执行 0 项；专属进程已清理到终态。不能用这次失败否定历史模拟器通过，也不能把历史通过套用给最新 APK。

仍未完成：最新 AndroidKeyStore 迁移/恢复原生路径、paired Support 导出、退出历史受控崩溃实测、真实手机/平板/折叠屏、Window Size Class、完整网络矩阵和商店交付。历史 low-memory/系统保存层级问题及安全区视觉问题也未全部关闭。

### 5.5 Native Lite、Handoff 与移动产品体验

已经存在 Swift/Kotlin LocalLiteRuntime、OpenAI 兼容流式 provider、SSE/NDJSON 解析、工具调用分片、Session journal、Plan/Todo/Artifact、本地历史、静态工具目录、`requiresFullRuntime` 及共享行为 fixtures。原报告记录了六个 keyless Lite 场景，覆盖 Prompt、Streaming、Cancel、Tool、Plan、Todo、Artifact、Provider/Network Error 和 Handoff 请求；这些属于基线证据。

Handoff L1 已有双端发送器、Contract 和 Host 新建 Session 路径。实际快照使用 `recentContext` 承载逐字上下文，Plan 为 Lite 活动标志，保留 Todo、Artifact 引用、模型偏好、所需能力和 provenance；goal/summary 并入上下文，attachments 没有随快照迁移。Host 组合 create、rename 和 queue prompt，接力简报及来源进入 Session 日志。

未完成的核心是统一 `HarnessRuntime` 产品门面、System Prompt/Persona，以及 `web_search`、`url_fetch`、`image_inspect`、`attachment_read`、`calculator` 的完整真实执行体与验收。Handoff sender 真调用、失败不显示成功、幂等、provenance 和新 Full Session 的完整产品验收仍属 Gate 3；不能把静态目录或行为 fixture 等同于手机上完整可用的 Lite。

多 Host、Session 运行位置、iPad 三栏与多窗口、Android 大屏/折叠屏、Diff 行号/语法高亮、双风格视觉打磨、Follow/私网 UX、相机扫码权限与手动回退的完整验收同样尚未完成。

## 6. 诊断与 Support Bundle

### 6.1 已实现和已验收的子范围

完整目标是四平台同一候选均能生成包含应用标识、Runtime 健康、连接、诊断事件、协议、有效角色、capabilities 和 updates 的支持包；每个字段说明 producer 和新鲜度，经用户显式导出、离线 secret scan、取消和准确字节保存。[Support 总回执][support]

已实现 `link/diagnostics` 的受限 Host 投影，输出 listener 状态、协议和 capabilities，默认不向 Remote 开放。产品诊断采用版本化 schema，只保留应用身份、固定错误类别与计数；Windows/macOS 原生采集已有接线，不导出任意路径、原始异常消息、完整日志或凭据。

Windows/Mac 桌面、Mac Companion/iOS、Android 已在历史候选取得实际系统保存与离线复扫。`fae45ba...` 的五份桌面相关导出独立复扫零发现；Apple/Android 保存大小和原生断言见第 5 节，均明确 `completeSupportBundle=false`。

移动离线 scanner 已形成 Android AAR/JNI 和 Apple framework/XCFramework，核验源码、builder、工具链、模块/许可证及包内字节。Android 历史 x86_64 原生 JNI 断言通过，Apple 多架构资源与实际库调用亦有通过记录。scanner 来源与应用来源分别绑定，不能从复用库的 SHA 推断 App SHA。

### 6.2 最新本地补充

| 子项 | 已完成实现 | 当前验证边界 |
|---|---|---|
| Android exit history，`172e61a...` | 启动前登记构建标记，导出有限系统退出历史中的固定原因计数 | JVM 17/17、Linux Python 27/27、编译通过；新受控原生崩溃驱动未执行 |
| Android application source，`64fa631...` | App commit/tree 独立于 scanner；Support 和退出历史按 App 归属校验 | Kotlin 19/19、保存字节 Python 23/23、workflow TS 63/63；APK 来源通过，原生执行未完成 |
| Windows application source，`faef020...` | Windows 应用来源、PE/packaging 与 Support 对应 | 本地/隔离检查完成，最新 installed/portable 导出未执行 |
| Android restore diagnostics，`0ce88dd...` | 文件缺失、读取、格式、解密失败分别报告，保留最近一次恢复尝试和诊断入口 | 本地测试和编译完成，实际 AndroidKeyStore/UI 未验收 |
| Android backup/migration | Support 捕获恢复来源和结果，启动迁移/恢复共享运行时状态 | JVM 与纯文件证据通过，详见第 8 节 |

### 6.3 仍缺的支持与崩溃信息

`runtime-health`、`updates` 等完整 producer 仍缺。Windows 的 profile lifecycle 和 renderer activity 只代表有限观察，不能替代完整 Runtime 健康或 Remote 连接状态；有效设备角色也不能以广告能力代替。

Android 新退出历史只描述系统有限保留窗口，`historyComplete=false`；空列表不能证明健康，collector 缺失或失败仍保留未采集标记。Apple iOS 崩溃、Android ANR 和运行时操作诊断的完整生产链未闭合。

尚缺四平台当前候选的完整字段、paired 与 unpaired 两种导出、各实际保存路径及完整治理验收。`G2-CRASH`、`G2-SUPPORT` 均保持部分完成。

## 7. Contract 与跨候选兼容性

这一领域在 2026-09-13 至 14 日有连续本地提交，最新工作树为 `agents/link-pair-compatibility@74f683dd2a73b325eeb3cb0a16a7e36b142099fe`，未推送。[兼容性总回执][compat]

### 7.1 已完成的解析和投影修复

| 范围 | 实现与测试事实 |
|---|---|
| 配对响应 | 共享 25 场景：4 接受、21 拒绝；忽略新增可选字段，验证必填身份和协议后才保存凭据；TypeScript 45/45，Kotlin 经 HTTP 执行全部场景 |
| authenticated Host preflight | unary 和新 stream 前读取经认证描述，检查 protocol/contract/session 三轴及 full runtime；描述语料 58 行，11 可解码、4 兼容、47 拒绝解码 |
| 实际 RPC/NDJSON 接收 | 校验 request id、必填字段、值/错误互斥、帧类别、数字与 JSON；80 场景，其中 RPC 47、stream 33、格式拒绝 60 |
| TypeScript/Kotlin 对应回归 | 响应阶段 TS 181/181、Kotlin core 172/172；两份 TS index 源码四项 coverage 100%；生成夹具被故意破坏时漂移门禁拒绝 |
| 交互归属 | 只识别准确 `approval/request`、`user-questions/request` waterfall，以 `agentId`/`eventId` 确定归属；拒绝相似未知事件名和缺失身份，Kotlin core 176/176 |
| 未知 Session 事件 | 生成共享 scenario，验证投影和恢复；TypeScript 39、Kotlin 35 通过；对应 loopback HTTP/NDJSON 夹具与真实 Host 验收分开 |
| 检查调度 | 六种聚合先结束 Knip 再创建 built-invariant 临时探针；Linux 89/89，真实 hygiene 21/21；故意放入未使用探针时 aggregate 明确失败 |

版本仍为 protocol `1`、contract `1`、Session format `0`。合法未知版本可供诊断，但不兼容时不发业务请求。Host describe 和业务请求是两次交换，没有原子版本绑定；这是已记录限制，本文不扩展成新设计。

### 7.2 已执行的 N/N−1 矩阵

N−1 选用真实、已原生验证的候选 `fae45bae1f09c59b2dd1a69403f89db2dc3cd355`，不是虚构的 tagged release，也不代表不同协议代际。

早期 TypeScript 和 Kotlin 四组合各完成每组 9 步、共 36 步。正式入口随后分离 runner、Host、client 的源码根，验证各自 Git SHA、构建字节和执行前后稳定性。`2e41af7...` 的正式 Kotlin 13 步四组合已有 52/52；固定 producer 提交 `13805239e237d263b715379ad5f48cadf9378fa4` 又通过其真实入口生成四组合矩阵，共 Kotlin 52/52 和 TypeScript reference 52 步。[固定 producer 回执][compat-producer]

这些运行实际使用 shipped Host、Kotlin TLS 栈和隔离测试模型，含 stream replacement、离线推进及相等恢复投影。它们证明特定候选的协议互操作，不证明 Android UI、物理设备、真实外部模型或发布治理已经通过。

### 7.3 workflow 与在线采集器

已新增固定来源的 Kotlin/Linux、Swift/macOS compatibility workflow，校验两端源码、N−1 祖先关系、corpus、四组合摘要和清理结果；不接受用户提供的 verdict 文件替代实际运行。

最新 `74f683d...` 已将只读 live compatibility collector 接入 readiness，核验最新 PR run、必需步骤、attempt/freshness、artifact 元数据和实际 ZIP 长度/摘要。TypeScript 141/141、Python ZIP 6/6 等本地检查通过，真实 GitHub transport 还读取并核验了一份历史 artifact，证明下载解析通路可用。[采集器回执][compat-collector]

新 workflow 尚未公开运行，Swift 新矩阵未编译/执行，准确新候选缺少在线 CI 和原生矩阵。实际 readiness CLI 为 exit 1、`NO_GO`、`publicationAuthorized=false`，G2-CI/G2-COMPAT 观察为 FAIL；这反映发布证据缺失，不是宣告本地 Kotlin 矩阵失败。`G2-COMPAT` 仍为 `PARTIAL / complete=false`。

## 8. 存储版本迁移与恢复

完整 G2-MIG 要求 Session、settings、Device Trust 和 native storage 均具备版本化、先备份的显式前向迁移、损坏恢复和明确降级限制。以下四个实现范围已有实际提交，完整部署恢复尚未验收。[迁移总记录][migration]

### 8.1 Android 凭据：原子保存、恢复与版本迁移

`b9cdd23b07128afcca21ab0f90844b6419465e42` 已实现同目录暂存完整 cipher 输出、force 后原子重命名，不以直接覆盖主文件作为失败回退；保留一份可解析解密的前序 backup，损坏 primary 进入 rejected 槽，不能破坏已有备份。load 只读，显式恢复在操作时重新验证，拒绝覆盖仍可加载的主文件。

启动、配对、恢复串行且共享同一 store 和 pairing StateFlow，Activity 重建不保留另一份旧 paired 状态。最近一次身份恢复捕获来源与结果，旧尝试不能覆盖新尝试。本地 Kotlin 64/64，其中 14 项真实 NIO/JVM AES-GCM 事务用例；Python 24/24，最终 APK 编译与来源核验通过。[凭据恢复回执][credential-recovery]

`f3d073e14f0c0e27a204d213bc5ff289c25312f9` 在此基础上引入 `formatVersion=1`。唯一前序输入是无版本七字符串字段格式；load 返回 `MIGRATION_REQUIRED`，由 CompanionRuntime 启动转换显式执行 migrate。迁移先验证旧密钥可解密、保留准确旧文件，复用 ciphertext，不重新 seal 或创建密钥；当前格式重复迁移不写文件，旧备份恢复会提升到版本 1。未来/模糊版本、重复/额外字段和超限文档被拒绝，unsupported primary/backup/rejected 在普通操作前受保护。

迁移 Kotlin 累计 77/77，含 13 项 NIO/JVM AES-GCM 迁移用例；Python 24/24；app/instrumentation 编译和准确来源 APK 通过。[凭据迁移回执][credential-migration] 这些结果不等于实际 AndroidKeyStore、Activity 启动迁移或恢复按钮已经执行。没有任意降级、跨进程并发写者协调、Host 授权恢复或掉电耐久性承诺。

### 8.2 Device Trust SQLite

`2e2b67cbbde75d0029e7e7e024fc1c4298759230` 提供显式 v1→v2 转换及当前 v2 恢复。工具以固定读取事务和 SQLite backup 纳入已提交 WAL，先保留一致快照，再生成独立 v2 候选，不替换或激活源数据库。

v1 无限定资源范围转成显式 all_sessions/all_workspaces，保留 Host 身份、公钥、角色、时间戳、吊销和未消费配对码；v2 恢复保留选择性/空 grant。发布前检查版本、布局、完整性、关系及全部预期状态，拒绝未知版本、额外数据库对象、损坏记录和冲突输出。

Linux 4 项集成内实际执行 Python 21/21，当前 provider 读取转换结果，保留配对码仍只能消费一次；Windows Python 20 pass/1 预设链接创建 skip。源码 tree、正常 hooks、typecheck、`test:docs` 15/15、`doc-sync` 32/32、lint 均有回执。[Device Trust 回执][trust]

实际部署启用恢复数据库、配套 Host/companion 重新接入尚未执行。正常 runtime 仍拒绝旧版本；源与候选不能作为同一 Host 身份同时服务。

### 8.3 Settings 文件

`5144db97e5dbca6966053b7ad53baeff2ccfcd1c` 引入顶层数值 `formatVersion: 1`，与 namespace 分节并列，不把元数据暴露成设置分节。正常加载只读，只接受当前格式；无版本需显式迁移，未来版本、重复键、非 JSON 数据、非法 UTF-8 和超限文件拒绝，错误不回显正文或 parser 原消息。

显式工具在 provider writer lock 下先保存原始准确备份，再生成并重读独立候选，核对全部分节，释放锁后发布 PASS 回执；不替换源或自动激活。YAML 保留注释、锚点和未注册分节，JSON 只插入版本字段以保留数字原表示，当前版本恢复保留准确字节。完整文件上限默认 1 MiB、配置范围 1–16 MiB，readFile 后检查不等于物理读取内存硬上限。

Linux settings 119/119，`index.ts`、`document.ts` 四项 coverage 均 100%；相邻消费者累计 84/84；真实 Loader 验证值、namespace 描述和热更新；Windows 纯文件 CLI 7/7。Web/Desktop/Link 三个定向 keyless composition 通过，准确干净提交的 TypeScript Link reference 1/1，typecheck/docs/lint/hooks 均通过。[Settings 回执][settings]

部署后恢复、原生客户端与真实模型验收未执行，不承诺目录 fsync、掉电耐久性或外部编辑器遵守锁。

### 8.4 Session SQLite：最新已完成本地提交

最新 `16482eec880f40bb472c9328acf5a8819bc988f9`，tree `b72cdfabca02f8b9cba50b2849bf0e524336c2cd`，父提交为上述 settings 提交。14 个明确路径正常提交，审阅 blobs 与提交一致，Linux 验证完整 tree 一致，工作树干净，未推送。[Session 回执][session]

工具接受 schema 18→19 转换及当前 schema 19 恢复，旧布局与实际编码器固定来自 `1e2d2b7b47907970023997bfaa68ef7b9120458a`。它执行一致 WAL 备份后处理文本主键、无字典压缩数据和无标记 delta provenance varint，并非只改 `user_version`。

候选保留公开 Session id、谱系、预设、时间戳、store id、incarnation、revision 和打包边界；内部整数键重建，数据转成当前可读文本，因此文件大小和物理字节不保证相同。复用当前解码、规范化、Session 校验与确定性中断 closers，再重读比较全部逻辑状态。完整中断尾部和允许处理的坏物理尾部只在候选修复；损坏前缀、未知事件及未知物理/逻辑版本拒绝。

文件、解码列、完整逻辑 JSON、物理/展开事件数和准备时间均有上限；时间检查不承诺抢占同步 SQLite/解压/文件系统操作。最终 receipt 发布是提交点，之后冗余临时硬链接清理失败不否定已提交结果。源和已完成备份保留，不自动激活；正常 provider 仍拒绝旧版本，逻辑 `SESSION_FORMAT_VERSION` 仍为 0。

| 最新 Session 验证 | 结果 |
|---|---|
| Linux 迁移集成 | 40/40，包含真实当前 provider 读取候选、WAL、字典/provenance、空子 Session、谱系、恢复和资源/失败路径 |
| Windows 纯文件 CLI | 9/9 |
| 归档验证器 | 6/6 |
| typecheck、文档 | PASS；`test:docs` 15/15、`doc-sync` 32/32 |
| lint、duplication | 0 warnings/errors、0 clones |
| 最后脚本修正后的验证 | 重跑 40 项及 Windows 9 项，lint 重建 Host 类型；未变文档、导出、导入和 Client 类型按准确差异复用已有证据 |

未完成：JSONL 根目录的先备份转换、实际部署后的 Session/settings/Device Trust 恢复与回退、其他 native stores、Swift/Apple 和 Android 原生消费、真实模型验收。以上工具只处理临时测试数据，没有迁移用户实际存储。`G2-MIG` 整体仍为 `PARTIAL`。

## 9. 发布工程安全与治理状态

### 9.1 产品标识、渠道与候选产物

统一 SemVer、build number、channel 及原生版本投影已经实现，生成器和 drift gate 接通。`G2-VERSION.json` 顶层实际为 `PASS`：Windows 源 `1e650628...`，Apple/Android 分别固定到 `5971ff78...` 的未变标识输入，完成标识子项验收；它明确不表示同 SHA 四平台 RC。后半部交接表仍写 `PARTIAL`，本文保留 owner JSON 的准确范围。[版本回执][version]

dev/canary/beta/stable 的解析和兼容规则已经存在；相对前一已分发版本的递增比较、受保护上传和晋级策略完整验收仍未完成。部分渠道/CI JSON 的 pending 文本也早于后续候选生产，本报告以实际后续回执补充，不把旧 pending 原样当作当前完全未实现。

`fae45ba...` 已取得同一 source SHA 的 Windows、Android、Apple Companion 和 Mac Full Host 产物字节、清单与来源验证；Windows/Android platform owner 验证 PASS。但回执同时为 `completeRc=false`，执行认证字段尚未全部满足，Mac no-orphan、Apple distribution export 和正式签名未完成。[四平台回执][platforms]

### 9.2 供应链与安全准入

已建立固定 Action SHA、最小 permissions、源码扫描、Go 漏洞检查、secret scan、CodeQL 多语言分析、依赖审查入口、SBOM/库存、checksum、产物来源记录和 provenance/attestation 工程基础。多项真实缺陷已修复，包括 Worker 随机采样偏差、Web 渲染器重复前缀的性能问题、敏感错误回显和源文件竞争检查。

用户批准的精确补丁已应用，范围是刷新 11 项已有 SAST 审阅的源码绑定并登记 1 条随机测试凭据源码行例外；当时仍有 53 项未审，真实 runtime scanner 仍检出该测试凭据。这个数字属于当时提案，不能作为当前候选未审数。

最近已归档的 `fae45ba...` 安全回执：Go 0 项、JavaScript/TypeScript 61 项、Swift 1 项、Java/Kotlin 6 项、Python 1 项；secret scan PASS，依赖审查 `NOT_COMPLETED`，SAST 因审阅源码上下文变化为 FAIL。回执没有提供可用的 reviewed/unreviewed 分类数，因此不能把全部发现说成已审，也不能把它们全部断言为确认漏洞。新 `172e61a...` 及后续本地链没有新的完整安全准入回执。[供应链回执][supply]

### 9.3 Release governance

已实现版本化 16 项工程清单、6 项生产外部动作、严格解析、owner/evidence owner 完整性、源码绑定 Go/No-Go reducer、固定在线 CI/产物核验入口和真实 CLI；不接受序列化 PASS 文件或人工 waiver 抵消工程失败。生产授权字段保持 false。[治理回执][governance]

`fae45ba...` 的实际 CLI 已观察到必要 CI PASS，但结论仍为 `NO_GO`；当时 14 项工程证据 adapter 不可用。后续 `74f683d...` 已接入兼容性 collector，所以“兼容性 adapter 从未实现”已经过时；然而新源未公开且缺在线矩阵，实际新 CLI 仍 `NO_GO`，并非发布准入成功。

签名、正式公证、TestFlight/Play/Microsoft Store/App Store mutation、产物生产发布、rollout 和开发者身份提交均没有因本地测试或 draft PR 而得到完成标记。工程准备与这些外部生产动作仍分开。

## 10. 进行中与未完成事项总表

### 10.1 Gate 2：16 项工程要求

| ID | 当前状态 | 已完成或已有基础 | 尚未满足的完整验收 |
|---|---|---|---|
| G2-VERSION | 历史标识子项 `PASS` | SemVer/build/channel 和四平台标识投影、实际产物验证 | 最新完整 RC 的同源/执行绑定仍由 G2-RC 等项承担 |
| G2-CHANNEL | `PARTIAL` | 渠道解析与版本规则 | 已分发版本比较、受保护的上传/晋级完整策略 |
| G2-CI | `PARTIAL` | required checks、来源回执和在线读取；fae45ba 必要 CI PASS | 最新未发布链没有在线 CI；全部平台/新兼容性证据未齐 |
| G2-SUPPLY | `PARTIAL`，最近安全准入 `FAIL` | 多语言扫描、秘密扫描、SBOM/库存、摘要和来源机制 | 当前 SAST 审阅、dependency review、完整打包闭包供应链准入 |
| G2-WIN | `PARTIAL` | installer/portable 启动、版本和部分原生导出实测 | 更新流、校验拒绝、失败更新恢复、最新应用来源导出及完整验收 |
| G2-MAC | `PARTIAL` | Full Host 组装、实际生命周期和 UI | detached/PTY/helper-death no-orphan、完整恢复和管理路径 |
| G2-MACSIGN | 专项验收未完成 | 已有 bundle 清单、嵌套签名检查、ad-hoc 候选 | Developer ID/最小 entitlements/Hardened Runtime/公证钉票完整准备与 dry-run；生产 submission 未执行 |
| G2-IOS | `PARTIAL` | 身份、targets、privacy/SDK/归档工程基础及实际 archives | 完整 signing/export 和发行验收，上传未执行 |
| G2-AND | `PARTIAL` | toolchain、AAB/R8、包检验、历史 API 36/16 KiB 实测 | 最新 App/存储候选原生验收及统一 RC |
| G2-CRASH | `PARTIAL` | 版本化诊断、Windows/macOS 采集、Android 退出历史本地实现 | iOS/Android ANR/Runtime 操作 producer 与完整真实采集 |
| G2-SUPPORT | `PARTIAL` | 四平台部分真实导出、离线扫描、取消/拒绝 | 缺失 producer、paired 导出、当前同候选全部字段和准确保存路径 |
| G2-MIG | `PARTIAL` | Android 凭据、Device Trust、settings、Session SQLite 显式迁移/恢复 | JSONL、其他 native stores、部署启用和 Host/companion 恢复/回退验收 |
| G2-COMPAT | `PARTIAL` | 三类语料、响应/事件修复、Kotlin 四组合、producer/collector | Swift 新矩阵、准确新源在线 CI 和原生证据准入 |
| G2-ROLL | 完整演练 `NOT_STARTED` | 局部存储备份/恢复和进程重启已有基础 | 各平台 updater rollback、forward fix、feature kill、migration recovery 演练 |
| G2-GOV | `PARTIAL / NO_GO` | 清单、reducer、在线检查及兼容性 collector | 其余工程 adapter、执行认证、全项 DoD；Beta/GA 政策未完成 |
| G2-RC | `PARTIAL`，完整 RC 未完成 | 历史同 SHA 四平台产物与字节核验 | 全部必要工程项、执行认证、SBOM/provenance/manifest 与同候选准入 |

### 10.2 Gate 3：产品化与 Beta

Gate 3 尚未完成正式阶段验收。以下“已有基础”只说明前期实现或 Gate 2 的相关进展，不代表该项 Beta DoD 已通过。

| ID | 当前基础 | 未完成内容 |
|---|---|---|
| G3-QR | QR 配对协议、UI/首屏基线 | Apple/Android 实际相机扫码、权限拒绝/手动回退、过期/重放/错误指纹完整产品路径 |
| G3-DISC | LAN/QR endpoint 直连 | mDNS/Bonjour 自动发现、多 Host 确定性展示与独立信任校验 |
| G3-LIFE | 断流与权威恢复 E4、存储恢复实现 | 真机后台/前台/进程死亡/冷启动及 Wi-Fi/VPN/丢包等矩阵 |
| G3-LITE-A | Apple Lite 基线 | 统一 HarnessRuntime、严格 Lite P0、真实工具/Persona 和产品验证 |
| G3-LITE-D | Kotlin Lite 与共享语料 | 对应真实能力和完整产品验证，不增加第二 Session 域 |
| G3-HAND | Handoff L1 基线 | sender 真调用、失败反馈、provenance、幂等、新 Full Session 完整验收 |
| G3-MACHOST | Mac 生命周期和 WebView 已实跑 | Host Controller 管理、配对/管理员、Remote 开关、完整诊断与恢复 UX |
| G3-OBS | 隐私白名单与局部诊断 | release health 指标、synthetic alert、SHA/version correlation |
| G3-FLAG | Remote Access/Approval 开关 | File/Artifact/experimental capability 独立 kill，与能力协商分离 |
| G3-WINUX | 设备列表/撤销和局部 Diagnostics | role edit、完整 Diagnostics/update UI，所有设置驱动真实 owner |
| G3-MOBILEUX | 多种领域面板 | Hosts/运行位置、完整导航、iPad 三栏、Android Window Size Class、Diff/主题/输入体验 |
| G3-STORE | 尚无完整准入 | machine-readable 商店 metadata、privacy/data-safety inventory；缺人工值如实标记 |
| G3-APPLEBETA | 未启动 | TestFlight group/review/info/API dry-run，真实 mutation 未执行 |
| G3-PLAYBETA | 未启动 | internal/closed track payload、release notes、Data Safety、signing dry-run |
| G3-ANDROIDVERIFY | 未启动 | package id、公开签名 fingerprint 和账号前置清单；身份提交未执行 |
| G3-BETA | 未启动 | clean RC 的 gates→产物→SBOM→安装→诊断→回退→商店 payload 全链演练与 Beta readiness report |

### 10.3 Gate 4：GA 工程交接

| ID | 尚未完成的交付 |
|---|---|
| G4-GA | 锁定 SHA/version/channel，只晋级已验证不可变 CI artifact 的 GA 演练 |
| G4-SIGN | 四平台 Production Signing Handoff；仅记录凭据标识、范围与轮换角色 |
| G4-NOTARY | macOS sign→notary→staple→Gatekeeper 的完整执行包；真实提交未执行 |
| G4-STORES | TestFlight、Play、Microsoft Store、App Store submission bundle |
| G4-ROLLOUT | staged rollout、pause、kill、forward-fix 和健康阈值的工程准备 |
| G4-INC | severity、Incident Commander/Runtime/Release/Security 角色与 synthetic tabletop |
| G4-GOV | 完整 `GA_READINESS.json/.md`；工程 FAIL 仍阻断 |
| G4-P3 | 固化 defer 清单及 reference Relay/Noise 未接生产路径的最终核验 |
| G4-HANDOFF | 绑定版本、SHA、artifact、checksum、tests、SBOM、provenance、manual steps 和 blocker 的最终 RC 交接 |

六类生产动作 `PROD-SIGN`、`PROD-NOTARY`、`PROD-STORES`、`PROD-PUBLISH`、`PROD-ROLLOUT`、`PROD-IDENTITY` 均未完成本目标的生产执行。不能将 draft PR、debug/ad-hoc 签名或商店 payload 文件称为生产发布。

## 11. 提交工作树与远端交付状态

### 11.1 当前本地分布

本次直接核验主工作区仍在 `dev@90ef8b197fe2aa38cc40917cd157077a8d1dc6b9`，原有未跟踪文件 [IMPLEMENTATION_VERIFICATION_V2.md][user-report] 保留。上游同步目标是本地 `master`，并非当前 dev 或实现分支已经更新到 master。

| 工作树/分支 | 本次核验 HEAD | 用途与状态 |
|---|---|---|
| [goal-mode-full-implementation][wt-goal] / `codex/goal-mode-full-implementation` | `172e61a7e0ec436db47cf9fe76ff592b4c6a7d44` | 原候选；保留 20 项 verification dirty，源码没有待提交 WIP |
| [link-pair-compatibility][wt-compat] / `agents/link-pair-compatibility` | `74f683dd2a73b325eeb3cb0a16a7e36b142099fe` | 配对/响应/事件兼容、四组合 producer/collector；本地提交 |
| [android-application-source][wt-android-source] | `64fa63152b93b6898f95f4bda8eb6857dbb19848` | Android App 来源绑定；本地提交 |
| [windows-application-source][wt-windows-source] | `faef020b9afedfafc025d459f1f672650f8f3945` | Windows App 来源绑定；本地提交 |
| [android-restore-diagnostics][wt-restore] | `0ce88ddcf741bdd81c5a5aff867ab3c1e4c2cee9` | 恢复失败诊断；本地提交 |
| [android-credential-recovery][wt-recovery] | `b9cdd23b07128afcca21ab0f90844b6419465e42` | 凭据原子保存/恢复；本地提交 |
| [android-credential-migration][wt-credential] | `f3d073e14f0c0e27a204d213bc5ff289c25312f9` | 凭据格式迁移；本地提交 |
| [device-trust-migration][wt-trust] | `2e2b67cbbde75d0029e7e7e024fc1c4298759230` | 信任库迁移/恢复；本地提交 |
| [settings-storage-migration][wt-settings] | `5144db97e5dbca6966053b7ad53baeff2ccfcd1c` | Settings 版本与迁移；本地提交 |
| [session-storage-migration][wt-session] | `16482eec880f40bb472c9328acf5a8819bc988f9` | 最新 Session SQLite 提交；工作树干净 |
| [android-sbom-ci-fix][wt-sbom] | `2ea87e535c4db11e42035dac06899ade56eee4a7` | 保留的历史专项工作树，不作为最新主链 HEAD |

上述兼容性、来源绑定和存储提交形成连续祖先链，最新 Session 分支包含这些前序实现，不是彼此无关的多份代码。`fae45ba...` 至 `16482ee...` 本次 Git 计数为 18 个提交；最后已知公开候选仍停在该链之前。工作树保留各阶段检查点和 `.artifacts`，不等于每个阶段都已单独发布。

### 11.2 已推送与 draft PR

历史已经完成候选推送和创建 [draft PR #1](https://github.com/nivranic/deepseek-harness/pull/1)，目标分支为 `dev`。最后保存并多次复核的远端状态为 OPEN、draft，head `fae45bae1f09c59b2dd1a69403f89db2dc3cd355`，base `90ef8b197fe2aa38cc40917cd157077a8d1dc6b9`。[远端与原生综合检查点][published]

本次尝试只读查询 PR 时，当前 PowerShell 无法解析 `gh`，未取得新的 GitHub 响应。因此上述 PR 状态明确为最后已知远端快照，本次没有将其写成实时确认结果，也没有更新 PR。

`172e61a...` 的公开推送曾被自动审批拒绝：收窄到现有 PR 单分支并核验现有公开仓库后，审批仍要求明确批准向该具体公开仓库披露这批源码。精确提案和回执保留于原工作树 `.artifacts`；未换传输绕过拒绝。用户批准的 SAST 精确补丁是另一项动作，后续本地提交也不在当时待批差异内。这里记录历史阻断，不在本总结任务中重新请求授权或尝试推送。

### 11.3 实现与文档同步的最终停点

最新 Session 实现已提交、验证已结束，总回执已生成；交接候选、`G2-MIG` 候选及前后摘要提案也已生成，但尚未覆盖原交接/机器记录。本报告补足该事实，未顺手应用这些旧回写提案。

本轮只新增本报告，未改变用户原有报告、原候选 verification dirty、源码、vendor、归档 Notes、memories、安全绑定或例外；未提交、推送、合并或发布。当前没有为了本报告启动新的产品测试或原生进程。

## 12. 上游官方桌面应用与本地 master 事实

### 12.1 当前已确认与尚未核验的部分

| 项目 | 本次结果 |
|---|---|
| 用户提供的信息 | 上游已推出官方 macOS/Windows 应用，最新代码已同步本地 master |
| 本地 master HEAD | `c291e7961a515f6d7af9304e7fd1d257929aef26` |
| 提交时间与标题 | `2026-09-10 22:17:09 +0800`；`Merge pull request #3977 from deepseek-harness/worktree/release-0.1.5-sync-master` |
| 根包与 Desktop 源码版本 | 两者均为 `0.1.5-rc.2`；这是本地 manifest 值，不能仅凭 merge 标题改写成正式 0.1.5 |
| Desktop 实现 | Electron 壳，内置上游 Node.js、pnpm 和完整 dsh 生产依赖 |
| 明确支持的发行目标 | `mac-arm64`、`mac-x64`、`win-x64`；README 明确 Linux 不属受支持 Desktop 发行目标 |
| 线上发行包 | 本次未下载、安装或核验签名/公证/版本，也未查询官方 Release 资产 |

### 12.2 本地 master 中的桌面能力

以下为读取 master 文档和配置得到的事实，不是本次运行验证结果：

- Desktop 包裹匹配版本的 dsh Web UI；内置 Node 子进程运行完整 Harness，内置 pnpm 负责包操作。
- 不打开监听 Web 端口；`dsh-app://` 提供资源和 Fetch 入口，带版本的分帧字节管道承载请求/流式响应，Node IPC 承载生命周期控制。
- Desktop shell 与 dsh 精确版本绑定，`desktop-runtime.json` 记录运行时、平台、架构、共享包版本和文件清单。
- 单实例锁保护 Desktop profile；与 CLI 共享受支持产品数据，但可执行依赖、插件激活、锁文件和包管理器状态独立。
- 已有加载/失败恢复界面、重启、插件管理、本地化菜单/对话框、桌面专有 profile 和更新入口。
- macOS 目标配置包含 DMG/ZIP、Hardened Runtime、嵌套签名验证、公证及 stapling 工程；Windows 目标为 NSIS，包含签名和差分更新配置。
- 固定脚本提供 macOS arm64/x64、Windows x64 的 package/upload 入口；配置还明确存在 Windows `--unsigned` 路径，因此不能把源码概括为“所有 Windows 构建都必然签名”。
- 更新使用 `electron-updater`、generic-provider 元数据以及目标专用更新路径；test/production 的打包和上传输入分离，校验版本、产物名称、大小和摘要。

核验使用的 Git 对象为 `master:README.zh.md`、`master:apps/desktop/README.zh.md`、`master:apps/desktop/package.json`、`master:apps/desktop/electron-builder.config.mjs`、`master:package.json` 及 release workflow。引用这些对象而不链接当前 dev 下的同名文件，是为了避免把不同分支的内容混为一份源码。

### 12.3 与原目标重合的范围及事实限制

| 原目标领域 | 上游本地代码显示的重合 | 尚不能由此得出的结论 |
|---|---|---|
| Windows 桌面 Full Runtime | Electron、内置 Runtime、profile、插件、安装/更新与恢复基础 | 原分支的设备信任、Remote allowlist、资源授权、跨端审批和支持包已被完整替代 |
| macOS 桌面 Full Runtime | Mac 桌面、内置 Runtime、生命周期、打包、公证/更新工程 | 原目标要求的 SwiftUI Companion/Direct Host、跨端 Host 管理和 no-orphan 全部达到原验收 |
| iOS/iPadOS/Android | 本次所读官方 Desktop 源码不提供这些目标的完成证据 | 移动 Remote/Lite、真机、Handoff、大屏和原生存储恢复已经完成 |
| 统一发布工程 | 上游存在自己的版本、签名、上传和更新体系 | 当前定制链 Gate 2–4 自动通过，或者旧候选结果可直接移用于 master |

本次在 master 精确查询 `apps/apple`、`apps/android`、`packages/remote/link-access`、`packages/remote/device-trust`、`packages/remote/link-contracts` 没有返回这些同名目录的文件。这只说明原目标这些路径没有直接出现在所查 master，不排除上游以其他名称拥有部分相关能力，也不构成全面功能差异审计。

master 与最新实现链的共同祖先为 `cd5ef8148158c3a752a658978873241fdf8e2bbc`；当前 dev、master、原候选及最新 Session 分支仍是不同 Git 状态。本报告未进行能力替代决策、merge/rebase、代码迁移或新的路线设计。

## 13. 原报告遗留事项的当前校正

### 13.1 原“尚未完成”15 项

| 原欠账 | 截至本快照的准确状态 |
|---|---|
| 1. macOS Direct Full Host | 已有实际 Full Host 组装、生命周期/UI 通过；完整 no-orphan、管理和正式发行未完成 |
| 2. iPhone/Android 真机端到端 | 模拟器和真实 Host 已有丰富证据，物理设备完整路径仍未完成 |
| 3. Lite 内置工具执行体 | 静态目录、分发和部分 Artifact/Handoff 通道存在，主要工具真实执行仍不完整 |
| 4. Lite System Prompt/Persona | 未完成 |
| 5. mDNS/Bonjour | 未完成；LAN/QR 直连不等于自动发现 |
| 6. capability/version 协商 | 三轴版本、Host 描述、能力及响应校验已有实质实现；Kotlin 跨候选通过，最新 Swift 和在线准入未完成 |
| 7. Windows Role 编辑/Diagnostics | 诊断已推进至真实部分导出；Role 编辑和完整 Diagnostics/update UX 未完成 |
| 8. iPad/Android adaptive layout | target/Compose 基础存在，专属布局与输入形态未完成 |
| 9. Diff 行号/高亮 | 未完成；只读文件/hunk 基线存在 |
| 10. 统一 HarnessRuntime | 未完成产品门面；Remote/Lite 并列基线存在 |
| 11. Session 运行位置/多 Host | 未完成完整产品化 |
| 12. Follow/Private-network UX | 基础 follow/恢复存在，深化要求和验收不完整 |
| 13. 网络/兼容矩阵 | 协议恢复与 Kotlin N/N−1 四组合已通过；最新 Swift、真机网络和在线矩阵未完成 |
| 14. Steer/Model read-select | 未完成原目标的单独 Remote 产品路径和验收 |
| 15. health probes/稳定度/命令风险 | Mac 有局部健康观察、版本/capability 已完善；完整 `/readyz`/`/healthz`、契约稳定度和命令风险分级仍未完整验收 |

### 13.2 不能继续沿用的旧表述

| 旧表述 | 本报告采用的事实 |
|---|---|
| Swift 被跳过，因此没有 Apple 运行证据 | 用户已重新授权，历史多轮真实 Apple runner 已通过；只是最新未发布 Swift 改动缺新证据 |
| Android 只有 JVM 或只有 debug APK | 历史已有 API 34、API 36/16 KiB、release 候选和原生系统保存；最新存储变更仍未原生执行 |
| G2-SUPPORT 未实现/移动离线 scanner 未完成 | scanner 和四平台部分导出已实跑；缺的是完整 producer、paired/同候选全部验收 |
| G2-COMPAT 未启动、没有 N−1、没有 collector | 已固定真实 fae45ba 基线，Kotlin 四组合和 producer/collector 已实现；Swift/在线准入未完成 |
| Session/settings/Device Trust 迁移均未实现 | 三项都已有本地提交和定向验证；Session 尚未回写原交接，部署恢复仍缺 |
| 四平台都有产物，因此 RC 完成 | 实际总回执仍 `completeRc=false`，治理 `NO_GO` |
| 批准 SAST 精确补丁后安全已全部通过 | 精确补丁已应用；后续源码上下文变化导致安全准入仍 FAIL，分类数不能沿用 |
| 上游有 Mac/Windows 应用，因此原目标已完成 | 只确认桌面范围重合，未完成原目标替代性评估，也没有移动端/Gate 自动完成证据 |

原报告第 0–85 章在本文的覆盖位置为：0–3、61、83–85 的定位和执行范围见第 1–3 节；4–20、62–67 的语义、Contract、正确性和验证见第 2、4、7 节；21–29 的发现/配对/授权见第 2、4、10 节；30–41、63 的 Lite/Attach/Follow/Handoff 见第 2、5、10 节；42–60 的平台/UI/资源见第 2、5、6 节；68–70、78、80 的 Relay/Push/排除项见第 2.9、10.3 节；71–77、79、81–82 的 PoC、阶段、交付与风险见第 3–10 节。旧章节“完成”标签没有整体搬作当前结果。

## 14. 证据索引与本报告核验范围

### 14.1 主要资料入口

| 资料类别 | 入口 |
|---|---|
| 原始完整目标 | [研究报告][research] |
| 历史与最新交接 | [原交接][handoff] |
| Gate 1 准入 | [gate1-evidence.json][gate1] |
| 发布工程清单 | [release/checklist.json][checklist] |
| 版本/供应链/治理 | [G2-VERSION][version]、[G2-SUPPLY][supply]、[G2-GOV][governance] |
| 支持/兼容/迁移 | [G2-SUPPORT][support]、[G2-COMPAT][compat]、[G2-MIG][migration] |
| 最近已知发布与原生综合快照 | [native-followup-20260913-android-session.json][published] |
| 四平台候选限制 | [platforms-fae45ba-verification.json][platforms] |
| Windows/Mac 实际候选 | [Windows 回执][windows-native]、[Mac 回执][mac-native] |
| Apple/Android 实际原生验证 | [Apple 回执][apple-native]、[Android 回执][android-native] |
| 新兼容性生产与采集 | [producer][compat-producer]、[collector][compat-collector] |
| 应用来源独立绑定 | [Windows][windows-source]、[Android][android-source] |
| Android 恢复/迁移 | [recovery][credential-recovery]、[migration][credential-migration] |
| Device Trust/settings/Session | [Device Trust][trust]、[settings][settings]、[Session][session] |

这些是本地证据入口，部分位于未跟踪或忽略的 `.artifacts`，不保证随现有 PR 对外可见。GitHub artifact 的历史结果在本文来自已归档的独立核验回执，本次没有重新下载全部历史产物。

### 14.2 本次实际核验与限制

本次读取原研究报告相关章节、完整目标/Gate/遗留映射、最新交接检查点、机器清单及关键总回执；以 Git 只读命令核对工作树 HEAD、主 dev、master、祖先链、提交数量和 dirty 范围；用 `git show master:<path>` 核验官方桌面代码与文档。本报告另做本地链接、章节/表格、行尾空白、换行和文件变更范围检查。

没有重新执行产品单测、coverage、构建、doc-sync、原生应用、真实模型或生产动作。文中产品验证数字都是对应来源 SHA 的既有执行回执，不是本次重新跑出的结果。PR 只读刷新因 `gh` 不在当前 PATH 未成功；线上 PR 和官方发行包均不冒称实时复核。

用户原有 `IMPLEMENTATION_VERIFICATION_V2.md` 在写入前记录 SHA-256 为 `b39cbef80dea4381615d88db2f5d7bf76a0bdf33e010b5aba06fb652478a4d6c`，用于确认本次整理未改动该文件。本文独立新增，没有覆盖它，也没有将本报告视为完整 Goal 的最终完成回执。

[research]: E:/11585/工作相关/deepseek-harness-首轮改造完成后的升级优化版deep-research-report.md
[handoff]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/artifacts/verification/goal-mode-handoff-2026-09-05.md
[gate1]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/artifacts/verification/gate-1/gate1-evidence.json
[gate2]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/artifacts/verification/gate-2
[checklist]: E:/Mix/project/deepseek-harness/.worktrees/session-storage-migration/release/checklist.json
[support]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/artifacts/verification/gate-2/G2-SUPPORT.json
[compat]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/artifacts/verification/gate-2/G2-COMPAT.json
[migration]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/artifacts/verification/gate-2/G2-MIG.json
[version]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/artifacts/verification/gate-2/G2-VERSION.json
[supply]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/artifacts/verification/gate-2/G2-SUPPLY.json
[governance]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/artifacts/verification/gate-2/G2-GOV.json
[published]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/.artifacts/native-followup-20260913-android-session.json
[platforms]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/.artifacts/platforms-fae45ba-verification.json
[windows-native]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/.artifacts/windows-fae45ba-verification.json
[mac-native]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/.artifacts/mac-fae45ba-verification.json
[apple-native]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/.artifacts/apple-fae45ba-native-verification.json
[android-native]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation/.artifacts/android-fae45ba-native-verification.json
[compat-producer]: E:/Mix/project/deepseek-harness/.worktrees/link-pair-compatibility/.artifacts/compatibility-producer-verification.json
[compat-collector]: E:/Mix/project/deepseek-harness/.worktrees/link-pair-compatibility/.artifacts/compatibility-collector-verification.json
[windows-source]: E:/Mix/project/deepseek-harness/.worktrees/windows-application-source/.artifacts/windows-source-verification.json
[android-source]: E:/Mix/project/deepseek-harness/.worktrees/android-application-source/.artifacts/android-source-verification.json
[credential-recovery]: E:/Mix/project/deepseek-harness/.worktrees/android-credential-recovery/.artifacts/credential-recovery-verification.json
[credential-migration]: E:/Mix/project/deepseek-harness/.worktrees/android-credential-migration/.artifacts/credential-migration-verification.json
[trust]: E:/Mix/project/deepseek-harness/.worktrees/device-trust-migration/.artifacts/device-trust-verification.json
[settings]: E:/Mix/project/deepseek-harness/.worktrees/settings-storage-migration/.artifacts/settings-verification.json
[session]: E:/Mix/project/deepseek-harness/.worktrees/session-storage-migration/.artifacts/session-verification.json
[user-report]: E:/Mix/project/deepseek-harness/IMPLEMENTATION_VERIFICATION_V2.md
[wt-goal]: E:/Mix/project/deepseek-harness/.worktrees/goal-mode-full-implementation
[wt-compat]: E:/Mix/project/deepseek-harness/.worktrees/link-pair-compatibility
[wt-android-source]: E:/Mix/project/deepseek-harness/.worktrees/android-application-source
[wt-windows-source]: E:/Mix/project/deepseek-harness/.worktrees/windows-application-source
[wt-restore]: E:/Mix/project/deepseek-harness/.worktrees/android-restore-diagnostics
[wt-recovery]: E:/Mix/project/deepseek-harness/.worktrees/android-credential-recovery
[wt-credential]: E:/Mix/project/deepseek-harness/.worktrees/android-credential-migration
[wt-trust]: E:/Mix/project/deepseek-harness/.worktrees/device-trust-migration
[wt-settings]: E:/Mix/project/deepseek-harness/.worktrees/settings-storage-migration
[wt-session]: E:/Mix/project/deepseek-harness/.worktrees/session-storage-migration
[wt-sbom]: E:/Mix/project/deepseek-harness/.worktrees/android-sbom-ci-fix
