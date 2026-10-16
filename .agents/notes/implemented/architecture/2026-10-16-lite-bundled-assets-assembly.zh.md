# Agent Note：app APK 捆绑 Lite 投影并以其装配独立 Lite 会话

Status: implemented

[English](2026-10-16-lite-bundled-assets-assembly.md) | 中文

## Problem

§31 要求 Lite 运行时拥有自己的 tool catalog，而 §32/§33 已产出该目录的内容：persona 投影（`lite-preset-descriptors.json`，真 boot persona 收割）与模型面投影（`lite-tool-schemas.json`，supportsLite 过滤的 schema 清单）。但两者只存在于 JVM 测试资源——`:contract` 与 `:core` 把它们拷上测试类路径供镜像测试使用，正式 APK 一份都不带，`:app` 壳连 assets 目录都没有，也没有任何运行时代码读取这两份文档。`LiteChatScreen` 一直是零调用点的死 UI：独立 Lite 会话无法从真实投影字节构造出来，app 里装出来的会话只能跑 BARE——没有 tools 数组、没有 persona——投影流水线止步于测试类路径。

## Decision

app 构建把两份投影拷进 APK。`copyLiteAssets` 从生成它们的 packages 把文件落到 `assets/lite/` 下，`verifyLiteAssetSources` 在 preBuild 阶段对任一源文件缺失或为空直接失败，main source set 的 assets 目录接入拷贝产物。读取按 fail-loud 设计：`LiteAssets.load(context)` 打开两个 asset 路径并经共享 contract 解析器解析，缺席或畸形字节即抛错——绝不静默回退 BARE。这些字节构造出的 catalog 携带自己的 `BUNDLED` 来源——`LiteToolSchemaSource` 与 `LitePresetSource` 在 `HOST_PROJECTED`/`BARE` 之外的第三个值：条目与活宿主投影经同一文档解析器逐项相同，但选择保持「APK 捆绑字节」的可观测身份，不伪装成活投影、也不伪装成无投影。`LiteSessionAssembler.assemble` 在其上构造完整 `LiteChatViewModel` 链——provider 携带捆绑 schema 作为请求面 `tools` 数组、preset catalog 供给 persona、派发 catalog 保持捆绑回退名域（§31 权限门在该名域已对未知名拒绝）。工厂只做构造；把 view model 挂进 UI 刻意不是它的职责。

## Alternatives considered

把捆绑 catalog 标记为 `HOST_PROJECTED` 被拒：选择的来源是调用方可观测的事实，APK 捆绑字节不是活宿主协商。assets 缺失时静默回退 BARE 被拒：§32 禁止猜，悄悄不带 tools 数组出场的会话掩盖了构建损坏。把 `tool-descriptors.json` 与两份投影一并打包在本代裁剪掉：独立会话刻意保持回退名域（权限门的 Unknown 收口已覆盖它），Host 声明名属于后续代接线的配对宿主通道。把 `LiteChatScreen` 挂进 `MainActivity` 同样裁剪：先装配、后入口，让 UI 变更作为独立可评审的增量落地。

## Consequences

§32 台账的开放项「app 层运行时接线（assets 打包）」与 §33 的 preset 侧孪生项收口：正式 APK 现在携带与 JVM 镜像测试互验的同字节投影，instrumentation 测试打开两个 asset 路径并走完整装配链而不触网，`:core` 测试钉住 `BUNDLED` 在自己的可观测来源下与 `HOST_PROJECTED` 同解析。独立会话的模型面与 persona 来自构建时冻结的宿主投影字节——正是一个没有配对宿主的本地 harness 环境能诚实声称拥有的东西。权限姿态不变：回退名域保持未知名拒绝，不在设备上编造任何风险事实。§31 四件套清单现在有了可以公开 `runtimeMode = lite` 的活承载面——这也是最后一件开放项。

## Open follow-ups

把装配好的会话挂进 UI（`MainActivity` 的 Lite 入口）、在现已存在的会话承载面上公开 `runtimeMode = lite`、preset 选择面、为独立 app 捆绑工具声明以获得 Host 声明名域、交互审批档，均仍开放。
