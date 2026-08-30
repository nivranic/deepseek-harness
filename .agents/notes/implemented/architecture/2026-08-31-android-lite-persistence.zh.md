# Agent Note: Android Lite 持久化

Status: implemented

[English](2026-08-31-android-lite-persistence.md) | 中文

## 问题

Android 内嵌运行时阶段已能折叠、分发、驱动回合，却没有任何东西能活过进程：作为 Lite 会话的 journal 只存在于内存，第 56 章的资源通道——工件字节与仅引用的事件分离——也没有存储。

## 决策

`LiteStores.kt` 镜像 Apple 的 `LiteStores`。`LiteSession` 即事件溯源 journal：id 加已记录事件，`state` 经增量 `LiteFold.apply` 重放整份 journal——与驱动器实时驱动、一致性 fixtures 钉住的是同一个折叠。`LiteFileSessionStore` 把一个会话持久化为一个 `<id>.litejournal` 文件的 JSON 行（第 11 章的 journal 形状），经同目录临时文件原子改名写入、平台拒绝原子移动时退回普通替换；`save` 整体替换先前 journal，`load` 逐行解码、遇损坏行响亮失败，不存在的会话载为 null。`LiteFileArtifactStore` 是资源通道：每个工件 id 一个原子写的 `<id>.artifact` 文件，`put`/`get`/`remove`，缺失读取为 null。

一处有意的 Kotlin 偏离：存储缝是阻塞调用而非 suspend——Swift 的 actor 隔离同一批操作，而 JVM 上朴素文件 IO 才是惯例，应用层需要时自行包一层调度器。

## 后果

`LiteStoresTest` 钉住生命周期：提交-持久化-重启-恢复（全新 store 实例载入 journal 并折到与实时会话完全一致的会话行与回合结束）、再存整体替换、缺失载 null、删除即移除、损坏 journal 行响亮失败、工件字节经资源通道往返、以及内存重放把取消前缀定稿。Android 车道验证全绿。内嵌运行时最后一个镜像步骤是建在这些缝上的聊天面。

## 考虑过的替代方案

镜像 actor 签名的 suspend 缝被否决——在不存在异步实现的情况下它只会给阻塞 IO 包上仪式；缝保持可换。保存时压缩被否决（第 64 章禁止过早快照）——journal 逐字重放，压缩按该章自己的规则随格式决策一起到来，不提前。
