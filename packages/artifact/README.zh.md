---
description: "工件词汇族包图：品牌化引用身份与携带它的日志事件。"
kind: "package-group"
---

# artifact/ — 工件词汇族

[English](README.md) | 中文

## 概述

`artifact/` 族是第 56 章的宿主面：`artifact_create` 工具创作完整工件，日志记录其引用、元数据与生命周期（`artifact/created`、`artifact/status`），资源通道保留内容字节。事件只携带引用——内容字节活在消费者解析引用所指向的资源通道里，永不随日志走（跨端方案第 56 章）。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | Role | ctx key |
|---|---|---|
| [`artifact/`](artifact/README.zh.md) | `artifact_create` 工具、`ctx.artifacts` 存储缝与工件的 `SessionEventMap` 成员 | `ctx.artifacts`（服务） |
| [`artifact-local/`](artifact-local/README.zh.md) | 把工件内容字节存储在本机 `DSH_HOME` 之下 | 注册于 `ctx.artifacts` |

-----

<a id="related-documentation"></a>
## 相关文档

- [持久化目录](../../docs/persistence-catalog.zh.md)——每个日志事件的生成文档，含工件。
- [会话事件词汇](../core/session/README.zh.md)——本族扩展的 merge-extensible `SessionEventMap`。
- [伴侣折叠](../remote/link-contracts/README.zh.md)——把这些事件消费进工件面板的参考折叠。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

宿主侧生产方（创建工件并记录这些事件的工具或能力）与宿主侧资源通道是延后增量；词汇先行落地，伴侣消费者与 fixture 因此钉住同一形状。

</details>
