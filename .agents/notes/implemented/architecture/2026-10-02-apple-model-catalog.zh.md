# Agent Note: Apple 契约采纳模型选择词汇（§30）

Status: implemented

[English](2026-10-02-apple-model-catalog.md) | 中文

## 问题

第 30 节模型选择半面在 Apple 侧存在契约级缺口：Android core 解析 `session/modelCatalog`（provider 分组、可路由模型、各模型的推理力度与默认值）并按宽容语义发送 `session/selectModel`（请求信封，`reasoningEffort` 仅在存在时携带），但 Swift 契约列两者都未镜像——Apple 客户端没有读取 Host 目录或构造选择的声明词汇。

## 决策

- `NativeModelCatalog.decode` 镜像 `SessionModel.modelCatalog` 的确切宽容语义：无字符串 id 的条目（分组/模型/力度）被丢弃、名称回退为 id、非对象 `reasoning` 字段视为缺席、`default` 的非字符串成员读为空、残缺 JSON 失败、非对象文档读为空目录。`NativeEffortChoice`/`NativeModelReasoning` 承载力度词汇（`efforts` 带 id 回退名、可空 `defaultEffort`）。
- `NativeModelSelection.wireBody()` 镜像 `SessionModel.selectModel`：`{"request": {sessionId, provider, model, reasoningEffort?}}` 信封，力度键仅在非 nil 时出现——不带力度的选择与力度出现前的 wire 字节一致。
- 共享夹具 `apps/apple/contract/fixtures/native-model-catalog/`（一份含推理模型与仅 id 分组的规范文档、三个宽容边界用例、一个截断文档）由两列共同消费：`NativeModelCatalogFixtureTest` 经 `FakeWire` 驱动真实 Kotlin 解析器并钉住精确解析结构；Swift 自检（`dsh-contract-check`，macOS CI lane）解码相同字节并断言一致结构加请求信封形态。
- 目录解析器刻意宽容而名册严格：名册是本地持久文档（损坏即拒绝），目录是 Host wire 响应（未知形态降级、绝不崩溃）——镜像各采用所在面自己的语义。

## 备选方案

- **严格目录解码器拒绝未知形态：** Kotlin 权威是丢弃加回退；更严格的 Swift 列会拒绝 Android 接受的文档，对一个 Host 下发的响应没有安全收益还破坏对等。
- **只在单侧验证夹具：** 单列夹具会静默漂移；名册增量确立的双列先例在此沿用。

## 后果

- Swift 列仍无外壳 UI、模拟器或真机资格；本 note 只是契约级对等（本节剩余开放工作）。
- 两列都钉住夹具计数（1 valid + 3 edge + 1 invalid），沿名册 14 用例钉住的先例。

## 开放工作

- 消费本词汇的 Apple 侧 UI 入口；真机资格；Swift 编译本身只在 macOS CI lane 验证（Windows 本机无 Swift 工具链）。
