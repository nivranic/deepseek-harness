---
description: "面向维护者与伴侣端实现者的参考客户端：针对 dsh link-access 载体的配对、SPKI 钉扎 TLS、签名单次 RPC 与 NDJSON Remote 流。"
kind: "package-reference"
---

# @deepseek-ai/dsh-link-client

[English](README.md) | 中文

## 概述

`dsh-link-client` 是 [link-access 载体](../link-access/README.zh.md)的可执行参考契约：从宿主的 QR 载荷配对（在 TLS 握手期、写出任何请求字节之前校验证书指纹），用设备的 Ed25519 密钥签名每个请求，经 `/api` 调用单次 Remote 端点，并以 NDJSON 消费 Remote 流。原生伴侣端（Swift、Kotlin）按同一套线缆词汇复刻此状态机；它们的一致性测试以本包行为为准。

## 目录

- [使用本包](#use-this-package)
- [延伸阅读](#further-exploration)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
import { LinkClient } from '@deepseek-ai/dsh-link-client'
import type { LinkPairingPayload } from '@deepseek-ai/dsh-link-access/protocol'

async function runCompanion(pairingPayload: LinkPairingPayload, sessionId: string): Promise<void> {
  const client = await LinkClient.pair(pairingPayload, { deviceName: 'iPhone' })
  await client.describe()
  await client.call('session/list', {})
  for await (const frame of client.openStream('session/follow', { address: { kind: 'session', sessionId } })) {
    void frame
  }
}
```

`pair` 校验载荷的协议版本与过期时间，然后在钉扎连接上用一次性配对码换取设备身份。`call` 失败时抛出携带载体或网关稳定错误码的 `LinkError`；`openStream` 在调用方中止时安静结束，载体中途断开时抛出 `LinkError`（`carrier-lost`）——调用方重订阅，与浏览器载体的流重启完全一致。

### 保管好凭据

把设备 id 与签名密钥持久化到平台安全存储（Apple 用 Keychain，Android 用 Keystore 支撑的存储）。密钥丢失通过重新配对恢复；旧设备记录应予吊销。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [远程链接访问子系统](../../../docs/subsystems/remote-link.zh.md) — 线缆词汇与信任模型。
- [link-access 载体](../link-access/README.zh.md) — 本客户端对话的宿主侧。
- [remote/ 包图](../README.zh.md) — 本组包。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **不含自动重连** — 客户端提供逐请求与逐流原语；重连策略（退避、重订阅、游标续传）属于伴侣端的领域层，与浏览器客户端的 journal stream 相对应。
- **仅 Node 传输** — 钉扎代理是 `node:https`；Swift 与 Kotlin 传输是伴侣端按同一钉扎规则的自主实现。
- **无后台推送** — 审批唤醒需要未来的中继阶段；本客户端仅在进程存活期间工作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
