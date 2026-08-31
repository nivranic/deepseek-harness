---
description: "工件词汇族包图：品牌化引用身份与携带它的日志事件。"
kind: "package-group"
---

# artifact/ — 工件词汇族

[English](README.md) | 中文

## 概述

`artifact/` 族持有会话日志的工件词汇：品牌化引用身份加上 `artifact/created` 与 `artifact/status` 两个事件，把工件的元数据与生命周期记录到宿主持久日志上。事件只携带引用——内容字节活在消费者解析引用所指向的资源通道里，永不随日志走（跨端方案第 56 章）。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| Package | Role |
|---|---|
| [`artifact/`](artifact/README.zh.md) | 品牌 `ArtifactId` 与工件的 `SessionEventMap` 成员 |

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
