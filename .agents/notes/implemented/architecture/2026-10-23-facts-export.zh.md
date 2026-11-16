# Agent Note：Lite 会话事实投影进支持导出的设备平面专属段

Status: implemented

[English](2026-10-23-facts-export.md) | 中文

## 问题

2026-10-16 的 note 以 `LiteSessionFacts` 收口了 §31 的事实词汇——模式字、各目录来源、实际生效的预设、捆绑本地工具名单——在设备上可观测，却止步于 UI 披露行；其 Open follow-ups 把剩余缺口点名为这些事实向支持导出的诊断投影。支持文档本就说着宿主平面的模式字（`protocol.runtimeMode` 重述配对宿主协商出的 `full`），于是工作会话是独立 Lite 的设备，其支持包可能携带自己会话从未运行过的模式声称，而没有任何段落点名设备自身装配了什么。

## 决策

经既有导出基建投影——不造第二通道，不加新 UI 文案。`SupportLocalSnapshot` 增一个可空 `liteFacts` 字段（会话装配前为 null；所有无投影构造面保持既有调用点不动），`encodeSupportDocument` 在设备事实平面上、`localIdentity` 之旁发一个 `liteSession` 对象：producer 为 `LiteSessionAssembler`，observation 为 `construction`（事实在会话装配时即固定——重述快照，绝非活重读）、模式字面、派发目录来源的选择词（kebab-case）、实际生效的预设 id（null 时省略该键——role/value 先例——绝不猜 id）、捆绑本地工具名单。无装配会话时 `uncollected` 以 `lite-session` 点名该段缺席。接线是参数而后 store：`LiteEntry` 增可选 `onFacts`；`LiteChatFace` 经以装配为键的 `LaunchedEffect` 上报每个装配身份的事实——身份 fail-loud（陈旧存储预设）时上报 null——导出因此绝不可能声称一个未装配的会话；壳注入 `model::publishLiteFacts`，`CompanionViewModel.supportSnapshot()` 把已发布事实带进壳在两个分支上早已挂载的同一个导出动作。两平面各自成段：Lite 段只重述本设备装配了什么、绝不读宿主 describe 结果，宿主平面保留自己的协商词——同一份文档可以并排携带 `protocol.runtimeMode = full` 与 `liteSession.runtimeMode = lite`，各有其 producer。

## 备选方案（已否决）

journal 事件维持否决——十六 tag 闭集会为一个静态构造事实收税，chapter 64 要求 journal 只落 fold 可见的回合结果。纯 UI 标签充当公开维持否决——§6 的「必须公开」要的是运行时事实；没有事实源的标签只是文案。扩 `NativeSupportDiagnostics` 维持否决——那个面重发布的是观察到的宿主 describe 结果，把 Lite 自述折叠进去会模糊本段刻意分开的宿主事实与设备事实两平面。第 8 tab 维持否决——tab 栏只在配对后存在——与独立运行时的主场景正好相反，且本投影完全不需要新面。

## 后果

`SupportExportTest` 增一测：映射测试钉住段内各词、null 预设 id 的省键形态、`lite-session` 的 uncollected 名、以及宿主 `full` 与设备 `lite` 并排的两平面配对；三份导出 fixture 增 `lite-session` 的 uncollected 条目。`SupportExportNativeTest` 增至三测，新用例把真机上 `LiteSessionAssembler` 真实装配出的事实喂过扫描后的文档；`LiteEntryNativeTest` 增至十测，新增两接线用例（装配身份上报 BUNDLED 派发联合与生效的 `minimal`；陈旧预设失败上报 null）。全部在 emulator-5554 通过。core JVM 测试 85 套件 608 增至 609；contract 维持 4 套件 37；debug 与 androidTest APK 基线随生产 core 与 app 变更双双漂移。

## 开放跟进

事实只在 Lite 面于本进程装配过之后才随导出而行——冷进程在任何 Lite 装配前导出会诚实地报 `lite-session` 未收集，Lite 使用历史无法从支持包重建。`LiteSessionFacts` 的 schema 来源与 preset 来源字段在 UI 与本投影中均未披露；只有当第二类目录来源真正面世时它们才值得各自的投影。§41-44 的 support collector 工作不为本段所触。
