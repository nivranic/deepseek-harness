# Agent Note: Android 模型选择器入列共享能力契约（第 30 节）

Status: implemented

[English](2026-10-01-android-model-select.md) | 中文

## Problem

第 30 节的模型选择承诺此前只兑现了一半：每个 Host 都广播 `model.select.v1` 与 `model.catalog.v1`，Web client 也有模型选择器（`dsh-client-ui-model-selection`），但 Android companion 完全没有选择入口——不调用 `session/modelCatalog` 或 `session/selectModel`，没有选择器，没有确认。一个 Session 的模型只能从 Web client 挑选。

## Decision

- Android 经 `NativeObservedCapability.MODEL_CATALOG`（`model.catalog.v1`）与 `MODEL_SELECT`（`model.select.v1`）观察两个能力，在网关诊断表中映射 `session/modelCatalog` 与 `session/selectModel`；support 导出 fixture 按枚举序补两个观察能力键，Host 能力详情列表新增本地化 读取模型目录 / 选择会话模型 条目。
- `SessionModel` 新增 `selectModel(provider, model)`——`cancelActive` 同形的 `{request:{sessionId, provider, model}}` 信封——以及 `modelCatalog()`，把 `groups` 与 `default` 解析为 `NativeModelCatalog`/`NativeCatalogGroup`/`NativeCatalogModel`。目录调用在 wire 上是零参数：必须发送空 args 对象，因为网关的严格参数检查拒绝任何多余键——兄弟方法 `session/list` 的 `_request` 参数名是该方法签名的事实，不是无参调用的模板。
- `SessionModelSelection` 只在 Host 广播 `MODEL_SELECT` 且已打开 Session 时渲染 模型 入口（`session-model-select`），放在会话屏内 composer 行之外（model-steer 的单行 composer 约束）。首次打开按 Session 加载一次目录并弹出选择器；点选一个模型发送一条 `selectModel`、关闭弹窗并按名称确认（已选择 …）；加载与选择失败都在弹窗内呈现。
- 验收车道将真实 AVD companion 配对到经 header-only fixture 以 providers-only 模式启动的回放 Host：选择不驱动任何模型调用，因此回放 scaffold 在启动时校验 fixture 无调用，取代 teardown 的脚本消费断言（scaffold 仍挂载回放 provider 目录，`session/modelCatalog` 依旧可应答）。车道证明恰好一条设备签名 `session/selectModel` dispatch（`args.request.provider`/`args.request.model`）、随之而来的 `model/selection` 会话事件与设备端确认——不涉及 prompt 或 turn。

## Alternatives considered

- **复用带调用的 live-interactions fixture 并驱动一次模型调用来满足脚本消费：** 选择不是 turn；伪造调用会把契约倒置。header-only fixture 加 `replayProvidersOnly` 正是 scaffold 为无调用场景设计的出口。
- **打开 Session 时预载目录：** 目录是 Host 动态的（可路由 provider、失败项）；首次打开选择器时加载，让从不选择的 Session 不发生任何拉取。
- **把入口放进 composer 行内：** 更宽的行会重演手机宽度溢出、会话列表塌缩的回归（[2026-10-01-model-steer](2026-10-01-model-steer.zh.md)）。

## Consequences

- 今天每个 Host 都广播 `model.select.v1`，未广播路径仅由能力保留单元面（support 导出）覆盖。
- 确认文本显示选择成功后的模型名称；权威记录是 `model/selection` 会话事件，本就是 required-on-read 词汇。
- Android 的零参数网关调用发送 `emptyMap()` args；未来任何无参端点沿用同一形态。

## Open work

- `reasoningEffort` 选择在 Android 无 UI（wire 已接受；尚无任何 client 暴露它）。
- 真机资格验收仍开放；车道运行在本地 AVD 回放 Host 上。
