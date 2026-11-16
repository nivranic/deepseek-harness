# Agent Note: Android 公开会话位置事实（第 29 节）

Status: implemented

[English](2026-10-01-android-session-location-facts.md) | 中文

## Problem

第 29 节要求每个 Session 公开五项位置事实——Host、运行模式、工作区、权限预设、在线状态——并以常驻简洁 chip 呈现。Web Session 头部已做到（[2026-10-01-session-location-chip](../architecture/2026-10-01-session-location-chip.zh.md)）；Android companion 只在 Host 控件里显示当前 Host，会话列表行甚至不解析工作区。

## Decision

- `SessionRow` 新增 wire 行本就发布的可选 `cwd`（`SessionSummary.cwd`）；chip 由它派生工作区目录名，按两种分隔符切分（Host 可能运行在 Windows）。
- 权限预设不进 `DomainState`——该形状是第 62 章三语一致性契约。`SessionModel` 维护 `permissionPreset: StateFlow<String?>`，由 journal 发布回调供给（最新 `permission/preset` 记录胜出；替换窗口无记录则为权威 null；`openSession` 重置）。
- follow 流连接状态变为 Compose 可观察：`StreamTransitionOwner` 把原子 `ConnectionSnapshot` 镜像到 `StateFlow`，每次迁移（`advanceGeneration`、`update`、`settleStopped`）后发布；`SessionModel.connectionSnapshots` 暴露之。既有快照 getter 保持不变。
- `SessionLocationFacts` 在 Session 打开时、composer 行之外（model-steer 宽度约束）渲染：一行事实 `Host · 工作区目录名 · 预设词 · 状态词?`（testTag `session-location-facts`），一行细节含完整运行时词与工作区全路径（testTag `session-location-detail`）。内置预设复用共享中文词汇（仅可查看/工作区内修改/完全权限/自定义）；Host 自定义预设显示原始 id。状态词仅在非 OPEN 状态出现；运行时词作为协议不变量如实呈现——原生网关只接纳 `runtimeMode: "full"`。
- 验收车道将真实 AVD companion 配对到 header-only fixture 的 providers-only 回放 Host（读取事实不驱动模型调用），从已发布的 Host 数据证明稳定事实行与细节行。

## Alternatives considered

- **把 `permissionPreset` 加进 `DomainState`：** 会让三语一致性夹具在三种语言里同时破裂，只为一行 chip。
- **在车道里驱动真实断线来展示状态词：** 车道工具集做不到——移除 adb reverse 对空闲 follow 流不可检测（无 keepalive），重开同一 Session 会复用活流，且穿过已移除隧道的新连接被观察到仍然成功（"断线"期间 Host 侧仍有 `ESTABLISHED`）。状态词机制由 JVM 连接状态测试覆盖；确定性断线需要 Host 侧流终止原语，保持开放。

## Consequences

- 在线状态词从真实 follow 流迁移渲染，但尚无设备级验收证明（JVM 测试覆盖迁移；词映射位于 chip composable）。
- `StreamTransitionOwner` 现在把每次快照变更发布到流；原子 getter 语义不变。
- 开发期间两起宿主事故，如实披露：一次无属性 `:app:assembleDebug`（缺 `-PdshNativeAcceptance`）产出 plain-id APK 并被安装覆盖了用户的真实 `com.deepseek.harness.companion`（含 `.test`）——同一调试签名、数据保留、现为当前源构建；一次宿主 adb server 中途崩溃（5037 端口拒绝），以 kill/start-server 恢复。

## Open work

- 确定性的设备级断线车道（需要 Host 侧流终止原语或 follow 流 keepalive）。
- 真机资格验收；Swift 侧位置事实。
