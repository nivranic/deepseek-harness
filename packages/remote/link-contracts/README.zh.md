---
description: "远程 link 线缆词汇表的可执行契约：钉住协议类型的 zod schema、黄金 fixtures，以及生成跨语言 manifest 与 Swift/Kotlin 模型、供原生伴侣端对齐的生成器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-link-contracts

[English](README.md) | 中文

## 概述

`dsh-link-contracts` 是原生伴侣端编译所依据的唯一事实来源：一张声明式表命名 link 词汇表的全部 wire 类型——配对载荷、配对响应、带能力对象的宿主描述、载体状态、设备记录与管理状态行——每类一个黄金 fixture 固定确切线缆字节。zod schema 在编译期钉住 TypeScript 协议类型，wire 类型变更会先在这里被 typecheck 拦下；生成器随后产出带 fixture 校验和的语言中立 manifest 以及 Swift `Codable` 与 Kotlin 数据模型，漂移门禁在重新生成的产物提交前使 CI 失败。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

生成器从仓库根运行；漂移门禁挂在 `hygiene` 聚合里。

```sh
pnpm run gen-link-contracts      # regenerate manifest + Swift + Kotlin
pnpm run verify-link-contracts   # fail when committed artifacts are stale
```

### 可观察行为

wire 类型变更会暴露两次：zod schema 不再满足协议类型（typecheck），重新生成的 manifest、Swift 或 Kotlin 文本不再匹配已提交文件（漂移门禁）。fixtures 在单元套件里经 schema 往返，每条校验和都点名它钉住的 fixture，伴侣端的解码测试因此可以依赖同一份字节。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

- **用表而非反射。** `src/index.ts` 的声明式表显式命名每个类型、字段、种类、常量与可选性；发射器是纯字符串工作、不碰文件系统，漂移门禁得以逐字节比较。
- **每类型三重钉住。** 协议接口（真实契约）、zod schema（`satisfies z.ZodType<…>`）、fixture（`satisfies` 接口）——三者任何漂移先成为编译错误，再成为门禁失败。
- **常量字段保持为字段。** 版本与 kind 常量以带注释的标量字段发射，而非硬编码解码分支，协议升级在 manifest diff 里一目了然。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 类型表、fixtures、钉住协议类型的 zod schema |
| [`src/generate.ts`](src/generate.ts) | manifest、Swift、Kotlin 产物的纯发射器 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴随插件（无运行时不变量：纯契约库） |
| [`generated/`](generated/) | 发射的 manifest、Swift、Kotlin——永不手改 |

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

- **只发射模型，不含传输**——产物是编解码器；网络、存储与 UI 随 Phase 2 伴侣应用一起到来。
- **数字按 double 发射**——时间戳与版本在两种语言里都发射为浮点标量；若出现超出 double 精度的 wire 值再引入精确整数处理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
