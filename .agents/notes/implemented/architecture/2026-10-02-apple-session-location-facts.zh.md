# Agent Note：Apple 契约采纳会话位置事实推导（§29）

Status: implemented

[English](2026-10-02-apple-session-location-facts.md) | 中文

## 问题

§29 要求每个 Session 公开五个位置事实（Host、运行模式、工作区、权限预设、在线状态）。Web chip 与 Android 事实行已各自推导，但 Apple 侧没有镜像——Swift 客户端将只能从规格散文里重新推导规则：哪些事实出现、以什么顺序、带哪些回退。§29 traceability 行把"Swift 外壳与位置事实"列为开放工作。

## 决策

- Android 推导抽取为 core 纯对象 `NativeLocationFacts`（apps/android/core `NativeLocationFacts.kt`）：`presentedHostName`（名称空白回退 hostId，无条目不加事实）、`workspaceBasename`（双分隔符下最后一个非空白段，回退全路径）、`latestPreset`（最新 `permission/preset` 记录获胜；缺字符串 preset 的匹配事件保留先前值——自 `CompanionModels.latestPermissionPreset` 原文迁移，后者改为委托）、`stateWord`（open 状态不加词，六个第 18 节族状态词自名，未知词丢弃）、`factsLine`（仅在场标识符）、`detailLine`（仅在有工作区时存在：协议固定的完整运行时词加全路径——`NativeGatewayProtocol` 只接纳 `full`）。
- `MainActivity.SessionLocationFacts`（composable）仍渲染本地化词，但 `presentedHostName`/`workspaceBasename` 委托 core 对象——单一权威，无重复。
- Apple 镜像 `NativeLocationFacts.swift`（apps/apple/contract）采纳相同规则并提供整文档 `decode`：非对象 host 视为无 Host，非字符串 cwd 或 state 视为缺席，非数组 journal 视为空，残缺 JSON 抛出，非对象根读为全缺席。本地化词汇仍归客户端所有；契约只说标识符。
- 共享夹具 `apps/apple/contract/fixtures/native-location-facts/`（一份规范文档、四个边界用例——空白名称与全空白段回退、全缺席文档、preset 经非字符串值保留先例、未知状态词加被忽略的事件类型——与一个残缺用例；两列都钉 1/4/1 计数）经 Kotlin 侧 `NativeLocationFactsFixtureTest`（驱动真实 core 对象）与 Swift 侧 `main.swift` 自检段双向消费，两侧推导对相同输入逐字一致。

## 备选方案

- **镜像本地化词：** 第 18 节状态词与预设词是 locale 拥有的客户端文案；契约列不得冻结译文。镜像钉标识符；各客户端自行本地化。
- **在 UI 层镜像：** Apple 侧尚无外壳；推导级契约现在落地共享规则，无论外壳最终渲染什么，规则都保持真。
- **推导保持 app 私有：** preset 推导本就在 core；把其余两条规则抽进同一对象，消除了否则会迫使 Swift 镜像猜测权威文件的 app/core 分裂。

## 后果

- Swift 客户端从相同 wire 数据推导与 Android core 相同的事实；两列间的漂移会让共享夹具失败。
- `CompanionModels.latestPermissionPreset` 与 MainActivity 的 basename/名称回退现在委托唯一 core 对象；行为不变（迁移的函数体逐字相同）。

## 开放工作

- 渲染事实的 Apple 外壳（及其本地化词）仍开放；本契约列是"Swift 外壳与位置事实"的推导级半面。
- 真机、后台/推送、follow cursor/handoff 及 §29 其余验收仍开放。
