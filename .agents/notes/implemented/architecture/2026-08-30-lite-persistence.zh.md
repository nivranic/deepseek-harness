# Agent Note: Lite 会话持久化与 artifact 存储

Status: implemented

[English](2026-08-30-lite-persistence.md) | 中文

## 问题

Lite 运行时已能驱动轮次、折叠状态，但什么都不记得：没有可恢复的持久会话日志（方案第 11/15 章——journal 与恢复是状态脊柱），也没有 artifact 内容通道，尽管行为规范已携带 artifact 引用与状态（第 56 章规则：事件携带引用，内容走单独通道）。

## 决策

`LiteSession` 是事件溯源日志：一个 id 加有序 `LiteEvent`，经 `LiteFold` 重放推导状态——与一致性 fixture 钉住的同一折叠，持久化因此无法漂离规范语义。`LiteEvent` 及支撑类型补上 `Encodable`（解码已有）；`LiteFileSessionStore` 每会话持久一个只追加的 JSON-lines 文件（`<id>.litejournal`，每行一个编码事件，保存时原子替换），加载逐行解码返回可重放会话。`LiteFileArtifactStore` 是资源通道：每 artifact id 一个内容文件（`<id>.artifact`），原子写入、读取与删除。两者都是协议后的 actor，测试与未来后端可自由替换。

## 后果

Lite 会话现在靠重放跨重启存活——每轮后保存、打开时加载并折叠——没有需要保持一致的第二投影，artifact 内容按构造就留在事件流之外。存储测试覆盖日志往返与重放等价、删除、artifact 内容往返。Swift 在本机仍是已编写未编译（既有的 macOS 车道告解）。刻意缺席：快照压缩（日志随增量增长；第 64 章禁止过早优化）、附件摄取、宿主上传/下载端点——那些随需要它们的产品面落地。

## 考虑过的替代方案

持久化折叠状态快照被否决——那是需要保持一致的第二表示；日志加确定性折叠正是方案点名的恢复模型。骨架阶段用 SQLite 被否决——文件日志人类可读、原子性平凡，协议缝允许以后换数据库而不动调用方。把 artifact 字节存进事件被直接否决——第 56 章的明文规则。
