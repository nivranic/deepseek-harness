---
description: "面向把工件事件接入会话日志或从伴侣折叠消费它们的维护者的工件引用词汇包。"
kind: "package-reference"
---

# @deepseek-ai/dsh-artifact

[English](README.md) | 中文

## 概述

本包持有会话日志的工件词汇：品牌化的 `ArtifactId` 引用身份与两个 `SessionEventMap` 成员——`artifact/created` 与 `artifact/status`——把工件放上宿主的持久事件日志。日志事件只携带引用、粗粒度类别、人类可读标题与生命周期状态；内容字节永不随事件走，活在消费者解析引用所指向的资源通道里。伴侣面（跨端折叠与原生伴侣应用）消费这套词汇渲染工件面板，契约 fixture 以黄金场景回放它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

程序需要 `SessionEventMap` 合并在作用域内时，在 `@deepseek-ai/dsh-artifact/types` 上接一条 type-only 边；fixture 或生产方铸造引用时导入 `ArtifactId` 构造器：

```ts
import { ArtifactId } from '@deepseek-ai/dsh-artifact/types'
```

宿主生产方像每个插件域一样，经由会话追加这两个事件来记录工件；本包不注册插件、工具或 schema。

<a id="understand-the-implementation"></a>
## 理解实现

`types.ts` 声明品牌化身份、三态 `ArtifactStatus`，以及对 `@deepseek-ai/dsh-session/types` 的声明合并。合并被生成的已知事件守卫（`dsh-session/known-event-types`）拾取——持久层因此拒绝携带工件事件但不被当前构建理解的日志——也被生成的持久化目录文档化。新增成员只是词汇：`SESSION_FORMAT_VERSION` 不动，因为旧运行时拒绝新类型而不是误读它们。

<a id="further-exploration"></a>
## 进一步探索

- [会话事件词汇](../../core/session/README.zh.md)——本包扩展的 merge-extensible `SessionEventMap`。
- [持久化目录](../../../docs/persistence-catalog.zh.md)——每个日志事件的生成文档，含工件。
- [伴侣折叠](../../remote/link-contracts/README.zh.md)——把这些事件消费进工件面板的参考折叠。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 词汇先行于宿主生产方：尚无工具或能力发出 `artifact/created`，在该增量落地前录制会话不含工件事件。
- 宿主侧资源通道（在宿主上把 `ArtifactId` 解析为内容字节）随该生产方一并延后；伴侣 Lite 运行时今天持有自己的存储。

<a id="dev-note"></a>
## 开发备注

事件形状有意匹配跨语言 conformance fixture 已钉住的 Lite 工件词汇，三个伴侣折叠因此经同一组分支同时消费宿主事件与 Lite 事件。
