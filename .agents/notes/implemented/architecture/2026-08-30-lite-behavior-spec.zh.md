# Agent Note: Lite 行为规范——Phase 3 地基

Status: implemented

[English](2026-08-30-lite-behavior-spec.md) | 中文

## 问题

Phase 3（Native Harness Lite）在任何 Swift 或 Kotlin 运行时存在之前需要一致性底座：方案第 33 章固定机制（Contract + Lite Behavior Spec + Golden Fixtures + Conformance Tests），第 63 章固定验证点（Prompt、Streaming、Cancel、Tool Call、Tool Result、Plan、Todo、Artifact、Provider Error、Network Error、Handoff Request），第 34 章的 P0 能力清单界定词汇边界，第 35 章的 `requiresFullRuntime` 标记 Lite 运行时必须移交而非自行服务的部分。

## 决策

规范落在 `dsh-link-contracts` 中、与它已拥有的领域状态一致性并列（第 61 章扩展现有 owner 的规则；本包是跨语言漂移机制的 owner）。`src/lite-spec.ts` 定义 Lite 生命周期事件词汇——十七个扁平事件形状，覆盖 prompt 接受/拒绝、流式增量与思考、带 usage 的消息完成、轮次完成/取消、工具调用/结果配对、plan 与整表 todo 变更、artifact 引用/状态（仅元数据，遵循第 56 章大内容不进事件流的规则）、提供方与网络错误、移交请求——以及 `foldLiteDomain`：折入 Lite 领域状态（会话行、流式部分、中断标记、配对工具轨迹、plan/todo、artifact 引用、终局轮次结果、失败、待定移交）的 TypeScript 参考折叠。六条黄金无钥场景覆盖第 63 章全部十一个验证点；`generateLiteConformance` 把每条事件序列与推导出的期望状态配对，既有 gen/verify 流水线发射 `generated/lite-conformance/<id>.json` 并同步 Apple 拷贝，走同一逐字节漂移门禁。

## 后果

原生 Lite 运行时的一致性测试从此就是对已提交字节的简单解码-折叠-比较：回放事件、折叠、匹配期望状态——与伴侣端领域状态一致性同构，后续 Swift Lite 运行时可以整体复用该测试骨架。折叠刻意钉住的行为选择：取消把已送达的流式前缀定稿为中断的助手行；网络掉线停止流但保留部分内容供恢复；提供方错误清除流式并设定终局结果；artifact 只出现引用、从不出现内容。单测断言场景语义（含第 63 章每个点的覆盖）与 artifact 自洽；漂移门禁在重新生成的字节提交前失败。规范先行于实现：尚无运行时、传输或提供方适配器——那些是 Phase 3 的后续增量（对着 mock 提供方场景回放搭 Swift Lite 循环骨架）。

## 考虑过的替代方案

现在就建独立 `packages/lite/*` 包被否决——规范尚无运行时代码，而漂移机制（发射器、门禁、Apple 同步）正是 `dsh-link-contracts` 拥有的；之后拆分只是一次改名。等 Swift 运行时存在再写规范被否决——第 33 章把规范列为保持实现行为兼容的机制，趁无实现偏见时写最便宜。把 Lite 事件建模为会话事件（复用 `SessionEventMap`）被否决——Lite 是原生轻量运行时、有自己的词汇（第 33 章：不是完整 Node harness 移植）；跨兼容性是以后的投影问题，不是共享类型。
