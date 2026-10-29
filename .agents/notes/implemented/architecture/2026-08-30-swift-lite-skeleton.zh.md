# Agent Note: Swift Lite 运行时骨架

Status: implemented

[English](2026-08-30-swift-lite-skeleton.md) | 中文

## 问题

Lite 行为规范此前只有 TypeScript 参考代码与 fixture 字节；Phase 3 需要它的原生一半——一个解码规范事件、按参考语义折叠、回放黄金场景的 Swift 模块——以及第 36 章界定应用内置 Lite 运行时可派发范围的静态工具注册表。

## 决策

第三个 SwiftPM 库目标 `LiteRuntime`（iOS 17+/macOS 14+）拥有规范的 Swift 面。`LiteEvent` 是十七个 fixture 事件形状上的解码标签联合；`LiteFold` 精确镜像 `foldLiteDomain`——取消把已送达流式前缀定稿为中断助手行、网络掉线保留部分内容、提供方错误清除流式并设定终局结果——`LiteDomainState` 的 JSON 键与 TypeScript 发射一致。`LiteToolRegistry` 承载第 36 章的内置集合（web_search、url_fetch、image_inspect、attachment_read、artifact_create、calculator）外加一个 `fallbackCapability` 为 `requiresFullRuntime` 的 `run_tests` 描述符：任意执行移交完整 harness 而非端上执行，未知名字解析为 nil、绝不动态派发。gen/verify 流水线现在把 lite-conformance fixtures 同步进 `Tests/LiteRuntimeTests/Fixtures`（取代此前 SharedAppleRemoteCore 拷贝），一致性测试解码每个场景、折叠事件、断言与期望状态相等，并检查第 63 章全部十一个点被覆盖。

## 后果

第 63 章的环在原生侧闭合：同一份 fixture 字节驱动 TypeScript 参考（漂移门禁）与 Swift 折叠（解码-折叠-比较），任何语义分歧都会失败于门禁或回放。Swift 在本机仍是已编写未编译（既有的 macOS 车道告解）。注册表刻意只有词汇——尚无执行器、提供方适配器或循环驱动；那些是 Phase 3 的后续增量，将直接消费这个折叠与注册表。

## 考虑过的替代方案

从契约表生成事件模型被否决——表建模结构体与枚举，而规范的事件是带每变体载荷的标签联合；手工解码让判别标签保持显式。经由伴侣端 `CompanionSessionFold` 折叠被否决——Lite 是自己的运行时词汇（第 33 章），耦合两个折叠会让规范被远程面的变更绑架。注册表里放执行器桩被否决——假装能跑的工具不如诚实地解析为 nil 的名字。
