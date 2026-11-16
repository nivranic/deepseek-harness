# DeepSeek Harness Upstream-First Agent 移交手册

移交编号：`2026-09-19-01`。编写日期：2026-09-19，时区 Asia/Hong_Kong。任务 ID：`01a0a084-9501-7fe3-8be0-434a574812e1`。机器采集时间、文件摘要和授权范围以 [state.json](state.json) 为准。

本手册帮助下一位 Agent 接续同一个实施任务，并在以后交回时保留完整上下文。**当前实施目标已按用户要求暂停，未完成，也未取消。** 本次只整理移交资料及进行只读核验，没有继续产品实现或补做未封存检查点。

## 目录

- [1. 接手先读：状态与工作目录](#handoff-start)
- [2. 用户原始需求与完整规格](#original-request)
- [3. 移交文件与事实来源](#handoff-files)
- [4. 总体架构与不可丢失的决定](#architecture)
- [5. 全部阶段状态](#phases)
- [6. 已完成工作的系统级索引](#completed-work)
- [7. 最新已封存检查点](#sealed)
- [8. 当前未封存增量：正式错误信封 schema](#unsealed)
- [9. 验证证据与不能据此推断的结论](#validation)
- [10. 问题、解决方案与未解问题](#problems)
- [11. 恢复实施后的第一项任务](#resume-first)
- [12. 后续完整路线与验收](#roadmap)
- [13. 环境、命令与运行约定](#commands)
- [14. 证据链、不可重复执行项与历史陷阱](#evidence-chain)
- [15. 同机、跨机器和上下文丢失时的移交](#transfer)
- [16. 接手验收清单与交给下一位 Agent 的提示词](#takeover)
- [17. 再次交回的协议、模板与提示词](#handback)
- [18. 本次手册的核验范围](#manual-validation)
- [19. 完整原始需求附件](#full-spec)

<a id="handoff-start"></a>
## 1. 接手先读：状态与工作目录

新的 Agent 首先定位下面的隔离工作区。桌面会话显示的主目录和 `dev` 分支不代表本次实施所在目录。

| 项目 | 移交时事实 |
|---|---|
| 实施工作区 | `E:/Mix/project/deepseek-harness/.worktrees/upstream-first` |
| 实施分支 | `agents/upstream-first` |
| HEAD / 固定 upstream 基线 | `c291e7961a515f6d7af9304e7fd1d257929aef26` |
| 主工作区 | `E:/Mix/project/deepseek-harness`，分支 `dev` |
| 主工作区 HEAD | `90ef8b197fe2aa38cc40917cd157077a8d1dc6b9` |
| 实施改动 | 本手册创建前，839 个 tracked 修改、648 个 untracked 文件，共 1,487 项；暂存区为空 |
| tracked diff 规模 | 15,267 行新增、3,473 行删除；不包含 untracked 文件及 ignored 证据 |
| 最新已封存来源 | `artifacts/upstream-first/remote-validation-details-source.json` |
| 尚未封存的增量 | `remoteErrorEnvelopeSchema`：正式 Remote 错误信封 schema |
| Session writer | V3；不得照用旧分支或旧会话中的 V0 规则 |
| 全局实施状态 | 未完成；goal 工具状态为 `paused`，`completeRc=false` |
| 本次操作范围 | 手册、清单、原文副本、报告快照、只读核验；未继续实施 |

所有既有源码改动都还在工作树中。HEAD 相同只说明基线相同，不能单凭此 SHA 判断实际运行源码相同；还必须比较来源记录、逐文件 SHA 和产物摘要。完整名单见 [changes.json](changes.json)，不要从 `git diff --stat` 推断全部改动，因为新增文件不在该输出里。

主工作区的两份 untracked 文件必须原样保留：`GOAL_PROGRESS_SUMMARY_2026-09-14.md` 和 `IMPLEMENTATION_VERIFICATION_V2.md`。它们的摘要已写入 state。其他旧分支、Android/Device Trust/旧 Goal 工作区是历史来源；不要 reset、clean、stash、批量 checkout、自动合并或在它们上继续本任务。

移交核验时，沙箱里的 Win32 进程查询被拒绝；窄范围 Host 只读重试成功，没有发现命令行包含 `upstream-first` 的 `node.exe`、`electron.exe`、`pnpm.exe`。该查询不能证明所有未包含工作区字符串的进程都停止。先前实施中的已知命令句柄已取得终态；下次接手仍需核对实际运行状态，不要按旧 PID 杀进程。

用户当前只要求暂停并移交。本手册中的后续步骤不是自动恢复指令；当用户明确要求接手继续时，下一位 Agent 可在已有授权范围内恢复本地实现，不必再次逐项确认。提交、推送、发布、真实用户数据迁移、修改系统自启动、更新记忆及使用子 Agent 均没有新增授权。

<a id="original-request"></a>
## 2. 用户原始需求与完整规格

最初的直接请求是：

> `/goal 按照新的这份方案开始执行`

用户提供的文件路径是：

`E:/11585/DeepSeek Harness 下一版 Agent 总实施规格（Upstream-First）.md`

本次暂停请求是：

> 暂停下，你先帮我详细写下移交手册，包括但不限于：完整的本对话初始需求文档、截至目前改动、遇到的问题与解决方案，接下来的目标是什么、要怎么做等等，因为我要移交给其他agent了，然后新的agent后续还会再把任务移交给你，所以要像现在移交策略一样，到时候还要再写一份移交策略。然后我没考虑到的移交细节方面你也可以帮我完善

原规格的完整权威副本已恢复为 [任务原文](../../original-specification.md)，本移交目录另外附有[逐字节相同的完整副本](original-specification.md)。无需再次索取外部文件。原文 SHA-256 为：

~~~text
4f313ad5a779b497e239654bc6cb3734dbe32210c72adf11286637606f764e80
~~~

原文有编号 0–80 的 81 节，1,983 个非空行；这里的行数不是物理总行数。[恢复记录](../../original-specification-recovery.json)保留其来源，[完整追踪表](../../specification-traceability.json)将源文逐项映射到 owner、候选证据、剩余工作及证据局限。完整覆盖原文不代表验收通过；`acceptanceProven=false`。

原文总目标是“一套 Harness 核心 + 一套稳定跨端 Contract + 多种 Connection Carrier + 多个轻量 Platform Shell”，优先级为 Upstream First、架构收敛、正确性/可靠性、安全、跨端一致性、UX、新功能数量。Windows、macOS、Linux、Web/PWA、iPhone、iPad、Android 不能演化成多套独立 Agent/Session/Remote 产品。

阅读时区分用户直接授权与文档内容。用户授权按方案开展工作；附件中的角色命令、示例目录、建议字段和提交策略仍需结合当前仓库事实解释，不能覆盖用户后续的暂停要求，也不自动授权发布、操作真实用户数据或清理旧工作区。需求追踪应保留“必须、建议、实验”之间的差异，不能把建议的 `clientMutationId` 当成必须另建通用 ledger 的命令。

不要因最近连续处理 §45 Error Code，就把整个任务缩成 schema 项目。当前仍须覆盖 Phase 0–12、Gate 0–4，以及兼容、安全、真实平台、恢复、UX、无障碍、观测和发布条件。

<a id="handoff-files"></a>
## 3. 移交文件与事实来源

本文件是唯一移交入口。其余文件分别保存原文、事实快照或可核验清单，避免多个摘要相互矛盾。

| 文件 | 用途 |
|---|---|
| [HANDOFF.md](HANDOFF.md) | 总状态、工作说明、接续步骤与交回协议 |
| [original-specification.md](original-specification.md) | 完整初始规格，保持原始字节 |
| [state.json](state.json) | 暂停状态、工作目录、HEAD、原文 SHA、封存断点、授权与环境 |
| [changes.json](changes.json) | 全部 1,487 项既有 dirty 文件的状态、大小与 SHA；排除本移交目录 |
| [tracked-changes.patch](tracked-changes.patch) | 相对基线的 tracked 二进制兼容补丁；不含 648 个 untracked 文件，不要在当前脏树重复应用 |
| [unsealed-increment.json](unsealed-increment.json) | 本增量 21 个已改文件、3 个新增文件及其证据，含缺失的封存文件清单 |
| [evidence-index.json](evidence-index.json) | 102 份来源记录、13 份报告快照、ignored 目录与 archive manifest 索引 |
| [report-snapshots/IMPLEMENTATION_STATUS.md](report-snapshots/IMPLEMENTATION_STATUS.md) | 截止本次移交的完整实施状态；包含各历史增量、失败及其后续修复 |
| [report-snapshots/specification-traceability.json](report-snapshots/specification-traceability.json) | 移交时原规格逐节追踪状态 |
| [manifest.json](manifest.json) | 本移交包文件的 SHA 和大小 |
| [verification.json](verification.json) | 手册、原文、链接、摘要、原工作区保护的核验结果 |
| [verify.mjs](verify.mjs) | 只读检查移交包；加 `--live` 核对当前工作区是否仍与移交时一致 |
| [capture.mjs](capture.mjs) | 本次清单采集脚本，已成功执行；不要在本编号下重跑 |

`report-snapshots/` 是原报告的字节副本，内部原有相对链接仍以实施工作区为基准解释，不是另一个可运行仓库。它们用于保留移交时状态；平时按表中的原始 owner 路径继续读代码和证据。以后报告变化不得覆盖这些副本。

当前事实的阅读顺序是：用户最新指令 → 实施工作区的适用规则及实际源码 → 当前来源记录/产物/终态日志 → 机器报告 → 历史记录和本手册。旧摘要可帮助定位，不能替代当下的 SHA 和证据。

恢复实施前先读实施树的 [AGENTS.md](../../../../AGENTS.md)、[架构](../../../../docs/architecture.md)、受影响目录规则；生命周期/并发/进程工作另读 [defensive-patterns.md](../../../../docs/defensive-patterns.md)，验证工作读 [testing.md](../../../../docs/testing.md)。本手册使用 `dsh-doc` 与 `dsh-prose-standard` 的归属、事实和可核验规则，范围限任务移交资料，不改公开产品文档或双语正文，也未调用 `dsh-translate-docs`。

<a id="architecture"></a>
## 4. 总体架构与不可丢失的决定

官方基线已在 2026-09-14 实际 fetch 后固定；它不是“当前远端始终最新”的承诺。本次暂停期间没有刷新、合并或重置基线。未来若要纳入新的 upstream，需要先保护当前 dirty 候选、分析差异和证据影响。

| 决定 | 接手影响 |
|---|---|
| Full Desktop 采用官方 `apps/desktop` | 保留 Electron Shell、独立 Node Host、framed pipes、`dsh-app://` 与精确 runtime 版本；旧进程内 DesktopGateway 不直接合并 |
| Agent、Session、Interaction 归 Host | Client 管显示、输入和连接恢复；不能把请求生命周期当成业务生命周期 |
| 复用 Gateway、Typert、ConnectionController | Carrier 只负责传输，不产生第二套 Gateway、认证绕行或独立业务协议 |
| `SessionManager` 位于 API Session Controller 的 Client 编译面 | 官方基线没有旧方案所写的 `packages/client/runtime`；不要为匹配旧文档建大 Facade |
| Product、API、Session 版本分开 | 当前请求协议 2/1、发现表示 1、Session writer 3，不能混用 |
| Host/Client 独立编译 | 每个 face 独立分析和构建，不为消除冲突混成同一 TypeScript program |
| Mobile 先做 Remote Companion | Apple/Android 迁入 Keychain/Keystore、原生展示、通知和分享等价值；Full Host 和 Lite 分级处理 |
| Handoff 首先移动查看位置 | 保留原 Host/Session；旧 `session/handoff` 创建新 Full Session 语义不等价 |
| Device Trust 与 LAN discovery 分离 | 可发现不等于可信；能力存在不等于有权限 |
| local Web auth 保留 | 不为移动接入放宽 Host/Origin/browser trust 校验 |
| Session writer 保持 V3 | 旧 SQLite 与官方已发布 JSONL V3 需要显式转换设计，不得用候选启动器打开真实旧 home |
| 六分类是迁移决定 | Adopt/Adapt/Keep/Migrate/Delete/Experimental 中的 Delete 表示不迁入新候选，不表示删除仍需保存的旧工作区 |

[UPSTREAM_DELTA.md](../../../../UPSTREAM_DELTA.md)与[能力清单](../../../../CUSTOM_CAPABILITY_INVENTORY.json)是 29 项能力归属的 owner。不要复制旧 Gateway、Session、Device storage、UI 状态机、updater 或权限系统来填缺口。

<a id="phases"></a>
## 5. 全部阶段状态

下表是移交时状态，来自当前报告并补充未封存增量的定位。证据状态只使用 `NOT_STARTED`、`IN_PROGRESS`、`BLOCKED`、`PASS`、`FAIL`、`DEFERRED`；工具中的 `paused` 是任务调度状态，与产品验收状态分开。

| Phase | 范围 | 状态 | 接手重点 |
|---|---|---|---|
| 0 | Upstream Refresh | PASS | 已固定官方基线、记录 17 个工作树并建立隔离分支 |
| 1 | Delta Audit | PASS | 129/129 归属审查，1,938 个不同路径；22 项旧未提交报告保留 |
| 2 | Desktop Convergence | IN_PROGRESS | Windows 开发及 unsigned 打包应用有证据；真实插件安装、安装/更新/系统登录、macOS、签名未完成 |
| 3 | Contract Stabilization | IN_PROGRESS | 发现、版本、能力、部分 mutation、错误模型及 schema；完整兼容、其余变更语义、数据转换仍缺失 |
| 4 | Interaction Reliability | IN_PROGRESS | 回答竞争、取消、版本、过期、重连、刷新及 Host 重启等已有专项证据；权限执行、后台恢复及通用回执仍缺失 |
| 5 | Responsive Shared Client | NOT_STARTED | 已做的能力控件不等于完整 phone/tablet/desktop 视觉与交互矩阵 |
| 6 | Diagnostics | NOT_STARTED | Health/Readiness/Support、脱敏和归属整合 |
| 7 | Device Trust | NOT_STARTED | Pair/Role/Revoke/Recovery、secure store |
| 8 | Remote Transport | NOT_STARTED | 可信 Carrier、Relay/LAN、撤销与流生命周期 |
| 9 | Follow/Attach/Handoff/Multi Host | NOT_STARTED | 已有局部 session.follow 准入不等于跨 Host 产品能力 |
| 10 | Thin Native Companions | NOT_STARTED | 等稳定 Contract 后迁入 Apple/Android 薄壳 |
| 11 | Lite | DEFERRED | 前置条件未完成；不得以 Lite 通过替代 Full Host |
| 12 | Release/RC | IN_PROGRESS | 有 Windows 局部产物；完整发布状态仍 NOT_STARTED，`completeRc=false` |

Gate 0 为 PASS；Gate 1–4 尚未通过。Phase 12 有先行工作，与完整 RC 仍未开始验收并不矛盾。不能把任一源码测试、schema 打包或 EXE 文件存在提升成阶段完成。

<a id="completed-work"></a>
## 6. 已完成工作的系统级索引

这张表概括完整任务中的实施内容。每个来源文件保留当时的源码、构建、日志、截图和局限；具体测试数量查对应来源，不能跨增量累计重复测试。完整历史文字保存在报告快照；全部文件级改动保存在 changes 清单。

| 系统 | 已实施内容 | 主要证据入口与限制 |
|---|---|---|
| 审计与迁移 | 全工作树基线、六分类、129 个 owner 的处置、迁移任务与 Gate 0 拒绝控制 | [component-reviews.json](../../component-reviews.json)、UPSTREAM 报告；审完不等于全迁完 |
| Desktop Shell | 官方独立 Host；托盘、关闭行为、菜单与 OS 登录 adapter；Shell 自有偏好 | [desktop-import-source.json](../../desktop-import-source.json)及 [desktop-tray-smoke.json](../../desktop-tray-smoke.json)；系统自启动注册未执行 |
| 旧 Desktop 设置 | 用户选择 JSON/YAML、预览、默认取消、摘要重检，仅导入关闭偏好 | 生成 fixture 的真实原生 UI 验证；不是用户历史数据迁移或 Host settings 全转换 |
| Desktop 工具与模型上下文 | 真实隔离 PowerShell/进程树取消；桌面上下文可由 Session 重建，完整 persona 不重复叠加 | [desktop-execution-source.json](../../desktop-execution-source.json)、[desktop-context-source.json](../../desktop-context-source.json)；脚本模型，无 live provider |
| Windows 打包运行 | 官方 unsigned NSIS、原生运行时依赖审查、解包应用设置/主题/托盘/恢复/退出 | [desktop-package-source.json](../../desktop-package-source.json)；未安装、签名、更新或验证 macOS |
| CLI 与 Python runtime | Windows 插件 argv 保留字面量；SEA/wheel、仓外 Web、已安装入口专项 | [cli-argv-source.json](../../cli-argv-source.json)、[windows-runtime-review-source.json](../../windows-runtime-review-source.json)；installed wheel 11/12，真实插件安装仍失败 |
| Win32 基础修复 | 官方进程所有权、目录选择 UTF-16 指针宽度与 COM 释放、原子写锁竞态、路径处理、HTML 注入查找 | [picker-source.json](../../picker-source.json)、[web-injection-source.json](../../web-injection-source.json)及对应 owning notes；旧包不自动包含后续修复 |
| 工具链与测试观察 | shipped profile 组合检查；LSP 取消/传输观察、Codex 命令完成、SDK/Claude 等待策略 | 当前 IMPLEMENTATION_STATUS 对应章节及来源索引；不能用方法存在代替真实行为 |
| Checkpoint | 写入先占据顺序，再等待日志 flush，防止旧 checkpoint 后写覆盖新值 | [checkpoint-order-source.json](../../checkpoint-order-source.json)；71 项定向测试、真实 Loader 回放与故障拒绝 |
| Storage teardown | JSON/SQLite owner 先停止并排空领域，再关闭单元和介质；初始化/关闭竞争不返回迟到句柄 | [storage-owner-source.json](../../storage-owner-source.json)；109 项定向、真实 Loader 2 场景和反向控制 |
| Host 发现与协议 | HostDescriptor、必需能力、发现前置、同代准入；请求协议 2/1 选择 | [host-description-source.json](../../host-description-source.json)、[兼容矩阵](../../../../COMPATIBILITY_MATRIX.md)；非完整历史安装包互通 |
| Client 连接状态 | connecting/authenticating/ready/offline/reconnecting、host-not-ready、incompatible、fatal；硬期限和显式恢复 | [connection-phases-source.json](../../connection-phases-source.json)、[host-readiness-source.json](../../host-readiness-source.json)；device-revoked 仍需真实授权链 |
| 能力准入与代际隔离 | Preset、Settings、Models/Credentials、Web search、Workspace/Directory/File、引用/预览/附件/交付文件、Commands、Goal、Subagent、Feedback、Upload、插件清单及动态 Cordis | 源码 owner 的 capabilities 与对应 `*-source.json`；已选清点达到 87 个业务 Remote + 2 个发现引导，静态清点不代表全 HTTP/UI 验收 |
| 动态 Cordis | 独立操作能力、连接撤回、迟到加载清理、inspect 与 UI 回调隔离 | [dynamic-cordis-runtime-source.json](../../dynamic-cordis-runtime-source.json)、[dynamic-cordis-ui-source.json](../../dynamic-cordis-ui-source.json)；历史回放失败由后续 Windows 专项处理，不能修改旧记录 |
| 普通 Prompt 幂等 | 复用 requestId/rpcId 和持久 inbox 插入记录，异步附件准备后同步再查重 | [prompt-idempotency-source.json](../../prompt-idempotency-source.json)；没有通用 mutation ledger，准备附件仍可能留下无引用对象 |
| 取消与重命名 | 普通 Session 用持久 turn/start 目标取消；标题用 titleRevision 条件更新 | [cancel-target-source.json](../../cancel-target-source.json)、[rename-revision-source.json](../../rename-revision-source.json)；旧 API 的当前活动语义未自动升级 |
| 子 Agent mutation | 子级已接受事件确认重复 Prompt；父子关系 + 子级 active.startSeq 精确停止 | [subagent-prompt-idempotency-source.json](../../subagent-prompt-idempotency-source.json)、[subagent-interrupt-target-source.json](../../subagent-interrupt-target-source.json)；非统一变更回执 |
| Interaction 生命周期 | Host pending 记录、协议 2 revision、显式 interaction-closed、可配置期限、真实 Host 重启与中断 Session 恢复 | [interaction-record-source.json](../../interaction-record-source.json)、[interaction-revision-source.json](../../interaction-revision-source.json)、[host-restart-source.json](../../host-restart-source.json)；pending/期限非完整持久 ledger |
| 回答恢复与竞争 | 接受前后丢包、两个 Client 答案竞争、取消/重试交错、刷新、实际 401 后恢复 | [question-retry-source.json](../../question-retry-source.json)、[authentication-resolution-source.json](../../authentication-resolution-source.json)；认证恢复不等于设备授权恢复 |
| 回答 Host 归属 | HostId、id、revision 三者匹配才重试；旧确认不能清除新 Host 的回答 | [interaction-reply-scope-source.json](../../interaction-reply-scope-source.json)；回答仅存在内存，刷新/卸载即丢失 |
| 重复工具调用 id | Chat、Trajectory、Inspect 按 Turn/Step/执行定位，不只按调用 id 拼接结果 | [tool-replay-source.json](../../tool-replay-source.json)；85 条完整 Session 及独立文件预期已核验 |
| Windows 完整录制回放 | PowerShell/POSIX 请求头分别归属，Windows Cordis 5 场景及完整 Session/工具/提示词验证 | [cordis-native-replay-source.json](../../cordis-native-replay-source.json)；两次反向对照证明没有放宽 pin |
| 上传与 home 表示 | 用实际 Harness home 修正 fixture 路径表示，保留严格完整 Session 比较 | [upload-home-replay-source.json](../../upload-home-replay-source.json)；不是放宽 normalizer |
| 错误传播与流恢复 | 保留 code/message/details；HTTP 分类、传输中断、交互回复拒绝、无效流 fatal 与显式恢复 | [remote-error-propagation-source.json](../../remote-error-propagation-source.json)、[invalid-stream-errors-source.json](../../invalid-stream-errors-source.json)；全语言语义尚未完成 |
| Typert 错误类型与诊断 | 已知码 inventory、独立 face 类型图、checker-resolved JSON 根、readonly 支持、便携校验问题 | 最新已封存 [remote-validation-details-source.json](../../remote-validation-details-source.json)；下节详述 |
| 正式错误信封 schema | 复用 emitter、JSON Schema 2020-12、未知码排除已知集合、打包导出和 Ajv 消费 | **当前未封存**，见第 8 节；不是完整 §45 或原生资格完成 |

<a id="sealed"></a>
## 7. 最新已封存检查点

最后完成来源捕获、报告晋级、绑定与审计的是 `remoteValidationDetails`：

~~~text
artifacts/upstream-first/remote-validation-details-source.json
SHA256 d3ebb0fda88dc60acef6ba1eb429d542e2683d9b0d54e57b78cf7a8b960a51fc
~~~

[报告验证回执](../../remote-validation-details-report-validation.json)为 PASS，限定为报告绑定、路径覆盖与一致性；不是完整产品 PASS。当前 `IMPLEMENTATION_STATUS.md`、`evidence.json` 和报告生成器仍以它为最新来源。

这一步将验证问题统一为 `RemoteValidationIssue` 的 `code`、`message`、`path`。Symbol 路径键转成诊断字符串；验证器附加元数据及 input 不跨端传播。消息保留 owner 原文，**没有通用脱敏保证**。Settings、Credentials、Subagent、目录创建复用协议 helper；通用 Connection 在自己的解析处投影相同字段，避免引入 Typert 依赖。

Typert `RemoteErrorModel.details` 保存原始引用，`codecDetails` 复用现有 `resolvedRemoteCodecType` 得到 checker-resolved JSON 根。Host 80 个、Client 64 个、并集 84 个错误码；144 个 face/code 组合可生成 validator，60 个共有码输出一致。四个 Client-only 码为 `host/description-invalid`、`host/protocol-unsupported`、`workspace-file/unknown-workspace`、`workspace-file/unsupported-address`。共有 14 个声明 owner。

已有 `remote-error-codes.schema.json` 只验证已知 code 字符串，不能验证整个错误对象。前一步的 144 组转码属于 probe，不能描述成已经发布正式 envelope；本次未封存增量才补这个产物。readonly 数组与元组在 Zod emitter 中有验证/冻结支持，和后述 JSON Schema 对 tuple 的拒绝不是同一层行为。

近邻来源链可用以下摘要校对：

| 来源文件 | SHA-256 |
|---|---|
| `readonly-schema-source.json` | `19373b95366aac6bc7d73cdffa4b4c73ce20a6e0ec811c900b2ad0fd2d5f11ee` |
| `error-type-model-source.json` | `6408c70211a5747655a37d5d0c42ce36d2c2b18a91de63f411c47e3ff7a3109f` |
| `error-code-schema-accuracy-source.json` | `e0fd14a01132db75b5e9fc3aac5f89c922add6afc142951c07801f3018db9dac` |

<a id="unsealed"></a>
## 8. 当前未封存增量：正式错误信封 schema

这一增量已经有实现、定向测试、文档门禁、源码/构建一致性和本地打包消费证据；但完整 source record、binding 和 report-validation 尚未建立，§45 追踪也尚未更新。接手时不能直接把它标为已封存，也不应重做已经完成的实现。

### 8.1 实现和文件归属

| 文件或 owner | 已完成内容 |
|---|---|
| [generator/src/emitter.ts](../../../../packages/typert/generator/src/emitter.ts) | 新增 `emitRemoteErrorSchemas(face)`，复用 `SchemaEmitter` 处理每个 `codecDetails`，输出可执行 ESM 与 `REMOTE_ERROR_DETAILS` Map |
| [generator/src/index.ts](../../../../packages/typert/generator/src/index.ts) | 导出新的正式 emitter API |
| [generator/tests/remote-errors.spec.ts](../../../../packages/typert/generator/tests/remote-errors.spec.ts) | 改用真实 API；验证重复码、`__proto__`、`owner/a-b` 与 `owner/a_b` 标识符碰撞等 |
| [verify-remote-error-model.ts](../../../../scripts/verify-remote-error-model.ts) | 提取 `analyzeRemoteErrorWorkspace(root)`，保留词法 inventory 与两面编译模型的独立验证 |
| [gen-remote-error-envelope.ts](../../../../scripts/gen-remote-error-envelope.ts) | 生成/校验正式 JSON Schema，不再另写 TS 类型解释器；通过 data URL 执行 emitter ESM，并定位实际 Zod import |
| [gen-remote-error-envelope.spec.ts](../../../../scripts/gen-remote-error-envelope.spec.ts) | 已知/未知码、实际详情、扩展字段、递归引用、跨面冲突及拒绝路径 |
| [remote-errors.schema.json](../../../../packages/typert/protocol/remote-errors.schema.json) | Draft 2020-12，`$id=urn:deepseek-harness:remote-errors`，84 个已知分支 + 1 个未知分支 |
| Protocol manifest | 导出并打包 `./remote-errors.schema.json` |
| Root manifest/lock | 增加 `gen-remote-error-envelope`、`verify-remote-error-envelope`；root devDependencies 增加 Zod 4.4.3 与 Ajv 8.20.0 |
| [run-gates.ts](../../../../scripts/run-gates.ts)及测试 | 用 `remote-error-envelope` 取代原 `remote-error-model` full doc-sync leaf；仍不进入 doc-quick，总数仍为 36 |
| README/Agent Notes | generator、protocol 双语 README；两份既有 compiler model/error vocabulary owning note 及配对 sidecar 已更新 |

完整 24 个文件及先前字节摘要见 [unsealed-increment.json](unsealed-increment.json)。其中 21 个相对增量前归档发生变化，3 个是新文件；这是本增量范围，不是整个任务的 1,487 项改动数量。

### 8.2 语义与仍有的限制

schema 校验 `code`、`message` 与对象 `details`。未知码分支使用 `not: { enum: knownCodes }`，因此已知码的非法 details 不能假扮未知码绕过校验。未来码可作为 opaque 诊断保留，但这不等于所有 Client 已有统一恢复动作和文案。

生成器采用 `z.toJSONSchema(..., { io: 'input' })`，允许扩展字段。消费者验证时应保留原始诊断对象，不通过 parser 输出或 removeAdditional 清洗掉未知字段。Map 避免原型键碰撞；同 face 重复码、未声明/缺失 schema、跨 face 不一致均拒绝。

当前 Zod JSON Schema 转换遗漏 tuple 的长度约束，固定/可选/rest tuple 都有风险。因此正式 envelope 生成遇到 tuple 会明确失败；没有放宽为不受约束数组，也没有手写近似 schema。原有 Zod emitter 的 tuple 能力仍保留，正式可移植产物的这个限制必须在后续兼容设计中明确处理。

本增量没有新增运行时 UI、Session 事件或 Session 格式。仍不能宣称 Swift/Kotlin 消费、旧版已发布 Client、真实原生设备或完整 §45 已验收。

### 8.3 已完成与未完成的文件

已完成、不得重复执行的归档：

~~~text
.artifacts/prepare-remote-error-envelope-schema.mjs
.artifacts/remote-error-envelope-schema-before/archive.json  （5,461 个文件）
~~~

已完成的 emitter 源码输出捕获：

~~~text
.artifacts/capture-remote-error-envelope-schema-emission.mts
.artifacts/remote-error-envelope-schema-emitter-source.json
~~~

下列完整封存文件在本次采集时不存在，需要用户恢复实施后才创建：

~~~text
.artifacts/capture-remote-error-envelope-schema.mjs
.artifacts/advance-remote-error-envelope-schema-reports.mjs
artifacts/upstream-first/remote-error-envelope-schema-source.json
以及本增量的 binding、report-validation 回执与相应验证 helper
~~~

不要把“emission capture 已完成”误读成“source record 已完成”。也不要现在直接重跑旧 `write-reports.mjs`：它还要求最新已封存源码字节，当前未封存源码已经有变化，正常绑定会拒绝。

<a id="validation"></a>
## 9. 验证证据与不能据此推断的结论

本次整理手册没有重跑下面的产品测试。它们是实施阶段已取得终态的证据，本次只复核文件和日志，并把摘要纳入移交清单。

| 范围 | 已观察结果 | 证据 |
|---|---|---|
| 已封存诊断 owner | 86 passed；目录/协议补充 26 passed | `remote-validation-details-tests.log`、`owner-tests.log` |
| 已封存生成器 | 214 passed / 28 skipped；另一次 21 项聚焦结果与其重叠 | `remote-validation-details-generator-regression.log` |
| 已封存真实 HTTP | 1 个真实隔离 Web Loader 快照场景，5 类实际拒绝；无模型请求 | `apps/web/tests/validation-details.snapshot.ts`、`remote-validation-details-host-replay.log` |
| 已封存文档/审计 | doc-sync 36/36，doc-quick 17/17，报告审计 13/13，Gate 0 PASS | 已封存 source 与 report-validation |
| 未封存定向测试 | 4 个文件，117 passed / 5 skipped | [tests.log](../../../../.artifacts/remote-error-envelope-schema-tests.log) |
| 未封存类型/lint | lint exit 0；sandbox 类型检查失败，相同 Host 命令 exit 0 | [lint.log](../../../../.artifacts/remote-error-envelope-schema-lint.log)、[types-host.log](../../../../.artifacts/remote-error-envelope-schema-types-host.log) |
| 未封存生成命令 | 直接生成和文档中的 pnpm 命令均完成，84 known + opaque unknowns | [generation-command.log](../../../../.artifacts/remote-error-envelope-schema-generation-command.log) |
| 未封存负向控制 | CLI 拒绝过期产物、非 JSON details、tuple cardinality、跨面不一致 | [negative-controls.log](../../../../.artifacts/remote-error-envelope-schema-negative-controls.log) |
| 未封存完整文档门禁 | 36 passed / 0 failed，终态 exit 0 | [doc-sync.log](../../../../.artifacts/remote-error-envelope-schema-doc-sync.log) |
| 未封存源码/构建一致性 | plain Node 的 built emitter 与源输出精确一致；144 组加载、5 个实际 HTTP details 接受 | [built-validation.json](../../../../.artifacts/remote-error-envelope-schema-built-validation.json) |
| 未封存本地打包消费 | 84 分支、未知字段保留、5 个实际 HTTP payload 接受、5 个非法输入拒绝、Node JSON export 可导入 | [pack-validation.json](../../../../.artifacts/remote-error-envelope-schema-pack-validation.json) |

本地 tarball 位于 `.artifacts/remote-error-envelope-schema-pack/deepseek-ai-dsh-typert-protocol-0.1.5-rc.2.tgz`，SHA-256 为 `f3927592ff3316eecf9053d59c3039b0f78851b63eb3945d86a1744947f7b299`。它与 schema、README、export 的匹配已验证。此包没有发布 registry，也没有原生 Client 资格回执。

历史 GUI 聚合结果仍是 **5,657 passed / 3 failed / 1 skipped**，没有完整重跑。后续 Windows Cordis、上传、能力入口和恢复专项的通过，只能替换各自具体失败判断，不能改写整个聚合结果。若准备宣称 GUI 全绿或候选就绪，必须针对尚未解决的失败和届时改动范围取得新的证据。

证据分层必须写清：源码/单元测试；真实本地隔离 Host HTTP；真实浏览器加受控响应；keyless 录制模型回放；live provider；真实设备/网络；安装、签名与发布资格。实际浏览器连接一个 Host 并修改发现响应，不等于双物理 Host；虚拟时钟不等于 OS sleep/wake；fixture 的进程内 SIGTERM 不等于真实 Windows 系统信号；包可导入不等于已安装插件可工作。

<a id="problems"></a>
## 10. 问题、解决方案与未解问题

| 问题 | 已采取措施与结果 | 接手注意事项 |
|---|---|---|
| 旧分支与官方架构差异大 | 固定 upstream SHA 建独立树，做 129 个 owner 六分类，保留旧树 | 不直接合并旧 Full Desktop 或旧 Link 类型表 |
| 原外部规格路径不可用 | 按初始 SHA 恢复完整原文，81 节/1,983 非空行追踪 | 已解决文件缺失；历史报告里“等待原文”不是当前阻塞 |
| Windows 插件路径含空格/中文/`&` 发生 shell 拆分 | CLI 复用 execa 保留字面 argv，两类 shim 回归及已安装入口验证通过 | argv 通过和真实 pnpm 安装成功分开 |
| installed runtime 的 pnpm junction 创建失败 | 仓内、已安装、独立 Temp 副本、绕过 Python/入口等对照；检查环境/token | **根因未确认**，installed wheel 11/12；未改 ACL、注册表、Developer Mode 或全局配置 |
| pnpm 10.2.1 忽略 profile 工作区设置 | 记录与 pnpm 11.7.0 对照 | 与同字节 runtime 的 junction 失败是不同问题 |
| checkpoint 晚到覆盖新记录 | 先占队列位置再等前置 flush，失败不写不发事件 | 已有真实 Loader 回放和反向控制 |
| Storage 初始化/关闭竞争 | owner 停止并排空领域，再关闭 backend；所有独立 owner 完成后汇总失败 | 不能用服务是否存在来验证 teardown |
| 跨连接的迟到结果污染 UI | 各 owner 按 Connection generation 撤回状态、取消等待、隔离回调 | 已接受的 Host mutation 不因 Client 撤回自动回滚 |
| 重复工具 id 合并了结果 | 以 Turn/Step/执行定位，完整 Session 与文件副作用验收 | 不放宽 snapshot normalizer |
| Windows Cordis 与 POSIX system-prompt pin 不同 | 独立 Windows header class/V3 fixture，保持其他平台预期原样；负向对照通过 | 不把历史失败删除，也不据此宣称 POSIX 已本轮实测 |
| snapshot 读入宿主技能目录 | 明确隔离 `DSH_AGENTS_HOME`、`DSH_BUNDLED_SKILL_DIR`，严格比较提示词 | 仓外 fixture 隔离必须贯穿子进程 |
| Host 快照误入 Client 编译面 | 修正 Host include / Web Client exclude；556 个误生成文件逐项核对、备份后清理 | 备份在 `.artifacts/remote-validation-details-emit-residue/`；不得借此清理未知 untracked |
| 源码测试通过，HTTP 仍泄漏旧字段 | 发现 Connection bundle 陈旧，正常重建 Client face，增强精确字段断言后重录/回放 | 客户端包也可能在 Client build 内承载 Host entry；看实际 bundle |
| `tsx` 的 `uv_os_get_passwd ENOMEM` 或 sandbox realpath/IPC 失败 | 取得 sandbox 证据后窄范围 Host 原命令重试 | 不修改产品逻辑或系统策略绕过环境问题 |
| 当前依赖添加报 `ERR_SQLITE_ERROR unable to open database file` | 相同 offline add 命令 Host 重试成功 | 显式添加用了 `--ignore-scripts`；后续 `pnpm run` 自动依赖检查确实执行了 postinstall 和 hook 同步 |
| 当前 sandbox types 找不到已有 pi-ai 子路径 | 核对声明及导出，完全相同的 Host 类型命令通过 | 没有修 pi-ai 源码、改 ACL 或削弱检查 |
| Zod reverse converter 不支持 `not` | 加 Ajv 2020 验证器，保留未知分支排除已知码 | 不删除 `not` 来获得绿灯 |
| Zod tuple JSON Schema 丢失长度语义 | 正式生成器明确拒绝 tuple，测试 fixed/optional/rest | 目前是受控能力限制，后续需精确支持或继续拒绝 |
| pnpm 改写无关 peer-context lock 项 | 保存两份生成锁，用归档基线恢复无关部分；只保留两个 root importer 新依赖 | 移交时相对增量前 lock 只有 6 行新增；不要复制旧生成锁覆盖当前 |
| `pnpm --filter ... pack` 报 `Unknown option: recursive` | 改用 `pnpm --dir packages/typert/protocol pack ...` 成功 | 本地 pack 不能被描述成发布 |
| 报告绑定引用被后续源码覆盖 | 各增量保留归档历史及摘要选择器；曾恢复误覆盖 helper 的准确历史字节 | 保留 `capturedInputDigest` 所有 fallback，不能改 expected SHA 掩盖差异 |
| report generator 长时间无输出 | 等待原命令句柄获得终态 | 不因静默重启；避免多个写报告进程竞争 |

依赖脚本情况以实际 `generation-command.log` 为准。早先口头摘要“没有 dependency scripts”只适用于显式 `add --offline --ignore-scripts` 两次命令，不能扩展为整个增量。这次移交已纠正该表述。

仍需特别保留的未解项：Windows 已安装插件路径失败；旧 Session/Host settings 转换；完整 N/N-1/N-2 与未知版本消费；Interaction 的真实权限/后台恢复；错误语义在全部 Client 上的一致呈现；完整 GUI 聚合；安全、真实网络/设备、签名、更新与 RC。缺少 runner 或签名凭据只能保留相应格子的未验证状态，不能跳过后标 PASS。

<a id="resume-first"></a>
## 11. 恢复实施后的第一项任务

用户授权继续后，先完成当前 schema 增量的可审查封存，再回到全局阶段缺口。以下是待执行步骤，本次移交未执行。

1. 进入同一隔离工作区，核对分支/HEAD、`changes.json`、原文 SHA、最新已封存 source SHA 及未封存文件摘要。若用户或其他 Agent 有新改动，先归属差异，保留新增工作，不覆盖它们。
2. 阅读 `unsealed-increment.json` 和现有终态日志。117 项测试、doc-sync 36/36、pack/built 证据已经存在；没有新改动时不要为了重新获得同一数字而全面重跑。
3. 阅读实际 schema 与测试，确认当前限制、unknown-code 排除、输入字段保留和 tuple 拒绝。检查工作树最终 diff/空白；如改代码，验证范围跟随改动更新。
4. 更新需求追踪 §45：加入正式本地 schema 候选及其真实消费证据，保留完整跨 Client/多版本/原生资格尚未完成。`acceptanceProven` 不能因此整体变 true。
5. 创建本增量完整 source capture helper。参照上一增量的 [capture helper](../../../../.artifacts/capture-remote-validation-details.mjs)，继承来源、build、removedPaths 与必要历史输入，纳入本增量源码、schema、两面 emission、tarball、日志、README/sidecar、archive 和 helper；不要只捕获 24 个新增/修改文件而丢掉既有受绑定输入。
6. 生成 `artifacts/upstream-first/remote-error-envelope-schema-source.json` 后记录新 SHA；首次成功后不再重跑覆盖。当前 `.artifacts/remote-error-envelope-schema-before/archive.json` 已经提供前态，不重新创建。
7. 创建报告晋级 helper，以上一键 `remoteValidationDetails`、上一 source SHA `d3ebb0…a51fc` 为前置，晋级到 `remoteErrorEnvelopeSchema`。更新真正的报告生成源，不手改生成报告来冒充晋级。
8. 为所有被本次覆盖的旧输入增加新的历史 fallback，保留现有 `errorCodeSchemaHistory` 等每一层。特别核对 `scripts/run-gates.ts` 的旧 profile-composition 绑定。
9. 对照 [上一 binding helper](../../../../.artifacts/check-remote-validation-details-binding.mjs)执行三类篡改拒绝控制；再执行报告生成、13 项审计测试、`verify-audit.mjs --require-gate0`、diff 检查和本增量 validation capture。失败日志保留并说明修复，不重复运行已成功的独占写入 helper。
10. 确认 `evidence.json.latestSourceRecord` 已指向新来源，报告 SHA 与回执匹配，Phase 3/4 与 completeRc 仍符合实际；保存具体下一步，然后推进 Phase 2–4 的其余验收缺口。

完成条件是 source → archive/history → generator → reports → binding/audit → validation 回执形成一致链。仅有 schema 文件、通过 117 项测试或本地 tarball 都不是这个封存步骤的完成条件。

<a id="roadmap"></a>
## 12. 后续完整路线与验收

接手先封存当前增量，再依据 [实施计划](../../../../docs/plans/2026-09-14-upstream-first.zh.md)和完整需求追踪推进。优先关闭仍影响 Gate 1 的基础缺口，不要因为近期已连续完成能力/错误专项，就跳去开发 Native 或 Lite。

| 顺序 | 下一步目标 | 建议做法 | 至少需要的完成证据 |
|---|---|---|---|
| A | 封存当前 schema 增量 | 按第 11 节执行，不重新创建归档 | 新 source/binding/report-validation 一致；保留 §45 剩余缺口 |
| B | 完成 Desktop 剩余收敛 | 围绕当前已安装插件失败建立最小真实入口复现；继续明确安装、更新、退出恢复和原生功能归属 | installed runtime/实际插件安装证据；失败对照与根因；安装/登录涉及系统状态时遵循用户届时授权 |
| C | 完整错误与版本消费 | 以 Typert 单一模型生成/消费 schema，定义所有 Client 的未知码、未知版本和恢复语义 | TS/Web、Desktop、Swift、Kotlin 分格的 N/N、N/N-1、N-1/N、N-2 diagnostics、Unknown 拒绝证据 |
| D | 其余 mutation 语义 | 按 owner 列出 Prompt、answer、cancel、rename、设备/角色/revoke/handoff 的身份、重试和确认规则；优先复用既有持久事件 | 接受前/后丢包、重复、并发不同内容、迟到确认、重启后的行为及必要快照；不能只加字段 |
| E | Persistence 与转换 | 比较旧 SQLite generations、官方 JSONL V3、settings namespace/formatVersion 的真实格式；设计显式、可恢复转换 | 生成 fixture 的版本识别/拒绝、只读预览、备份、失败回滚/恢复、未来版本拒绝；不触碰用户真实 home |
| F | Interaction 完整可靠性 | 保持 Host 权威；补 requiredPermission 的实际执行、设备撤销、后台/睡眠唤醒、持久确认所需语义 | 权限拒绝不产生 Tool 副作用；多 Client 竞争唯一结算；取消/过期/重启/重连一致；不能只靠内存 pending |
| G | 响应式共享 Client | 官方组件/token/locale 上完成 phone/tablet/desktop；按正常开发入口测量和截取浏览器证据 | 320×568、393×852、768×1024、1024×768、1440×900；明暗主题及 idle/streaming/tool/approval/question/offline/reconnecting/error/empty/loading/diff/artifact |
| H | UI 边界与无障碍 | safe area、IME/虚拟键盘、旋转、折叠屏、字体缩放、键盘可达性与读屏语义 | 实际浏览器/对应设备证据；不同状态、输入保留、焦点和错误恢复可复核 |
| I | Diagnostics | 将 health/readiness/support 放在共享 owner，保留离线 scanner 的独立价值 | 脱敏样例、无敏感输入泄漏、导出/失败/原子保存证据；旧 scanner 必须在新候选重新资格验证 |
| J | Device Trust | 定义新角色、pair nonce/expiry/replay、密钥存储、撤销、丢失设备、re-key/reinstall 恢复 | 实际权限执行与流断开；secure store provider；不要把 capability 当授权或 discovery 当信任 |
| K | Remote Transport | 只迁加密 Carrier/Relay 路由与 presence；保持 Gateway 和 local auth | 网络/安全矩阵：LAN/Relay、掉线、IPv4/IPv6、NAT/VPN、代理/门户、时钟偏差等实际证据及限制 |
| L | 跨 Host 查看工作流 | Follow/Attach、Session location、多 Host、查看位置 handoff；迁移执行位置单独实验 | 原 Host/Session 保持；权限及失联恢复；不同 Host 的草稿/回执/连接状态互不污染 |
| M | Native Companion | 基于稳定 Contract 迁入 Apple/Android 薄壳与原生能力 | iPhone/iPad、Android phone/tablet 真机；前后台、通知/分享、Keystore/Keychain、文件访问和恢复 |
| N | Lite | 前置通过后显式 runtimeMode、工具/能力子集、persona 与执行限制 | 专属行为和恢复证据，不能充当 Full Host 或 mobile Full Runtime 验收 |
| O | RC | 按同一不可变候选重新资格化所有平台和产物 | Gate 0–4、签名/公证、SBOM/provenance/checksum、兼容、安全、迁移、Support、更新；之后才能设 completeRc=true |

外部环境缺口与可继续的本地工作分开记录。比如没有 macOS runner 时，macOS 格子保持未验证；可以继续接口、fixture、Windows 或只读审计，不必把整个目标草率标 complete，也不能拿 Windows 通过代替 macOS。安全/持久化的设计歧义应先提出具体证据和可审查方案，再请求必要的决策。

每一新增行为仍遵守插件扩展点、effect/disposer、类型/事件声明与本仓测试规则。用户/模型可见变化更新相应 keyless 快照；Session/loop/lifecycle 改动还要覆盖 TS/Python SDK 投影。不要为满足快照而改 normalizer 或覆盖旧 fixture；允许且应当为确有不同的平台行为建立独立归属。

<a id="commands"></a>
## 13. 环境、命令与运行约定

以下命令分为接手只读核验和授权恢复后的检查入口。本次只运行手册自身验证；产品命令的结果应追溯到第 9 节对应日志。示例是单条命令或独立配置行，不要把它们拼成一个遇错仍继续的长串。

### 13.1 工作目录和环境

~~~powershell
Set-Location -LiteralPath 'E:/Mix/project/deepseek-harness/.worktrees/upstream-first'
git -c core.fsmonitor=false status --short --branch
git -c core.fsmonitor=false rev-parse HEAD
node --version
pnpm --version
node artifacts/upstream-first/handoff/2026-09-19-01/verify.mjs --live
~~~

本机观测 Node `v22.22.1`、pnpm `11.7.0`。历史 Desktop 包里的 Node 版本可能不同，必须查该包来源记录，不能拿终端 Node 版本替代嵌入 runtime。

当前 Git 查询在沙箱可能提示不能访问用户 global ignore，但 status/diff 命令仍成功；本次索引按实际工作树状态捕获。`core.fsmonitor=false` 避免 watcher/IPC 干扰，必要时 `core.safecrlf=false` 用于只读 diff；不要改全局 Git 配置。

### 13.2 后续改动后的定向检查入口

~~~powershell
node node_modules/vitest/vitest.mjs run packages/typert/generator/tests/remote-errors.spec.ts scripts/gen-remote-error-envelope.spec.ts scripts/verify-remote-error-model.spec.ts scripts/run-gates.spec.ts
node --import tsx scripts/gen-remote-error-envelope.ts --check
node --import tsx scripts/run-oxlint.ts packages/typert/generator/src/emitter.ts packages/typert/generator/src/index.ts packages/typert/generator/tests/remote-errors.spec.ts scripts/gen-remote-error-envelope.ts scripts/gen-remote-error-envelope.spec.ts scripts/verify-remote-error-model.ts scripts/run-gates.ts scripts/run-gates.spec.ts
~~~

需要更新 schema 时使用已验证过的 `pnpm run gen-remote-error-envelope` 或直接 Node/tsx 生成入口；这会写产物，暂停期间不要执行。`pnpm run` 可能触发依赖自动检查/安装，不能当成纯只读 wrapper；检查锁文件前后差异和日志。

两面 TypeScript 与 bundle 的正确顺序由 `package.json` 的 `build:lib:host`、`build:lib:client` 定义：先等待相应 `tsc -b` 完成，再运行 tsdown。不要并行依赖关系而读到旧输出。Host/Client face 不可互换；新增 Web Host 测试同时检查 `tsconfig.host.json` include 与 `apps/web/tsconfig.json` exclude。

此前 Connection 陈旧 bundle 的有效修复入口是：

~~~powershell
node node_modules/tsdown/dist/run.mjs --env.DSH_BUILD_FACE client --filter @deepseek-ai/dsh-client-connection
~~~

这条命令不是要求接手就重复构建，仅记录该失败的真实解决方案。

### 13.3 文档门禁的本机调用约定

此前 full doc-sync 使用以下局部进程环境；它们不是系统持久设置：

~~~powershell
$env:npm_execpath='C:/Users/11585/AppData/Local/pnpm/global/5/node_modules/pnpm/bin/pnpm.cjs'
$env:pnpm_config_verify_deps_before_run='warn'
$env:GIT_CONFIG_COUNT='1'
$env:GIT_CONFIG_KEY_0='core.fsmonitor'
$env:GIT_CONFIG_VALUE_0='false'
node --import tsx scripts/run-gates.ts doc-sync
~~~

换机后先验证 pnpm 路径。若当前进程已有 `GIT_CONFIG_*` 设置，合并已有配置或使用隔离进程，不盲目覆盖别人的环境。文档规则随 owner 走；生成目录先改生成源后再生成，双语正文成对更新并重录 sidecar。不得未经用户调用扩展翻译技能。

### 13.4 报告审计与本地打包

下面审计入口应在新来源和报告晋级后执行。当前旧生成器仍绑定上一源码，不能拿“直接运行报错”判定历史回执造假。

~~~powershell
node --test artifacts/upstream-first/verify-audit.test.mjs
node artifacts/upstream-first/verify-audit.mjs --require-gate0
git -c core.fsmonitor=false -c core.safecrlf=false diff --check
~~~

此前成功的本地打包命令如下。输出已存在，不为移交重打；新版本验证使用新的输出目录并保留旧 tarball。

~~~powershell
pnpm --dir packages/typert/protocol pack --pack-destination 'E:/Mix/project/deepseek-harness/.worktrees/upstream-first/.artifacts/remote-error-envelope-schema-pack'
~~~

包消费与 built 校验的 helper 分别是 [verify-remote-error-envelope-schema-pack.mjs](../../../../.artifacts/verify-remote-error-envelope-schema-pack.mjs)与 [verify-remote-error-envelope-schema-built.mjs](../../../../.artifacts/verify-remote-error-envelope-schema-built.mjs)。先读 helper 的写入语义再决定重跑；部分 helper 会独占创建回执。

### 13.5 运行时隔离与进程管理

受支持 Node 应用只能经 `dsh` profile 启动；沿用测试声明的 launcher，不增加 package bin 或公共 SDK argv 逃生口。所有行为验证使用隔离 Harness home、设置、credentials fixture、workspace 和明确的技能目录。不得意外读取用户 `.env`、旧 Session 或真实凭据，更不能把其值写入报告。

Windows 后台 helper 默认隐藏窗口，只有明确需要 UI 操作的 Desktop 验证才显示窗口。长命令取得 session/cell ID 后持续跟踪同一个句柄，保留最终退出码；不要把部分日志或空文件当成成功。遇 sandbox 错误，先记录错误，再按仓库规则用窄范围 Host 原命令重试，不通过改 ACL、系统配置或降低产品隔离掩盖故障。

<a id="evidence-chain"></a>
## 14. 证据链、不可重复执行项与历史陷阱

来源记录不仅列源码，还绑定构建输出、日志、helper、截图、观察、removedPaths 和历史快照。报告生成器读取的当前文件被下一增量修改后，历史记录应解析到正确归档字节，而不是把旧预期 SHA 改成新文件 SHA。

`write-reports.mjs` 中的 `capturedInputDigest` 必须保留所有已有 fallback，特别是 `errorCodeSchemaHistory`。它保护旧 profile-composition 对 `scripts/run-gates.ts` 的来源绑定：

~~~text
.artifacts/error-code-schema-before/scripts/run-gates.ts
SHA256 79d1564a04f7b84a72c0f39e19732c8bb0d269100e6af9b5548e1990227a5b90
~~~

本次又改变了 scheduler，后续报告晋级还需加入新的 envelope archive 层，但不能删除旧层。current input 必须匹配当前源码；historical input 必须匹配当时归档；两者不能互换来消除断言失败。

执行前按以下类别判断：

| 类别 | 规则 |
|---|---|
| 已成功的 `prepare/archive/capture/advance` helper | 不重跑；很多使用独占 `wx`。新增量创建新名称和新目录 |
| 失败且尚未产生完成记录的 generator | 修复原因后可重跑；先检查是否留下部分输出 |
| 普通只读校验/测试 | 按改动需要重跑，保留新日志名及准确退出码 |
| `write-reports.mjs` | 必须先完成当前源码来源与历史 fallback 晋级；生成可静默数分钟，等待原句柄 |
| binding tamper controls | 在隔离子进程替换读取结果或使用独立 fixture，证明坏输入失败；避免污染实际源码 |
| 旧 `*-source.json` / validation / archived note | 历史不可改；新结论由新记录引用旧记录并说明变化 |
| 旧未通过测试 | 保留失败；修复后追加新回执，不删除旧输出或把 skip 写成 pass |

当前已成功且最容易误跑的两个动作是 `prepare-remote-error-envelope-schema.mjs` 与 `capture-remote-error-envelope-schema-emission.mts`。第 11 节列出的完整 source capture 尚不存在；名称非常接近，务必先查路径。

不要运行仓库 clean 或递归清理 `.artifacts/` 来“整理移交”。它们既存放可再生成的 build，也存放不能从当前源码重建的历史证据。要删除任何生成残留，必须逐路径证明归属、源映射/时间/未跟踪状态并保留回滚副本；本次没有授权新的清理。

<a id="transfer"></a>
## 15. 同机、跨机器和上下文丢失时的移交

### 15.1 同机更换 Agent

直接把本手册绝对路径交给新 Agent，并让其进入现有隔离 worktree。不要另建空分支后只看 HEAD；当前所有实施改动尚未 commit。读取 state → 原规格 → 未封存清单 → 当前源码/证据，再定位需要的历史来源，避免从零重做审计。

### 15.2 跨机器传递

**本目录是详细移交资料，不是完整可移植代码备份。** `tracked-changes.patch` 不含 untracked 文件，Git clone 不含 `.artifacts/`，直接复制 worktree 的 `.git` 文件也不会带上主仓 Git 对象。跨机器时至少需要：

1. 固定 upstream 基线对应的 Git 对象，以及明确的分支/worktree 重建方式。
2. changes 清单列出的全部 tracked 修改和 untracked 实际文件；本移交包只对它们编目，没有再复制一份全部源码。
3. `artifacts/upstream-first/` 的来源、报告、校验 helper、原规格和完整追踪。
4. 所有来源记录和生成器引用的 `.artifacts/` 日志、before archive、截图、fixture、tarball、wheel/exe 及相关回执；`evidence-index.json` 的 ignored 目录只建立索引，没有递归哈希整个目录。
5. 清楚区分依赖/build 可重建项与历史字节不可重建项；不能盲目搬运 Windows node_modules junction 后假定能用。
6. 新机器的 Node/pnpm、原生依赖、浏览器与平台 runner 信息。绝对路径可能需要显式映射；不要修改历史 SHA 或旧证据内容来适应路径。

跨机器归档前排除真实凭据、用户 home 和身份参数；不要为了复现把当前 `.env` 或用户设置打包。真实 API 只通过届时批准的环境注入；fixture 数据和 live 数据必须区分。完成复制后比较完整清单及摘要，缺少证据时写出具体缺项，不能按“旧 Agent 说通过”恢复资格。

### 15.3 防止接手期间并发覆盖

同一文件集只由一位实施 Agent 写入。当前任务没有授权使用子 Agent；新 Agent 不应因为本手册提到“多 Agent 移交”就并行派工。若用户以后明确允许并行，每个 worker 要有文件/模块归属、共享树协调规则及最终整合 owner，不得覆盖其他人的修改。

发生上下文压缩或新会话时，读取本目录与最新 `LATEST.json`，核对当前源码和封存点。不得因为摘要看起来完整就重复执行独占 helper；也不要只记“最近在做错误 schema”而丢掉 Phase 0–12。

<a id="takeover"></a>
## 16. 接手验收清单与交给下一位 Agent 的提示词

接手检查通过只表示上下文接收完整，不代表产品验收通过。

- [ ] 确认用户是要求继续实施还是只读理解；当前 goal 已暂停。
- [ ] 工作区、分支、HEAD 和 dirty 清单对得上；暂存区及主目录两份报告得到保护。
- [ ] 完整原文 SHA 相同；读懂 81 节/Phase 0–12，而非只读本手册的摘要。
- [ ] 区分 `remoteValidationDetails` 已封存与 `remoteErrorEnvelopeSchema` 未封存。
- [ ] 确认归档 5,461 文件及 emission capture 已成功，完整 source capture 尚待创建。
- [ ] 能打开 pack/built/测试/doc-sync 日志，知道本地证据与真实平台/发布证据的区别。
- [ ] 明确 `capturedInputDigest` / `errorCodeSchemaHistory` 不能丢失。
- [ ] 确认没有遗留的本人可归属进程；对未知进程只检查，不随意终止。
- [ ] 形成第一个可审查增量及其验证范围，不重启全量审计或随意扩大任务。
- [ ] 承诺下次交回时按第 17 节产生新编号手册与快照，并更新入口。

可直接交给下一位 Agent 的继续实施提示词：

~~~text
请接手并继续本任务。先完整阅读：
E:/Mix/project/deepseek-harness/.worktrees/upstream-first/artifacts/upstream-first/handoff/2026-09-19-01/HANDOFF.md

原始目标是按 Upstream-First 完整规格执行 Phase 0–12，不是只完成错误 schema。上一个 Agent 因我要移交而暂停；这条“接手并继续”是恢复本地实施的指令。

只在 E:/Mix/project/deepseek-harness/.worktrees/upstream-first、agents/upstream-first 工作。先核对 state、changes、原文 SHA、适用规则和真实工作树，保留所有已有改动及主 dev 的两份未跟踪报告。不要提交、推送、发布、迁移真实用户数据、改变自启动、更新记忆或未经授权使用子 Agent。

最新封存点是 remote-validation-details-source.json；正式 Remote error envelope schema 已实现并有测试/打包证据，但尚未建立完整 source record、报告晋级和验证回执。按手册第 11 节从该断点继续，不重跑已成功归档或 emission capture，不丢失报告历史 fallback。

封存本增量后继续全局剩余阶段，严格区分局部源码/真实隔离 HTTP/录制模型/真实平台证据。遇到阻塞先完成独立可做工作，明确具体缺项，不把未完成目标写成完成。

以后我要移交或交回原 Agent 时，请按第 17 节生成新的带版本号移交手册，保留完整原规格、增量与累计清单、封存/未封存边界、验证和失败、下一步及移交提示词；更新 handoff/LATEST.json，不覆盖旧移交包。
~~~

若用户只是让新 Agent 阅读评估，去掉“接手并继续”和恢复授权句，明确只读；不要让文件本身隐含开启实现。

<a id="handback"></a>
## 17. 再次交回的协议、模板与提示词

### 17.1 版本与归属

每次移交生成 `artifacts/upstream-first/handoff/YYYY-MM-DD-NN/`。旧目录一旦交付即冻结；新目录记录 `predecessorHandoff`、上份手册 SHA、接手时间/基线、交回时间/基线和所有实际变更。入口 [LATEST.json](../LATEST.json)只指向最新完整移交包，不承担历史内容。

本手册中的 capture 脚本固定了这次 HEAD、来源和文件集合，不能原样复用于下一次。新 Agent 应阅读后为新编号调整采集逻辑，保存新旧差异，不能把旧 expected hash 批量替换后冒充旧证据。原规格保持同一字节副本；需求改变时保留旧原文，另加用户直接要求的变更清单。

移交时应尽量让当前步骤取得终态，但若用户明确要求马上暂停，就像本次一样保留未封存增量，写明缺哪些动作，不为“收尾”继续实施。正在运行且允许等待的命令记录 session/cell ID、PID、日志、启动时间和作用域；确认终态后写退出码。需停止时只停止可明确归属的进程，不把未知全局进程一起结束。

### 17.2 每次交回必须包含的字段

| 分类 | 必填内容 |
|---|---|
| 用户与目标 | 初始直接请求、完整规格引用与 SHA、期间追加要求、暂停/继续/完成的直接依据 |
| 身份与时间 | handoffId、predecessor、任务 ID、时区、接手/交回时间 |
| Git 与目录 | 所有实际使用工作区、branch/HEAD、是否创建 commit、staged/unstaged/untracked、外部改动归属 |
| 累计与增量 | 当前完整文件清单；相对上次交接新增/修改/删除/改名清单；变更原因和当前 owner |
| 实施状态 | Phase 0–12、Gate 0–4、fullGoalComplete/completeRc；逐项说明变化，不能只报最近子任务 |
| 封存断点 | 上次与本次最新 source path/key/SHA，archive、report generator、binding、validation 的位置与状态 |
| 未封存工作 | 已改文件、当前 diff、已运行检查、尚未创建的记录、下一条具体动作 |
| 验证 | 原始命令、cwd、局部环境、起止时间、退出码、pass/fail/skip、日志和产物 SHA、证据类别 |
| 失败与解决 | 现象、最小复现、确认/未确认根因、实际修复、反向控制、保留失败、尚未覆盖范围 |
| 环境与副作用 | 依赖/锁文件、postinstall/hook、系统状态、用户数据、后台进程、端口、隔离 home；没有也明确说明 |
| 安全与授权 | 是否调用真实模型/网络/外部系统、是否读写真实数据、凭据如何注入；不得复制秘密值 |
| 决策 | 新增/推翻的架构决定、为什么、受影响 owner、需要用户决策的具体选项 |
| 后续 | 按依赖优先级排列的任务，每项写文件、做法、完成条件及缺少环境 |
| 可移交性 | 原文、清单、patch、untracked/ignored 是否真正随包携带；不能恢复的项目必须显式列出 |
| 验证和入口 | 文档链接/摘要/工作树保护检查；更新 LATEST；可直接粘贴的交回提示词 |

### 17.3 可复制的交回手册模板

下面仅是下一次手册的结构，`待填写` 表示必须用届时事实填写，不能把模板字段当作已完成结果。

~~~markdown
# Upstream-First 移交手册 YYYY-MM-DD-NN

移交编号：待填写。前次移交：2026-09-19-01。前次手册 SHA：待填写。
用户当前直接指令：待填写。任务状态及依据：待填写。

## 原始需求与追加约束
完整原规格位置/SHA：待填写；用户追加要求及适用顺序：待填写。

## 当前工作区与保护对象
cwd、branch、HEAD、dirty/staged、主目录保护文件、其他修改者：待填写。

## 本轮成果与累计阶段状态
相对前次移交的变化：待填写。
Phase 0–12 / Gate 0–4、完整目标未完成部分：待填写。

## 最新封存点和当前未封存工作
source/key/SHA、归档、报告/绑定/验证：待填写。
未封存代码、未完成动作、不能重跑的成功 helper：待填写。

## 已执行验证与问题记录
命令/cwd/env/退出码/计数/原始日志/SHA/证据类别：待填写。
失败、处理、反向控制、未解决根因和未验证边界：待填写。

## 环境与运行状态
版本、依赖/锁变化、postinstall/hook、系统/数据副作用、活动句柄与日志：待填写。

## 下位 Agent 的第一项动作与后续路线
精确文件、步骤、依赖、验收、外部资源缺项：待填写。

## 再次交回协议
保留本版本，下一次新建目录、完整原文/增量/累计状态/证据，更新 LATEST。

## 附件与本次移交核验
完整原文、state、changes、delta、evidence-index、manifest、verification：待填写。
移交包是否包含全部代码/ignored 证据：待填写。
~~~

### 17.4 交回给原 Agent 的提示词

~~~text
请继续之前的 DeepSeek Harness Upstream-First 任务。中间已由另一位 Agent 接手，不要从旧会话摘要直接继续修改。

先读取 E:/Mix/project/deepseek-harness/.worktrees/upstream-first/artifacts/upstream-first/handoff/LATEST.json 指向的新手册，核对它的 predecessor、相对上次移交的增量、当前工作区/HEAD、原始规格 SHA 和最新封存点。

保留其他 Agent 的所有改动，按新手册记录的未封存断点及第一项动作继续。原始 Phase 0–12 目标仍适用，除非新手册引用了我的明确变更指令。历史测试通过不代表当前源码已验证；新的失败也不能抹去旧回执。

继续遵循既有授权范围；下一次交接仍按同样协议建立新版本手册、完整需求、累计/增量清单和证据索引，不依赖模型记忆保存上下文。
~~~

接收方应先简短回报“已核对的断点、发现的差异、将执行的第一步”，随后开展用户已授权的工作。没有差异时不必重新向用户确认每一条既有约束。

<a id="manual-validation"></a>
## 18. 本次手册的核验范围

本次重新读取了 goal 状态、工作区/Git 状态、主目录保护文件、原规格、当前报告、关键来源记录、未封存日志与 helper，并以相对增量前 archive 的字节差异定位 21 个已改文件与 3 个新增文件。核实源规格及最后封存 source SHA，复核本地 tarball SHA，保存 13 份报告字节快照。

手册验证检查本移交包摘要、原文完整性、81 节及 1,983 个非空行、Markdown 本地链接/锚点、JSON 可读性、手册尾部换行与空白，以及全部既有 dirty 文件、主目录和封存报告未被本次整理改动。实际结果和检查数量见 [verification.json](verification.json)。`verify.mjs --live` 会检查移交时的 live 状态；后续合法实施改变文件后，它应报告差异，此时不要修改旧手册的 expected SHA 使它通过。

没有重跑产品测试、重建 runtime、重打包、重放模型、启动浏览器或改写正式报告链。第 9 节的测试结果来自对应历史终态证据。本次生成的移交校验回执只证明移交资料一致，不是新的一轮产品资格认证。

<a id="full-spec"></a>
## 19. 完整原始需求附件

完整文件：[DeepSeek Harness 下一版 Agent 总实施规格（Upstream-First）原文](original-specification.md)。它包含编号 0–80 的全部内容及原文结尾总原则，不是节选或重述；字节与任务中恢复的权威副本一致，SHA-256 为 `4f313ad5a779b497e239654bc6cb3734dbe32210c72adf11286637606f764e80`。

本手册不会替代原文中的细项。下一位 Agent 接续时按 [逐节追踪快照](report-snapshots/specification-traceability.json)定位每项 owner 与未完成工作；以后再次交回时，也必须保留完整原文及追加需求，使接收方不依赖已经折叠或丢失的对话记录。
