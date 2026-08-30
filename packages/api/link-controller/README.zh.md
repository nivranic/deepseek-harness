---
description: "本地 link 管理面的 Host Remote 属主：带 LAN 端点与绑定诊断的载体状态、一次性配对签发、受信设备列表与吊销。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-link-controller

[English](README.md) | 中文

## 概述

`dsh-api-link-controller` 支撑生成的 `ctx.remote.link` 命名空间：跨设备设置页调用 `status` 获取实时载体事实（监听状态、LAN 端点、证书指纹、绑定诊断、对外宿主名、审批开关、受信设备数），调用 `createPairing` 获取一次性二维码载荷，调用 `devices`/`revokeDevice` 管理受信设备。每个方法只经本地载体分发——远程 Allowlist 不收录这些端点，因此已配对的设备永远无法签发配对或吊销同伴。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在同时挂载 link 载体的组合中挂载本控制器；缺少载体的组合里每个调用都以 `link-unavailable` 失败，而不是在加载时失败。

```yaml
- name: '@deepseek-ai/dsh-device-trust'
- name: '@deepseek-ai/dsh-link-access'
- name: '@deepseek-ai/dsh-api-link-controller'
```

### 可观察行为

`status` 合并载体状态与实时名称、审批开关、设备数。`createPairing` 原样转呈载体的二维码载荷，并把停止或绑定失败的载体映射为 `link-disabled`。设备行永不携带公钥；按 id 吊销返回更新后的行，未知 id 返回 `undefined`，空 id 以 `bad-request` 失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

- **只做投影。** 控制器不拥有状态：载体事实来自 `ctx.linkAccess`，设备行经载体服务面来自信任存储，wire 类型在投影边界就丢弃公钥。
- **可选载体。** 每次调用才惰性读取载体，因此控制器可以先于远程访问挂载，后者随后经设置启用。
- **仅本地面。** 远程 Allowlist 不收录任何 `link` 端点；授权守卫在 link 载体上于分发之前拒绝它们。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | Typert Remote 服务、失败映射、设备投影 |
| [`src/types.ts`](src/types.ts) | 浏览器安全的 wire 值与失败词汇表 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴随插件（无运行时不变量：只做投影） |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [远程 link 访问子系统](../../../docs/subsystems/remote-link.zh.md)——访问层的权威契约。
- [link-access 载体](../../remote/link-access/README.zh.md)——本属主投影的服务面。
- [api/ 包地图](../README.zh.md)——Remote 层各包及其仓库定位。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **暂无待配对列表**——签发的配对码一次性且不列出；取消界面随需要它的配对 UX 一起到来。
- **暂无角色编辑**——角色在配对时授予、只读展示；修改能力随设备管理策略一起到来。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
