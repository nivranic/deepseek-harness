# Agent Note: Android 与 Apple 的只读工件面板

Status: implemented

[English](2026-08-31-android-apple-artifact-pane.md) | 中文

## 问题

第 56 章把工件定为一等对象——journal 只传引用、元数据与状态，内容走资源通道——但两个伴侣应用只能把工件显示成不透明的工具调用行。没有面板收集它们，折叠后的领域状态也没有能装下它们的工件字段。

## 决策

工件面板直接长在第 62 章领域状态折叠上，三个运行时对称：TypeScript 参考折叠、Swift `CompanionSessionFold`、Kotlin `DomainFold` 各加一个 `artifacts` 列表，消费仓库既有的工件事件词汇——Lite 规范的 `artifact/created`（`id`/`kind`/`title`，折为 `pending` 状态）与 `artifact/status`（按 id 末写胜出；孤儿状态为无操作；重复 created 再次压入，镜像 Lite 折叠）。畸形载荷——非对象数据、非字符串 id、未知状态值——按缺失引用跳过。时间线行在每种语言里渲染完全一致的 `新建工件 title（kind）` 与 `工件 id：待定/就绪/失败`。不伪造金样本场景：场景构造器钉在真实 `SessionEventMap` 成员上而宿主事件尚不存在，所以每个 fixture 都诚实地把空面板钉住——再生成的一致性 fixtures 在三语言中携带 `artifacts: []`。

两个面都以只读第七标签呈现（位于文件与子代理之间）：Compose `ArtifactsTab`（标题、按状态着色的状态词、类型）与 SwiftUI `ArtifactsView`（同样的行，读 `RemoteSessionViewModel.artifacts`），与方案的伴侣面板清单一致。

## 后果

三语言同 fixture 同状态的保证现在覆盖面板的形状而非只有其空态：TypeScript 单测钉住全部折叠语义（状态迁移、孤儿容忍、畸形跳过、重复压入、空起步），两侧 FakeWire 驱动的测试把同一事件序列折过真实会话视图模型并断言同样的三条目列表。两条车道验证全绿；fixture 再生成触及三处全部一致性 JSON。经资源通道读取工件内容仍随宿主侧事件词汇一起延后。

## 考虑过的替代方案

伪造带工件记录的金样本场景被否决——构造器的 `keyof SessionEventMap` 约束正是 fixture 诚实的来源，为钉字符串而发明宿主事件等于对线缆撒谎。像 Diff 查看器那样从工具调用参数投影被否决——不存在模型可见的工件工具，投影永远不会触发；折叠消费的是仓库真正钉住的词汇，宿主开口之前保持诚实的空。
