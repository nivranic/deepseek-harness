# Agent Note: Compose 伴侣应用

Status: implemented

[English](2026-08-30-android-compose-app.md) | 中文

## 问题

Android core 能配对、能折叠，但没有以应用形态交付：没有配对界面，没有六标签产品面（第 52 章的模块清单），简约拟态基线也只是没有 UI 读取的 tokens。

## 决策

视图模型作为纯 JVM 类放进了 `core`，驱动 `WireDriving` 缝——`SessionModel`（列表、打开、快照+事件的增量折叠、带内联图片上传的 prompt、取消）、`InteractionModel`（按事件 id 去重的 `$events` 收件箱、经 `$events/result` 应答）、`FilesModel`（注册表 follow 加 `workspaceFiles/list` 逐层浏览）、`SubagentsModel`（扁平列表、按持久地址只读打开子时间线）——各自在 JVM 车道上被 FakeWire 测试。`app` 模块是薄 Compose 壳：粘贴二维码载荷经 `LinkPayloadParsing` 配对的配对屏、七标签 `NavigationBar` 脚手架（会话/审批/计划/工具/文件/工件/子代理）、读取 core `NeumorphicTokens` 的 Material3 主题与浮起卡片处理。minSdk 33 承载签名所需的 JDK Ed25519 提供方。车道在 JVM 测试旁新增 `:app:assembleDebug`。

core 的调色板 token 是 32 位 ARGB 数值。Compose 的 `Color(ULong)` 构造器读取带色彩空间索引的专用 packed color，因此 App 显式使用 `Color(token.toLong())` 解码 ARGB。未配对的 composition 只展示配对界面，不启动 Remote push 订阅；配对后 push effect 负责启动订阅，并在 effect 结束时停止它。

## 后果

JVM 测试覆盖领域与 wire 行为，`:app:assembleDebug` 验证 Android 依赖图；两者均不能证明 Compose 首帧可运行。`:app:connectedDebugAndroidTest` 在 Android 上启动真实未配对 Activity，等待异步凭据恢复，并要求配对标题可见。测试预授予通知权限，单独验证应用首屏；Android workflow 在 API 34 模拟器中执行它并保留报告。该检查不代表已验证真机网络、配对或权限拒绝路径。当前状态投影由 [StateFlow 决策](2026-08-31-android-stateflow-projections.zh.md)所有，wire 恢复与进程所有权由 [transport 决策](2026-09-02-android-link-transport-and-stream-ownership.zh.md)所有。

## 考虑过的替代方案

视图模型放 app 模块被否决——JVM 车道会把它们的测试丢进只有模拟器的世界。只测试 ARGB token 数值被否决——它不能发现 Compose 的色彩空间解码错误，也不能执行未配对 Activity 的 effect。
