# Agent Note: Apple 契约采纳 follow 续传请求词汇（§25）

Status: implemented

[English](2026-10-02-apple-follow-resume.md) | 中文

## 问题

§25 的 follow 续传（`session/follow` 询问上的可选非负 `fromSeq` 游标、重连携带最后已应用条目的含端 seq）已在 Android core 落地，但信封构建规则内联在 `CompanionModels` 中，Apple 侧没有构建器——Swift 客户端无法组装同一请求。§25 追踪行把 Swift 列在开放项中。

## 决策

- Android 信封规则抽取为 core 纯对象 `NativeFollowResume`（apps/android/core）：`sessionAddress`/`subagentAddress`（两种 follow 地址形态）、`withMaxMessages`（正数页大小）、`withResumeCursor`（非负游标仅在存在时携带——全新 follow 信封不含 `fromSeq` 键）、`request` 组装 `{"request": {address, maxMessages, fromSeq?}}`。`CompanionModels` 在原四处内联点改为委托（openSession 与 openChild 的地址构造、replaceFollow 的页大小注入、follow 的游标注入）。
- Apple 镜像 `NativeFollowResume.swift`（apps/apple/contract）以可捕获错误同构采纳（`NativeFollowResumeError.maxMessages`/`.fromSeq`；用可抛静态函数而非 precondition，客户端自检可断言）。
- 请求信封钉结构相等而非字节相等（model-catalog `wireBody` 先例）：键序在所有平台归构建方所有。这是与 view-location 载荷的刻意对照——后者用户可见字节被精确钉死。
- 共享夹具 `apps/apple/contract/fixtures/native-follow-resume/`（一份规范续传、三个边界用例——全新 follow、零游标、子代理地址——与一个无效用例；计数 1/3/1 两列同钉）经 Kotlin 侧 `NativeFollowResumeFixtureTest`（驱动真实 core 对象、经 `WireValue.fromJsonElement` 比较）与 `main.swift` 自检段（递归结构比较）双向消费，两个构建方拒绝相同输入并产出结构相等的信封。

## 备选方案

- **字节钉死信封：**插入序 map 在各 JSON 编码器间本就不同，且请求信封是机器读取——结构相等才是诚实的契约（catalog 先例），也让镜像免于手工构建 JSON。
- **镜像 Host 端校验（小数、`-0`、布尔 fromSeq）：**这些类无法从带类型的 `Int64`/`Long` 游标产生；Host 的 wire 边界继续校验它们——验证留在边界所有方。
- **规则继续内联在 `CompanionModels`：**内联构建使信封无法对共享夹具测试；抽取正是让两列驱动同一权威的关键。

## 结果

- Swift 客户端可组装与 Companion 结构相等的 follow 与续传请求；漂移使共享夹具失败。
- §25 追踪行的 Swift 项以契约级收口；持久化窗口、物理断网、前台/推送恢复仍开放。

## 开放工作

- 消费该构建器的 Apple 外壳（打开 follow 流，包括从查看位置打开）仍开放；本代交付信封词汇。
- §25 的持久化窗口、物理断网、前台/推送恢复验收仍开放，各原生轨道的真机资格同样开放。
