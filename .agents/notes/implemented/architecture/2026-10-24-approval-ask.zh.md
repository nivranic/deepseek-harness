# Agent Note: Lite 权限梯新增审批档与 §38 对话框

Status: implemented

[English](2026-10-24-approval-ask.md) | 中文

- Date: 2026-10-24
- Class: architecture
- Scope: `apps/android/core` (`LiteToolPermissionPolicy.kt`、`LiteLoop.kt`、`LiteChat.kt`)、`apps/android/app` (`LiteApprovalAsks.kt`、`LiteSessionAssembler.kt`、`LiteEntry.kt`、`LiteChatScreen.kt`、`native_companion.xml`)

## Problem

§31 权限梯对每个被声明的工具调用只答三档之一——本机执行、移交完整运行时、未知名失败——于是 moderate 风险的调用（联合面上恰是 web_search、url_fetch、artifact_create：网络取数与本机写入）在无用户介入下直接执行。§38 对危险操作要求正相反：显示调用事实的审批面，绝不允许只问「是否允许？」。

## Decision

在移交门与免批之间新增第四档 `LiteToolDecision.Ask(risk)`：high/critical 与远程权限两门拒绝之后，被声明的 moderate 风险先问；low 名（纯计算、本地读、图像元数据）保持直执行免批，bundled 回退名域保持无风险门语义——它不携带任何被声明的风险事实，无可问之物（§37：绝不猜测）。驱动器照旧逐调用恰咨询一次策略，Ask 调用在新 `LiteToolAsking` 缝——`(name, arguments, risk) -> Boolean`——上悬挂于执行之前：准许走与许可调用同一执行体，拒绝折叠既有的 `tool/result(ok=false)` 词汇（零新事件 tag），完全没有缝则折叠显式 `approval unavailable` 拒绝——Ask 绝不未经确认就执行。App 面以 `LiteApprovalAsks` 装载该缝：单待答槽（循环串行服务其调用）、对话框渲染的 `StateFlow`、回合被替换时取消即清对话框、`respond` 在锁外恢复续体。对话框以手头事实承载 §38 七字段——操作（工具名）、目标（本设备·受限模式）、Host（本机 Lite 会话）、Workspace（lite 本地存储）、Risk（声明的 wire 词）、Permission escalation（无——本地执行绝不提权）、Command preview（参数 JSON）——十一枚 locale 持有键、全动作 testTag、点击对话框之外按拒绝计：确认档调用绝不默认放行。接线沿装配缝：`LiteSessionAssembler.assemble` 与 `LiteChatViewModel` 收 ask 缝透传驱动器，`LiteChatFace` 按装配身份 remember 一个 `LiteApprovalAsks`。

## 备选方案（已否决）

- 照完整运行时审批策略对每次工具调用都问：权限梯自己的分级已编码危险度——low 是纯计算与本地读，§38 针对危险操作而非全部操作；为一次计算回合弹窗只会训练用户条件反射式点允许。
- 在 fold 里渲染待答行替代悬挂缝：审批是模型看不见的 UI 本地交互，且 fold 的 tag 集是从三方互验的十六 tag 闭集——拒绝经既有 `tool/result` 行到达模型，那是本次交换唯一模型可见的面。
- 把审批交换记为会话事件入 journal：同一闭集论证——用户的准许或拒绝不是回合结局，chapter 64 的 journal 只记回合结局；折叠后的拒绝行已持久化重启所需的一切。

## Consequences

- 联合面的行为恰为三名翻转——`web_search`（宿主投影）、`url_fetch` 与 `artifact_create`（设备声明）——从直执行变为先问；low 名保持原样。`LiteToolRegistryTest` 的联合梯循环现按被声明风险分支，两个策略测试在两个声明面上都断言 Ask 档。
- 驱动器构造器新增可选 `ask` 缝且排在 `execute` **之前**：既有调用点以尾随 lambda 传执行器，排在它后面的带默认值参数会把这个 lambda 抢绑过去。
- `:core:test` 增至 85 套件 / 612 测试（+3）：悬挂测试钉缝事实（名、参数、`moderate`）与等待点（调用行已落 `running`、无结果），拒绝测试钉 `user denied on this device` 折叠与 chapter-64 journal 尾事件，无缝测试钉显式 `approval unavailable` 拒绝。
- 对话框本身无 androidTest：入口面装配真实 HTTP 会话、无脚本 provider 注入点，对话框语义活在 core 缝测试里、其渲染由编译与 locale 校验承载；脚本化 UI 台架是本代不需要的新基建。
- `LiteHTTPProviderTest.aStreamThatEndsBeforeDoneIsTruncation` 在本代多轮全量下间歇挂（三次全量失败、每次单独重跑绿、最终 clean 全量轮绿）；本代零 provider 触碰——照既有间歇记录，非回归。
- 双 APK 面漂移（app 与 core 主源集变更）：androidTest `2c73cbb2 → e0d3214b`、debug `995eeb31 → 5b996719`。
