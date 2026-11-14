# Agent Note：Android 外壳消费 Gateway 失败契约

Status: implemented

[English](2026-09-20-android-gateway-failure-consumption.md) | 中文

## 问题

已迁移的 Android 外壳带着一份经过校验的共享失败契约 Kotlin 镜像（`apps/android/contract`：`RemoteFailureClass`、`RemoteFailureClasses`、信封 schema 证据），却没有任何消费方。Gateway 拒绝以 `LinkClientException.Refused(code)` 到达外壳——wire 层解析并校验了信封的 `details` 对象却随手丢弃，文件查看器用私有的手写 `when` 分类错误码。

## 当前上游边界

TypeScript 权威（`REMOTE_FAILURE_CLASSES`、draft 2020-12 信封 schema）与其 Kotlin 镜像：没有共享语义的码解析为 `UNKNOWN` 且必须保持可作不透明诊断呈现。`ConnectionDiagnostics` 刻意丢弃码与消息以维持其隐私形态的诊断投影——该表面不在本次范围且未改动。

## 决策

- `LinkWire` 捕获其本就校验过的内容：`LinkResult.errorDetails` 与流失败帧的 `details` 字段不再丢弃。
- `LinkClientException.Refused` 携带信封——`details`（默认 `null`，既有构造点无需改动）与 `envelopeMessage`（信封的 message 字段，区别于日志形态的 `RuntimeException.message`）；单次调用结果与流失败两处抛出点填充它们。
- `GatewayFailurePresentation.kt`（core，`api(project(":contract"))`）即消费接缝：`GatewayFailureEnvelope.from(refused)` 提升信封；`GatewayFailurePresenter.present` 经共享镜像分类错误码，并将每个类别映射为一个下一步动作（`reauthenticate`、`abandon`、`retry-later`、`refresh-and-retry`、`fix-input`、`inspect-diagnostics`）与一条呈现文案。`UNKNOWN` 原样渲染 code 与 message，details 保留在信封上。
- 文件查看器的 `readFailureText` 先查分类器；其私有的 lite-fold 码（不在共享词汇表内）保留专属文案，仅真正未知的码回落到不透明形态。

## 备选方案

给 `ConnectionFailure` 扩展 code 会改变一个刻意丢弃码的隐私形态诊断 wire 词汇表——否决。把共享类别直接映射到 `readFailureText` 的私有码会错误标注词汇表出现之前的 lite-fold 端点——三层查找（共享词汇优先、私有细化次之、不透明兜底）让两者都保持诚实。基于 store 的插槽注入（web 客户端的模式）不适用：外壳没有插槽运行时。

## 后果

外壳能呈现的每一个 Gateway 拒绝都携带完整信封，呈现语义来自共享分类而非各表面的私有码表。向契约镜像新增类别会强制一次呈现决策：`GatewayFailurePresentationTest.everyClassCarriesADistinctActionTextPair` 枚举全部十个类别，镜像自身的 `EnvelopeSchemaTest` 仍把词汇表钉在 TypeScript 投影上。证据：`:contract:test` + `:core:test` 185/185（含 `LinkClientTest` 的信封保留用例），`:app:assembleDebug` 通过扫描器门禁，APK 在本地 AVD 安装并启动且零崩溃条目。
