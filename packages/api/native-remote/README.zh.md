---
description: "可选的加密原生接入：固定 Host 身份、签名设备准入，并与本地浏览器认证分离。"
kind: "package-reference"
---
# 原生 Remote Connection

[English](README.md) | 中文

## 概述

原生设备通过独立 TLS 监听器访问 Host，本地 Web 保持 Cookie 与 Origin 检查。设备固定 Host 证书的 SubjectPublicKeyInfo 指纹，并以已配对密钥签名每次操作。监听器按需启用，要求显式配置监听接口和资源限制。它提供 Gateway RPC 与流，不提供浏览器资源或本地精确 Fetch 路由。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在命名 `dsh` profile 的组合中挂载 `@deepseek-ai/dsh-api-native-remote`，同时组合 credentials、Device Trust 与 Gateway。本包是插件，不是组合包或独立启动器。出厂 profile 默认不启用此监听器。在配置中声明每项监听限制；[配置目录](../../../docs/config-catalog.zh.md)列出接受的字段。

操作者通过 `ctx.nativeRemote.describe()` 读取实际端口与小写 SHA-256 SPKI 指纹。相同事实经 `nativeRemote/describe` 提供，能力为 `native-remote.info.v1`；原生调用者须持有 `device.admin`，本地 Web 保持现有认证。全接口绑定地址不是连接目的地，操作者需另行提供可达地址。配对通过带外方式分发该指纹及 Device Trust 一次性配对码。原生客户端必须在发送 HTTP 字节前核对证书指纹；仅证书主机名匹配或 TLS 握手成功不足以确认 Host 身份。

[设备设置分区](../../client/ui-settings-devices/README.zh.md)在操作者提供使用监听端口的可达 HTTPS origin 后，以二维码和可选择的 JSON 展示一次性载荷。`dsh-native-pairing` 版本 1 格式携带 endpoint、Host 身份与名称、SPKI 指纹、配对码、授予角色及到期时间，区别于旧 Link 夹具。关闭或重新生成展示不会撤销尚未过期的码；Device Trust 仍负责执行过期和单次兑换。

RPC 在 `/api/<endpoint>` 使用 Connection 的 `client-request` envelope。`deviceTrust/redeemPairing` 是唯一允许未签名调用的操作；其他调用均须携带版本化 Gateway 元数据与新的设备签名准入。共享的 `/api/remote.mux` WebSocket 要求每条逻辑流携带签名准入，包括 `$events`。Cookie 不授予权限。带 Origin 或 Fetch Metadata 头的请求会被拒绝，入口不实现 CORS。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

凭据 grant `api-native-remote/tls-identity` 经组合的 provider 保存自签名 P-256 证书及 PKCS#8 私钥。记录写入器串行化并发创建。启动时对临近过期的证书使用同一私钥续期，保留已配对的 SPKI；格式无效或不匹配的材料使启动失败，不静默替换身份。更换密钥要求客户端确认新指纹。

Connection 负责 RPC envelope 解析和有界 HTTP 缓冲。Gateway 设备适配器负责准入、能力权限、回复归属及流撤销。TLS 监听器负责套接字和关闭；共享 mux 应用每条消息和每连接流数量限制。[架构决策](../../../.agents/notes/implemented/architecture/2026-09-25-native-remote-connection-source.zh.md)记录这些职责及证书库约束。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Device Trust](../device-trust/README.zh.md)——一次性配对、签名准入与撤销。
- [Gateway](../gateway/README.zh.md)——Remote 帧与权限分派。
- [Connection](../../client/connection/README.zh.md)——RPC 编解码及本地浏览器认证。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本载体不注册提示词、工具或 Session 事件，只承载现有 Gateway 操作。

#### KV Cache 影响

无直接影响；被调用能力负责模型可见的变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

本包提供 Host 传输，采用范围具有以下限制：

- 原生客户端采用与操作者配对展示分开交付。旧 Android 夹具协议不是此 Gateway 协议。
- 证书在监听器启动时续期，不在进程持续运行期间自动续期。应在证书过期前重启监听器。
- 入口不提供本地下载/上传 Fetch 路由、浏览器资源、发现或 Relay 接入。
- 不发布运行时不变式伴生入口：准入和密钥一致性由各自操作直接执行，此处没有独立维护的投影。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
