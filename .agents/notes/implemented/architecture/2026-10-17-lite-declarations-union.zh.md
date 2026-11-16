# Agent Note：Lite 工具声明以 APK 冻结联合目录交付

Status: implemented

[English](2026-10-17-lite-declarations-union.md) | 中文

## Problem

权限门的声明名域此前生产数据为零：`LiteToolCatalog.fromHostDescriptors` 存在却无调用者，所有生产目录都是硬编码回退表。裁定中一直挡着打包的障碍——六个捆绑本地名（`url_fetch`、`image_inspect`、`attachment_read`、`artifact_create`、`calculator`、`run_tests`）没有宿主对应物（四个完全没有、一对语义错位），单独打包宿主投影会令它们翻转为 Unknown、每个本地工具调用显式失败；把本地名改成最近的宿主 id 又会压迫宿主执行不了的 `supportsLite` 翻转。§32 要求每个工具携带 `ToolDescriptor` 并禁止设备猜。

## Decision

两份文档都作为 APK asset 交付并取并集。app 自有的设备声明（`apps/android/app/lite/lite-tool-declarations.json`——六行、可评审源码、绝不下载；`web_search` 不入内因宿主投影已声明它）与宿主 `tool-descriptors.json` 投影同乘 `copyLiteAssets`，`verifyLiteAssetSources` 在任一缺失或为空时 preBuild 即败。`LiteToolSource` 在 `HOST_DECLARED` 与 `BUNDLED_FALLBACK` 之外增 `BUNDLED`——姊妹目录三分先例：选择来源是可观测事实，APK 冻结字节不是活宿主协商。两个穷尽 `when` 位把 `BUNDLED` 路由进不变的四门梯，`fromBundledDocuments` 增跨文档碰撞守卫：两份文档同时声明的名字没有诚实仲裁，联合 fail-loud 点名冲突 id。装配器组合联合；无 asset 的构造路径保持可观测回退。`run_tests` 声明为 not-lite/high——handoff 存续，策略面理由变化而发射事件保持固定 `requiresFullRuntime` 字面。

## Alternatives considered

向 `tool-descriptors.json` 扩设备行被否决：生成器 boot 真实宿主工具包，设备 id 会泄入配对客户端可见的活 `tools/list` 域。本地名改宿主对应名被否决：六名仅两名有对应、`image_inspect` ↔ `read_image` 语义错位（本地元数据 vs 为模型输入解码）、改名触发镜像测试 supportsLite 一致性子句、把漂移守卫变成错误翻转的 forcing function。仅打包声明数据不切派发目录被否决：门的声明数据仍未接线、目标未达。接线 `NativeGatewayClient.toolDescriptors` 本代被否决：独立会话路径里没有网关；拉取通道属于配对宿主会话。

## Consequences

每个捆绑名的派发决策逐名不变——六本地执行与 `run_tests` handoff——但如今立在声明事实上而非硬编码表，`LiteSessionFacts.toolCatalogSource` 报 `BUNDLED`。镜像测试的冻结 local-only 集成为设备文档的 owned 名，测试侧不交生孪生守卫与运行时碰撞守卫并立：未来宿主工具撞名会响亮重开裁定而非静默冲突。生产执行器仍是 stub——价值在事件形状与未来执行器门控。2026-10-12 前置（任何额外 `supportsLite` 翻转前名先对齐）关闭。

## Open follow-ups

本地名的真机执行器；配对宿主拉取通道（`NativeGatewayClient.toolDescriptors` 完整未接线）；RelayClient 浅退役；support-export 事实投影；审批 ask 档；§54 网络矩阵。
