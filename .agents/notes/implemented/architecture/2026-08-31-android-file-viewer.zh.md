# Agent Note: 带分页读取的 Android 文件查看器

Status: implemented

[English](2026-08-31-android-file-viewer.md) | 中文

## 问题

文件标签能列出工作区树却打不开任何东西：`workspaceFiles/read` 没有 Kotlin 消费者，而 Swift 查看器的分页语义——`file-too-large` 拒绝意为"给我一页有界范围"、页以 UTF-16 单位计——只存在于 Apple 侧。

## 决策

`FilesModel` 增加读取面：`readFile` 先无界请求，捕获 `file-too-large` 拒绝后以 offset 0、65536 单位一页重试；`loadMore` 在已载前缀之后取下一页并追加。Kotlin 的 `String.length` 计 UTF-16 码元——恰是线缆单位——偏移与上限无需换算即与宿主同计。`OpenTextFile` 以 StateFlow 携带路径、媒体类型、文本、已载/总单位与 `hasMore`；拒绝映射为中文缘由（二进制、未找到、越出根、非常规文件）。文件标签在面包屑行下渲染查看卡片：非常规条目带"查看"、"关闭"收起、余页未尽时"加载更多"。

## 后果

车道全绿，分页序列被 FakeWire 测试钉住——拒绝、第一页（65536 单位、truncated）、第二页追加尾部——逐跳断言 offset/limit 实参，另有二进制拒绝的消息用例。FakeWire 增加了按方法的顺序应答，正是分页用例需要的替身。查看器按设计只读文本；Diff 与工件查看器是方案排定的后续打磨。

## 考虑过的替代方案

首次就读分页被否决——无界读对小文件一轮即成，重试恰是宿主契约的镜像。按字素簇计数在开始前就被否决——线缆说的是 UTF-16，Swift 侧已在同一条缝上学过这一课。
