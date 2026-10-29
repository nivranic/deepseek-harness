# Agent Note: Lite 工具调用碎片组装

Status: implemented

[English](2026-08-30-lite-tool-call-assembly.md) | 中文

## 问题

OpenAI 兼容流把一个工具调用拆成多条增量：第一条命名槽位（`index`、`id`、函数 `name`），后续增量追加 `arguments` 碎片，并行调用按 index 交错。Lite 解析器只认识整call增量，真实的碎片化提供方因此被静默丢弃所有参数续片——循环会派发参数为空或缺半的调用。提供方骨架曾把这一点记为延后。

## 决策

`LiteStreamLineParser.parsePiece` 现在返回该行的种类——文本、推理或原始 `toolCallEntries`——不再过早塑形工具增量。纯值类型 `LiteToolCallAssembler` 拥有跨行状态：以线缆 index 为键的槽位、首次出现即捕获 `id`/`name`、参数碎片串接、缺失 id 默认 `tool-<index>`。`LiteHTTPProvider` 逐条喂入，并在流结束时按 index 顺序 flush 组装完成的调用——OpenAI 兼容工具调用串的完成时刻；从未收到 name 的槽位被丢弃而非半形派发。整call增量（骨架场景）走同一条路径原样 flush，工具调用管线只有一条而非两条。

## 后果

循环从任何 OpenAI 兼容提供方只看到可派发的整call。文本与推理保持逐行发射；工具调用刻意等到流末，对 chat-completions 语义而言时机不可察觉（调用总是消息的结尾）。组装中途断连按设计丢失半成的调用——折叠的网络掉线保留语义覆盖的是流式文本，派发收了一半的调用更糟。测试覆盖 SSE/NDJSON 逐行解析、三碎片单调用组装与 flush 排空、并行 index 按序 flush（默认 id、无名槽位被丢弃）。

## 考虑过的替代方案

"下一个 index 出现即发射前一槽位"被否决——交错顺序不是完成信号，单调用流将永不发射。给 `LiteStreamChunk` 加碎片 case 被否决——循环词汇保持整call；组装是提供方侧的解码关注点。
