---
description: "面向把一等工件接入日志的维护者的工件存储缝与模型可见 artifact_create 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-artifact

[English](README.md) | 中文

## 概述

本包是工件的宿主面：`ctx.artifacts` 资源通道加模型可见的 `artifact_create` 与 `artifact_read` 工具。一次调用创作一件完整工件——`content` 文本或 base64 `data` 字节，两者恰给其一——日志记录引用、类别、标题、创作格式与生命周期状态（`artifact/created`、`artifact/status`），完整内容字节进入资源通道、永不随事件走（第 56 章）。出厂 `dsh` 组合零配置启用；工件跨重启留存，伴侣面从日志引用渲染工件面板。品牌 `ArtifactId`、`ArtifactFormat` 判别式与两个 `SessionEventMap` 成员也住在这里，契约 fixture 与原生折叠因此钉住线形状。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

默认组合下工件端到端可用：模型以类别、标题与完整内容——`content` 文本或 base64 `data` 字节——调用 `artifact_create`，工件即被存储并记入日志，无需进一步操作。自建组合时，挂载工具包与一个资源通道后端：

```yaml
- name: '@deepseek-ai/dsh-artifact'
- name: '@deepseek-ai/dsh-artifact-local'
```

程序需要 `SessionEventMap` 合并在作用域内时，在 `@deepseek-ai/dsh-artifact/types` 上接一条 type-only 边；fixture 铸造引用时导入 `ArtifactId` 构造器。

<a id="understand-the-implementation"></a>
## 理解实现

`src/index.ts` 声明 `ArtifactStore` 服务（按引用 id 的 `put`/`get`/`remove`——第 56 章的资源通道）并注册工具：`artifact_create` 要求有归属的 agent 会话，修剪并校验类别与标题，拒绝 `content`/`data` 之外的任何组合，严格解码 base64（容忍 ASCII 空白，任何其他非规范输入响亮失败），把创作 `format` 记入 `artifact/created`，经通道写入字节，再记录 `artifact/status`——成功 `ready`，通道拒绝时记录 `failed` 并透出存储失败。`artifact_read` 按日志格式选臂：文本按 UTF-16 码元分页进 `content`，原始字节——或本会话从未记录、格式不可知的 id——按字节分页进 base64 `data`，两臂都带 `truncated`/`size`。`src/types.ts` 持有品牌身份、三态 `ArtifactStatus`、`ArtifactFormat` 判别式与对 `@deepseek-ai/dsh-session/types` 的声明合并；`src/invariant.ts` 强制持久形状（非空且已修剪的类别与标题、封闭的状态集与格式集）与开回合关系，对孤儿状态保持沉默——每个折叠里的合法 no-op。

<a id="further-exploration"></a>
## 进一步探索

- [工具 schema 目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-artifact)——模型收到的生成 `artifact_create` schema。
- [本地工件后端](../artifact-local/README.zh.md)——`DSH_HOME` 下的出厂资源通道。
- [会话事件词汇](../../core/session/README.zh.md)——本包扩展的 merge-extensible `SessionEventMap`。
- [伴侣折叠](../../remote/link-contracts/README.zh.md)——把这些事件消费进工件面板的参考折叠。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型会看到生成的 [`artifact_create` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-artifact)：一个对象，含必填的 `kind`、`title` 字符串，以及恰须提供其一的 `content` 与 `data` 字符串——文本内容，或 base64 编码的字节。描述要求每次调用一件完整工件，禁止存放草稿文本或跨调用拆分。

#### Token 影响

工具可见的每个请求都有固定 schema 开销；描述与 schema 静态不变。

#### KV Cache 影响

定义与可见性不变时前缀保持稳定。插件生命周期或作用域限制可能使从此 schema 起的复用失效。

### 工具 schema——artifact_read

#### 模型看到什么

模型还会看到生成的 [`artifact_read` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-artifact)：一个对象，含必填的 `id` 字符串与可选的 `offset`/`limit` 整数，其单位随工件格式——文本按 UTF-16 码元、原始按字节。描述说明读取不修改工件。

#### Token 影响

工具可见的每个请求都有固定 schema 开销；描述与 schema 静态不变。

#### KV Cache 影响

定义与可见性不变时前缀保持稳定。

### 工具调用历史与结果

#### 模型看到什么

每次 assistant 工具调用都会在参数中保留完整工件内容——文本本身，或字节工件的 base64 编码（约每三字节四个字符）。成功时原样返回 `Artifact ready: <title> (<kind>, <format>) — <id>`。稳定失败文本为 `Error: artifact_create requires a non-empty kind and title`、`Error: artifact_create requires an owning agent session`、`Error: artifact_create requires exactly one of content or data` 与 `Error: artifact_create requires data to be base64-encoded bytes`；存储失败透出通道的错误文本。`artifact/created` 与 `artifact/status` 会话事件是 UI 与回放状态，不是第二条模型消息。

#### Token 影响

Token 增长随模型提交的工件内容伸缩——base64 使原始字节膨胀三分之一——这些调用参数会保留到压缩。结果本身小而定形。

#### KV Cache 影响

只追加；新可见内容跟在可复用请求前缀之后，不会使既有 KV 缓存条目失效。

### 工具调用历史与结果——artifact_read

#### 模型看到什么

读取返回工件的标题行加其记录臂中的内容——文本工件返回 `content`（默认整件，或以 `offset` 与 `limit` 读一个 UTF-16 区间），字节工件返回字节区间上的 base64 `data`；调用会话记录过该工件时附上 `kind` 与 `title`，本会话从未记录的 id 落入 base64 臂，因为那里的创作格式不可知（`truncated` 与 `size` 以该臂单位报告截断）。稳定失败文本为 `Error: artifact_read requires a non-empty id`、`Error: artifact_read offset and limit must be non-negative` 与 `Error: artifact_read found no content stored under id "<id>"`。

#### Token 影响

默认读取把工件完整内容放入对话——字节工件为 base64 膨胀后；分页读取只付出其区间。重复默认读取大工件每次都付出其体积，直到压缩。

#### KV Cache 影响

只追加；读取结果跟在可复用请求前缀之后，不会使既有 KV 缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 缝不定义保留：出厂本地后端提供可选的年龄式清扫（`retentionDays`，默认关闭）；不启用则字节永久存在。
- 一次调用携带完整工件；没有面向超过单次工具调用体积的工件的流式或多段创作。

### 开发备注

<a id="dev-note"></a>

事件形状有意匹配跨语言 conformance fixture 已钉住的 Lite 工件词汇，三个伴侣折叠因此经同一组分支同时消费宿主事件与 Lite 事件。
