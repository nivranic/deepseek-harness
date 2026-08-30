# Agent Note: Android Lite 工具注册表

Status: implemented

[English](2026-08-31-android-lite-tool-registry.md) | 中文

## 问题

内嵌宿主运行时阶段在 Android 上有了折叠地基却没有分发面：没有什么能命名 Lite 运行时可运行的工具，第 35/36 章的安全立场——仅编译期注册、任意执行一律交接——只存在于 Apple LiteRuntime。

## 决策

`apps/android/core` 的 `LiteToolRegistry.kt` 精确镜像 Apple 注册表：第 36 章 P0 集捆绑 `web_search`、`url_fetch`、`image_inspect`、`attachment_read`、`artifact_create`、`calculator` 及其中文描述，而 `run_tests` 携带 `LITE_REQUIRES_FULL_RUNTIME` 作为回退能力——Lite 循环据此交接而非执行，因为 Lite 运行时按设计无 shell。查询是对编译列表的 firstOrNull；未知名称解析为 null，别无其他。根本没有注册 API，动态构造的名称不可能变得可分发。

## 后果

`LiteToolRegistryTest` 钉住立场：按序的捆绑名称、每个描述符非空描述、按名查找返回精确描述符、`run_tests` 是唯一交接（端上工具以 null 能力自服务）、未知名称——包括 `web_search_exec` 这类近前缀——解析为无。Android 车道验证全绿。折叠与注册表就位后，内嵌运行时的后续步骤镜像 Apple 次序：循环驱动器、持久化、聊天面。

## 考虑过的替代方案

运行期接收描述符的注册 API 被否决——第 36 章的要点正是工具面随应用发布、发布前可审；可变注册表会重新打开设计关上的门。复用伴侣的远程工具轨迹词汇被否决——那是经线缆观察到的宿主侧工具名，不是分发表；注册表是未来 Lite 循环将据以分发的端上权威。
