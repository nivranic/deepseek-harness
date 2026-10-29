---
description: "代码执行家族的包映射：抽象 ctx.codeRuntime seam、随附的 Node worker TypeScript 后端，以及 CPython 后端使用的 fd-3 线协议。"
kind: "package-group"
---

# code-runtime/ — 代码执行家族

[English](README.md) | 中文

## 概述

`code-runtime/` 组一次运行一个模型编写的程序，并向其提供宿主侧绑定：`code-runtime` 定义抽象的 `ctx.codeRuntime` seam，一次请求解析为 `{ value, logs, error? }`，失败也作为结果字段返回；`code-runtime-worker-thread` 是随附的 TypeScript 后端，每个程序在一个全新 Node worker 中运行；`code-runtime-python` 拥有宿主与任何 CPython 后端共享的 fd-3 线协议。`dsh-tools` 的 PTC 模式挂载该 seam 与一个后端，让模型编写的程序得以组合工具。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`code-runtime/`](code-runtime/README.zh.md) | 抽象 seam：每个后端实现的请求/结果词汇 | `ctx.codeRuntime` |
| [`code-runtime-worker-thread/`](code-runtime-worker-thread/README.zh.md) | 随附的 TypeScript 后端：每个程序在一个全新 Node worker 中运行 | 注册 `ctx.codeRuntime` |
| [`code-runtime-python/`](code-runtime-python/README.zh.md) | Node 宿主与 CPython 子进程之间的 fd-3 线协议 | 纯库 |

-----

<a id="related-documentation"></a>
## 相关文档

- [PTC 运行时子系统参考](../../docs/subsystems/ptc-runtime.zh.md)——执行语义、绑定与 `ctx.codeRuntime` Cordis 面。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
