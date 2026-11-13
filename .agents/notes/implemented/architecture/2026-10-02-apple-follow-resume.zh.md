# Agent Note: Apple 契约采纳 follow 续传请求词汇（§25）

Status: implemented

[English](2026-10-02-apple-follow-resume.md) | 中文

## 问题

Android 与 Swift 需要结构相同、兼容 Host 的 follow 请求。内联信封构造以及仅由客户端共享的夹具，可能掩盖与权威 Host 请求类型的漂移。

## 决策

- Android 的纯对象 `NativeFollowResume` 拥有 Session 与子代理地址构造、正数分页上限和 `request` 组装。初始和重连请求包含相同地址与 `maxMessages`，保留序号留在日志中。
- Apple 镜像 `NativeFollowResume.swift` 采用相同构造规则，以及可捕获的 `NativeFollowResumeError.maxMessages` 错误。
- 请求信封钉结构相等而非字节相等（model-catalog `wireBody` 先例）：键序在所有平台归构建方所有。这是与 view-location 载荷的刻意对照——后者用户可见字节被精确钉死。
- `apps/apple/contract/fixtures/native-follow-resume/` 下的共享夹具覆盖普通请求、单消息分页、unknown 模式子代理地址和无效的零分页大小。Kotlin 与 Swift 消费这些夹具，Host 场景使用生成的严格校验器检查有效请求体。

## 备选方案

- **字节钉死信封：**插入序 map 在各 JSON 编码器间本就不同，且请求信封是机器读取——结构相等才是诚实的契约（catalog 先例），也让镜像免于手工构建 JSON。
- **在带类型构造器中重复无类型 wire 校验：**Host 拥有 JSON 类型校验，原生构造器检查正数分页大小。共享 Host 检查会拒绝当前接口之外的字段或模式值。
- **规则继续内联在 `CompanionModels`：**内联构建使信封无法对共享夹具测试；抽取正是让两列驱动同一权威的关键。

## 结果

- Swift 客户端可组装与 Companion 结构相等的 follow 与续传请求；漂移使共享夹具失败。
- 请求夹具确定跨平台构造规则，安装态恢复与真机验收仍是独立义务。

## 开放工作

- 消费该构建器的 Apple 外壳（打开 follow 流，包括从查看位置打开）仍开放；本代交付信封词汇。
- §25 的持久化窗口、物理断网、前台/推送恢复验收仍开放，各原生轨道的真机资格同样开放。
