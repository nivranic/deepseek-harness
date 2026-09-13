---
description: "远程 link 线缆词汇表的可执行契约：钉住协议的 zod schema、黄金 fixtures，以及生成式 JSON Schema、manifest、Swift 与 Kotlin 模型。"
kind: "package-reference"
---

# @deepseek-ai/dsh-link-contracts

[English](README.md) | 中文

## 概述

`dsh-link-contracts` 是原生伴侣端编译所依据的唯一事实来源。一份声明式源图命名认证 unary envelope（`payload.args`）、NDJSON stream 请求与 value/error frame、Remote Event 的 ready/emit/waterfall/cancel/result 词汇、持久 Session sequence 与 snapshot cursor 语义、配对和宿主描述值、伴侣端渲染的 Session 载荷、工作区文件值、子代理值、附件、工件与 handoff 值。黄金 fixtures 钉住包括成功 void result 与结构化 rejection 在内的每个语义变体。钉住协议的 zod schema 拒绝缺失的必填字段，并忽略 JSON-safe 的未知可选字段；生成器从同一源图产出机器可读 JSON Schema、带校验和与兼容规则的语言中立 manifest、Swift `Codable` 与 Kotlin 模型。任何 derivative 未重新生成时，漂移门禁都会使 CI 失败。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

生成器从仓库根运行（同时同步 Apple 与 Android 拷贝）；漂移门禁挂在 `hygiene` 聚合里。

```sh
pnpm run gen-link-contracts      # regenerate manifest + Swift + Kotlin + conformance scenarios
pnpm run verify-link-contracts   # fail when committed artifacts are stale
```

### 可观察行为

wire 类型变更会暴露两次：zod schema 不再满足协议类型（typecheck），重新生成的 JSON Schema、manifest、Swift、Kotlin 或 fixture 文本不再匹配已提交文件（漂移门禁）。manifest 携带相互独立的 `protocolVersion`、`contractVersion` 与 `sessionFormatVersion` 轴、认证路由与 header、支持的能力、兼容规则和恢复语义。生成式 fixtures 先由真实 Gateway 与 TLS carrier 测试消费，再把相同字节复制到两套原生测试树。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

- **用图而非反射。** `src/index.ts` 的声明式源图显式命名每个类型、字段、种类、常量、可选性、fixture 变体、路由、header、能力、版本与兼容规则；发射器是纯字符串工作、不碰文件系统，漂移门禁得以逐字节比较。
- **每类型四重钉住。** 协议接口、zod schema（`satisfies z.ZodType<…>`）、fixture（`satisfies` 接口）与生成式 JSON Schema——类型漂移会在编译或生成器门禁阶段失败。
- **JSON 透传保持显式。** 递归 JSON 值拒绝 `undefined`、非有限数、负零、bigint、symbol、function 与 cycle。未知可选对象字段会被接受并丢弃，缺失的必填字段或无效 discriminant 仍是错误，Host parser 另行拒绝属于其他 outcome 变体的保留字段。
- **恢复语义有记录，不由客户端发明。** Session 事件 sequence number 单调递增，snapshot `cursor` 是已包含的最高 sequence，replay 忽略不高于该 cursor 的记录。stream cancellation 是 transport abort，不是另一种 wire frame。
- **常量字段保持为字段。** 版本与 kind 常量以带注释的标量字段发射，而非硬编码解码分支，协议升级在 manifest diff 里一目了然。
- **会话事件钉住宿主词汇表。** 每个事件载荷 fixture 都满足真实的 `SessionEventMap` 成员（含 `plan/mode`、`todo/write`、`goal/change` 的插件合并），宿主侧载荷变更会先在这里被 typecheck 拦下；行上的 `sessionEvents`/`chunkRows` 标签必须是 `LinkSessionEventKind`/`LinkChunkRowKind` 枚举的取值，发射器拒绝任何其他标签。
- **Lite 行为规范。** `foldLiteDomain` 是把端上 Native Harness Lite 运行时的生命周期事件（prompt、流式、取消、工具调用/结果、plan、todo、artifact、提供方与网络错误、移交——方案第 33/34/63 章）折入其领域状态的参考折叠；`generated/lite-conformance/<id>.json` 把每条黄金无钥事件序列与推导出的期望状态配对，走同一漂移门禁，等待 Swift 与 Kotlin 的 Lite 运行时回放。行为兼容，不要求实现一致。
- **领域状态一致性场景。** `foldCompanionDomain` 是把 follow 记录折入伴侣领域状态（时间线摘要、plan/todo/goal、工具轨迹）的参考折叠；`generated/conformance/<id>.json` 把每条黄金记录序列与其推导出的状态配对，原生折叠回放同一字节必须得到与 TypeScript 完全一致的结果——方案第 62 章"同一 fixture、同一领域状态"的保证，走同一漂移门禁。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 类型表、fixtures、钉住协议类型的 zod schema |
| [`src/generate.ts`](src/generate.ts) | JSON Schema、manifest、Swift、Kotlin 产物的纯发射器 |
| [`src/companion-fold.ts`](src/companion-fold.ts) | follow 记录上的参考领域状态折叠 |
| [`src/lite-spec.ts`](src/lite-spec.ts) | Lite 行为规范：事件词汇、参考折叠、黄金场景 |
| [`src/companion-scenarios.ts`](src/companion-scenarios.ts) | 黄金一致性场景及其发射器 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴随插件（无运行时不变量：纯契约库） |
| [`generated/`](generated/) | 发射的 JSON Schema、manifest、Swift、Kotlin、fixtures 与一致性场景——永不手改 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [远程 link 访问子系统](../../../docs/subsystems/remote-link.zh.md)——这些类型镜像的线缆词汇表。
- [link-access 载体](../link-access/README.zh.md)——被镜像类型的协议属主。
- [remote/ 包地图](../README.zh.md)——组内各包及其仓库定位。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **不拥有 socket 或生命周期**——契约定义 carrier 字节与恢复规则，但 Gateway、TLS carrier 与原生客户端继续拥有 dispatch、socket、认证、重连调度、存储和 UI。
- **封闭事件子集**——本表建模的是伴侣端渲染的会话事件，而非整体可合并扩展的 `SessionEventMap`；未知事件标签保持线缆合法并按通用方式渲染，超出建模范围的变体字段（例如 turn-end 的错误链）会被生成的解码器忽略。
- **数字按 double 发射**——时间戳与版本在两种语言里都发射为浮点标量；若出现超出 double 精度的 wire 值再引入精确整数处理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
