# Agent Note: Android 随模型一并选择推理力度（§30）

Status: implemented

[English](2026-10-02-android-model-effort.md) | 中文

## 问题

第 30 节的模型选择承诺在 Android 上还剩一个客户端缺口：Web 选择器已暴露各模型的推理力度（`ModelSelect` 读取目录的 `model.reasoning` 并在 `session/selectModel` 上携带 `reasoningEffort`），但 Android 选择器只选 provider+model——`NativeCatalogModel` 不解析推理元数据，`selectModel` 不发送力度，推理型 Host 模型在 Android 上只能以默认力度被选中。

## 决策

- `NativeCatalogModel` 增加可选 `reasoning: NativeModelReasoning?`（力度 `[{id, name}]` 加 `defaultEffort`），从 Host 已发布的目录 wire 结构解析；无推理的模型解析为 `null`。
- `selectModel(provider, model, reasoningEffort = null)` 仅在非空时附加 `reasoningEffort` 请求字段——不带力度的选择与既有 wire 字节一致。
- 选择器把每个推理模型的力度选项渲染为其模型行下方的一排按钮（testTag `catalog-effort-<id>`）：点模型行按其 `defaultEffort` 选择；点力度按钮按该力度选择；确认文案同时命名两者（`已选择 <model> · <effort>`）。不新增能力、端点或 fixture 键——力度随 `model.select.v1` 之下的 `session/selectModel` 传递。
- 验收车道以真机 AVD companion 对接仅含 providers 的 header-only 回放 Host（零模型调用），证明恰好一次设备签名的 `session/selectModel` 派发携带 `provider`/`model`/`reasoningEffort: 'max'`、携带同一力度的 `model/selection` 会话事件，以及命名模型与力度的设备端确认。

## 备选方案

- **独立力度端点：** wire 已在 `selectModel` 上携带 `reasoningEffort`；第二个方法会把一次选择拆成两次派发。
- **省略力度、依赖默认值：** 推理型 Host 模型的力度是用户可见的路由属性；Web 已暴露它，且 §30 禁止各平台词汇分叉。

## 后果

- 力度行使选择器对话框变宽，不占输入行（模型调控的宽度约束）；无推理的模型不渲染力度行，其 wire 保持无力度。
- 本 note 同时勘误 §30 追溯记录：model-select 增量的 remaining 文本声称尚无客户端暴露 `reasoningEffort`——Web 选择器早已暴露（[`ModelSelect.tsx`](../../../../packages/client/ui-model-selection/src/client/ModelSelect.tsx)）；真正的缺口，即本 note 收口的，仅限 Android。

## 开放工作

- Apple 侧模型选择（及力度）入口；真机验收。
