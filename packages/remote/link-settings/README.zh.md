---
description: "远程 link 载体的设置桥接：拥有 `remote` 设置命名空间（启用跨设备访问、允许远程审批、设备名）并实时应用每次提交，供从设置页驱动配对的组合使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-link-settings

[English](README.md) | 中文

## 概述

`dsh-link-settings` 是用户设置文档与 [link 载体](../link-access/README.zh.md)之间的桥接：它注册 `remote` 命名空间——`enabled`、`allowRemoteApproval`、`deviceName`——并把每次提交实时推入 `ctx.linkAccess`，翻转 TLS 监听器、独立的审批开关与对外通告的宿主名。挂载本桥接的组合以该命名空间为这三个字段的唯一属主；无头部署继续直接配置载体插件本身。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在设置页驱动载体的组合中挂载本桥接；它依赖 settings 服务与 `ctx.linkAccess`，在发生提交前保持惰性。

```yaml
- name: '@deepseek-ai/dsh-device-trust'
- name: '@deepseek-ai/dsh-link-access'
  config:
    enabled: false
- name: '@deepseek-ai/dsh-link-settings'
```

### 可观察行为

命名空间默认远程访问关闭、远程审批关闭、使用操作系统主机名。一次提交先应用名称与审批开关、再动监听器，因此新启用的载体通告的是已提交的身份。载体绑定失败（例如端口被占）会被包含：命名空间保留用户意图，载体通过自身状态报告失败。空的 `deviceName` 重置为操作系统主机名。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

- **命名空间即属主。** 桥接挂载时应用一次当前解析值，并通过注册作用域的 watcher 跟随每次提交；销毁桥接会注销命名空间，之后的提交会响亮失败而非静默失效。
- **顺序约定。** `setDeviceName` 与 `setAllowRemoteApproval` 是同步赋值，先于串行化的 `setCarrierEnabled` 队列执行，因此监听器永远不会通告过期身份。
- **无运行时不变量。** 桥接是纯观察者：schema 校验在提交时拒绝非法段落，载体关系按设计为最后写入者胜。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 桥接服务、命名空间 schema、实时应用 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴随插件（无运行时不变量：纯观察者） |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [远程 link 访问子系统](../../../docs/subsystems/remote-link.zh.md)——访问层的权威契约。
- [link-access 载体](../link-access/README.zh.md)——本桥接驱动的运行时开关面。
- [remote/ 包地图](../README.zh.md)——组内各包及其仓库定位。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **每个组合一座桥接**——settings 服务拒绝重复的命名空间注册，因此两次挂载本插件会响亮失败而非竞态。
- **无按字段授权**——settings 提供方接受的任何写入方都能翻转该命名空间；字段级权限随远程设置的权限预设覆盖一起到来。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
