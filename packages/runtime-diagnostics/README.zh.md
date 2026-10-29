---
description: "运行时自诊断的包映射：在活组合内运行包属不变量检查的注册服务。"
kind: "package-group"
---

# runtime-diagnostics/ — 运行时诊断家族

[English](README.md) | 中文

## 概述

`runtime-diagnostics/` 组对运行中的组合做自检：`invariants` 是运行包属 `./invariant` 伴侣的注册服务——各包携带这些检查来验证自己权威事件流与可变快照之间的持久关系——每次失败都以归属到所属包的 `InvariantError` 上报。标准 agent 组合随核心伴侣一起挂载它；只加载该服务不会安装任何检查。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`invariants/`](invariants/README.zh.md) | 运行包属不变量伴侣并归属每次失败的注册服务 | `ctx.invariants` |

-----

<a id="related-documentation"></a>
## 相关文档

- [核心子系统参考](../../docs/subsystems/core.zh.md)——`ctx.invariants` 注册面与各检查所验证的持久关系。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
