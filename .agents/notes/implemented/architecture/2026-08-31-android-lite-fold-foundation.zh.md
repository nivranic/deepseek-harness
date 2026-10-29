# Agent Note: Android Lite 运行时地基——三语言一致的 Lite 领域折叠

Status: implemented

[English](2026-08-31-android-lite-fold-foundation.md) | 中文

## 问题

Lite 行为规范（第 33/34/63 章）已有 TypeScript 参考折叠与金样本钉住的 Swift 镜像，但 Lite 一致性工件从未同步到 Android，Kotlin 折叠也不存在——“同 fixture 同领域状态”只是两语言保证，内嵌宿主运行时阶段在 Android 上没有地基。

## 决策

`apps/android/core` 的 `LiteFold.kt` 精确镜像 `foldLiteDomain`：17 个生命周期事件词汇折入 `LiteDomainState`（带中断标记的会话行、流式窗格、按 id 配对的工具轨迹、plan/todo/工件面板、末次轮次结束、失败记录、待交接）。让 Lite 成为 Lite 的语义原样保留：取消只在已交付文本时把流前缀定稿为中断的助手行，断流的传输保留部分文本以供续传而提供方错误清空，工具结果按 id 配对且容忍孤儿，整值面板末写胜出。

生成器与其漂移门禁补上 Android lite 目的地：`gen-link-contracts` 现在把六个 `lite-conformance` fixtures 写进 `apps/android/core/src/test/resources/lite-conformance`，`verify-link-contracts` 对它拒绝漂移、与 Apple 一视同仁。Kotlin 的 `toJson` 规范化与参考发射一致——中断标记只在真处、可空结尾发 JSON null——回放对期望 fixture 字节做结构化比较。

## 后果

Lite 折叠现在是机器验证的三语言保证：`LiteConformanceTest` 把每个同步 fixture 回放进 Kotlin 折叠并断言状态一致；`LiteFoldTest` 逐一钉住行为（有/无交付文本的取消、断流保留对提供方错误清空、拒绝记录、带孤儿无操作的工具配对、推理流进各自部分）。Android 车道验证全绿。内嵌运行时在 Android 上的后续步骤在此地基上镜像 Apple LiteRuntime 的次序：工具注册表、循环驱动器、持久化。

## 考虑过的替代方案

复用伴侣折叠的工件类型被否决——伴侣面板与 Lite 运行时状态是恰好共享线缆词汇的两个不同领域；独立类型让每个折叠对自己的 fixtures 诚实。等 LiteRuntime 整体一次镜像被否决——折叠是承载一致性的核心，先单独落地让后续驱动器的每个错误都对着钉住的 fixtures 显形，而不是对手写期望。
