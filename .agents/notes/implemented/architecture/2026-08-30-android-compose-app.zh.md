# Agent Note: Compose 伴侣应用

Status: implemented

[English](2026-08-30-android-compose-app.md) | 中文

## 问题

Android core 能配对、能折叠，但没有以应用形态交付：没有配对界面，没有六标签产品面（第 52 章的模块清单），简约拟态基线也只是没有 UI 读取的 tokens。

## 决策

视图模型作为纯 JVM 类放进了 `core`，驱动 `WireDriving` 缝——`SessionModel`（列表、打开、快照+事件的增量折叠、带内联图片上传的 prompt、取消）、`InteractionModel`（按事件 id 去重的 `$events` 收件箱、经 `$events/result` 应答）、`FilesModel`（注册表 follow 加 `workspaceFiles/list` 逐层浏览）、`SubagentsModel`（扁平列表、按持久地址只读打开子时间线）——各自在 JVM 车道上被 FakeWire 测试。`app` 模块是薄 Compose 壳：粘贴二维码载荷经 `LinkPayloadParsing` 配对的配对屏、六标签 `NavigationBar` 脚手架（会话/审批/计划/工具/文件/子代理）、读取 core `NeumorphicTokens` 的 Material3 主题与浮起卡片处理。minSdk 33 承载签名所需的 JDK Ed25519 提供方。车道在 JVM 测试旁新增 `:app:assembleDebug`。

## 后果

车道端到端全绿：24 个 JVM 测试（一致性、词汇、tokens、线缆、签名、钉扎、客户端往返与四个视图模型）加上在其上组装的 debug APK。折叠的增量形式（`foldInto`）随本增量新增——活动事件在快照状态之上折叠，正如 Swift 折叠一贯的做法。已知骨架限制：模型暴露普通字段，Compose 在重组触发点重读而非观察活状态（StateFlow 投影随打磨轮到来）；重启动需重新配对（端点未持久化）。车道迭代轮次暴露了常见的首次接触事实：AndroidX 需要 `android.useAndroidX`；application id 不能带连字符；`activity-compose` 1.9.10 从未发布过；material3 `NavigationBarItem` 必须有 icon；`runTest` 的 `backgroundScope` 作业在断言前从不推进——follow 测试改为 unconfined 运行，重放得以同步送达。

## 考虑过的替代方案

视图模型放 app 模块被否决——JVM 车道会把它们的测试丢进只有模拟器的世界。现在就全面 StateFlow 被否决——普通字段让骨架对重组限制保持诚实，待打磨轮设计观察方案。
