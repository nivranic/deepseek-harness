---
description: "面向启用跨设备访问的宿主的原生远程访问载体：TLS 与 Ed25519 设备认证、固定端点资源作用域，以及现有 Typert 网关面上的一次性配对。"
kind: "package-reference"
---

# @deepseek-ai/dsh-link-access

[English](README.md) | 中文

## 概述

`dsh-link-access` 是原生远程访问载体：一个 TLS 监听器，对已配对设备做认证（带时间窗的 Ed25519 请求签名，对照[设备信任存储](../device-trust/README.zh.md)），执行带角色门控的端点 Allowlist 与固定的 Session、Workspace 资源作用域，并分发到现有 Typert 网关面：单次 RPC 走 Connection 共享 `/api` 处理器，Remote 流以 NDJSON 走 `typertGateway.wireStream`，与桌面载体使用同一对适配器。Device Trust 拥有持久授权；Session、Workspace、Artifact、Attachment 与 Gateway 服务继续拥有业务状态和待定交互状态。远程访问与远程审批默认关闭。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已提供 Connection、Typert 网关与 Device Trust 的组合中挂载本载体（`dsh-web-app` bundle 随附但禁用）。用 patch overlay 启用：

```yaml
- id: link-access
  disabled: false
  config:
    host: 0.0.0.0
    port: 3090
    allowRemoteApproval: true
```

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `false` | 绑定 TLS 载体；显式启用之前远程访问保持关闭 |
| `host` | `127.0.0.1` | 绑定地址；`0.0.0.0` 选择全部接口，并从第一个非内部 IPv4 地址推导配对端点 |
| `port` | `0` | 绑定端口；`0` 由操作系统分配 |
| `endpoints` | 默认远程面 | 完整 Allowlist，整体替换默认值；每行声明调用类别（`unary`/`stream`）、最低角色与资源作用域 |
| `allowRemoteApproval` | `false` | 回答远程审批与提问的独立开关；"能发 Prompt"绝不意味着此项 |
| `pairingRole` | `controller` | 配对时授予设备的角色 |
| `pairingAccess` | `{ sessions: all, workspaces: all }` | 为每台新配对设备持久化的 Session 与 Workspace 授权；部署可用显式身份数组收窄范围 |
| `pairingTtlSeconds` | `300` | 配对码寿命 |
| `clockSkewSeconds` | `300` | 接受的请求时间戳偏移 |
| `maxRequestBodyBytes` | 300 MiB | 单次 RPC 请求体的载体上限 |

### 可观察行为

配对载荷、配对响应与 Host 描述均使用 `ctx.linkAccess.setDeviceName()` 设置的当前名称，操作系统 hostname 只作为初始值。

`ctx.linkAccess.createPairing()` 返回 QR 载荷（宿主 id 与名称、端点、证书 SPKI 指纹、一次性配对码、过期时间）。每个设备请求携带身份、时间戳与覆盖方法、路径、请求体摘要的 Ed25519 签名；未知、已吊销、过期时间戳或签名错误的设备得到 401，超出 Allowlist、低于设备角色、超出持久授权，或——对交互回答——审批开关关闭时得到 403。宿主全局的 Session 与 Workspace 集合在写入套接字前完成投影。交互回答还必须携带该设备的宿主签发 Client 代次、指向已投递且仍待定的事件，并通过事件所属 Session 的授权检查；关闭审批、吊销设备或停止载体时，已经投递的交互会委托回宿主 waterfall。证书一次性生成（ECDSA P-256）并持久化在 `<dshHome>/link-access/` 下，已配对设备跨重启持续有效。`link/describe` 报告相互独立的 Link protocol、contract 与 Session format 版本，客户端无需把应用发布版本误当成 wire 版本，即可分别诊断每条兼容轴。

### 默认远程面

每台设备都可在自身授权内只读观察 Session 与 Workspace（`session/list|search|page|modelCatalog|attachment|artifact|follow|control`、`workspace/follow`、`workspaceFiles/list|read`、`subagents/list`、`fileReferences/list`、`$events`）。controller 可在这些授权内执行 Session 操作（`prompt`、`cancel`、`updateQueue`、`rename`、`fork`、`selectModel`），也可提交 `session/handoff`；该 snapshot 会创建新的 Full Session，因此没有既有 Session 身份可供检查。`$events/result` 只能回答同一 controller 代次实际收到的交互，并继续受独立审批开关保护。设置变更、凭据、插件管理与直接创建 Session 在部署列出之前均不远程暴露。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

- **同一套线缆，不同的信任栅栏。** 单次调用构造 WHATWG `Request` 交给 Connection 共享 fetch 处理器；流以 NDJSON 帧泵送 `wireStream.open`（每项 `{"k":"v"}`，失败 `{"k":"e"}`）。浏览器 cookie 栅栏从不适用；设备栅栏拥有这条路由。
- **钉扎校验的 TLS。** 证书在此按固定 X.509 v3 模板（无扩展、ecdsa-with-SHA256）基于 node 生成的 P-256 密钥组装；设备在写出任何请求字节之前钉住 QR 载荷中的 SPKI SHA-256，因此证书链无关紧要。
- **固定资源提取。** 产品端点作用域在加载期解析且不可覆盖。载体在分发前检查顶层 Session 与 Workspace 授权，在写入套接字前过滤集合和事件输出；顶层授权通过后，Artifact、Attachment 与 Workspace path 的归属检查仍由原有 owner 负责。自定义端点必须显式声明 `unscoped`。
- **Gateway 拥有交互。** `$events/result` 只接受已认证设备的活动宿主签发 Client 代次，以及 Gateway 仍报告为待定的投递。载体不记录第二套审批注册表；被过滤、禁用、吊销或停止的代次通过 Gateway 既有的 `next` outcome 委托。
- **诚实的拆除。** 流在载中途断开时报错（参考客户端中为 `carrier-lost`），绝不伪装成正常结束，调用方因此重订阅而不是把静默当完成。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务、配置、TLS 服务器、路由、认证与分发 |
| [`src/authorization.ts`](src/authorization.ts) | 请求作用域检查，以及写入套接字前的单次、流和 Remote Event 投影 |
| [`src/protocol.ts`](src/protocol.ts) | 线缆词汇：路由、头、Allowlist 契约、签名输入、载荷 |
| [`src/tls.ts`](src/tls.ts) | 证书生成/持久化与 SPKI 指纹 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生（无运行时不变式：拒绝是载体测试覆盖的逐请求行为） |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [远程链接访问子系统](../../../docs/subsystems/remote-link.zh.md) — 信任与授权契约。
- [参考客户端](../link-client/README.zh.md) — 校验原生伴侣端的可执行契约。
- [设备信任存储](../device-trust/README.zh.md) — 本载体据以授权的记录。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **尚无 LAN 发现** — 配对载荷携带显式端点；mDNS 广播（`_dsh-link._tcp`）随 Phase 1 宿主 UI 延后。
- **无中继、无 NAT 穿透** — V1 只覆盖 LAN 或用户自管私有网络内的设备；公网延续是独立的未来项目。
- **仅时间窗防重放** — 防重放是时钟偏移窗口；在基准测试证明必要之前，刻意不做逐 nonce 追踪。
- **尚无授权管理 UI** — `pairingAccess` 固定新配对设备的授权；当前要更改既有设备授权，需要先吊销再重新配对。
- **宿主描述刻意保持声明式**——描述报告身份、三条相互独立的 wire/data 版本轴、运行时类别与能力字面量；它不协商应用发布 channel，也不会静默降级不受支持的 contract。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
