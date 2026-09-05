# DSH Relay 会合服务

[English](README.md) | 中文

跨端方案（第 68/69 章）的可自建会合服务：零依赖的 Node HTTP 服务——设备注册、只带引用的信封转发、按 poll 排空、推送流（连接先冲排离线队列，之后活动信封以加密帧到达；在线设备不排队），以及由打开的流推导的 presence（同账号的流收到设备上线/下线帧；presence 端点回答带在线状态的 roster）。每个会合端点都经 Noise 加密；中继永远不是会话数据库、工作区副本或权威，Windows/macOS 宿主保留全部会话权威。协议由 Android 与 Apple 会合核心在各自车道钉住；本服务是自托管镜像。

## 运行

```sh
node apps/relay/server.mjs        # PORT env overrides the default 8787
node apps/relay/selftest.mjs      # local assertions over the full flow; exit 0 = pass
node apps/relay/gen-relay-vectors.mjs  # regenerate the fixed-key Noise vectors, then sync the two native copies
```

<a id="transport-encryption"></a>
## 传输加密

传输是 Noise_XX_25519_ChaChaPoly_SHA256（`noise.mjs`），经 HTTP 携带：`POST /relay/noise/hello`（体 = 握手消息 1）回答消息 2 加 `x-relay-session` 头——消息 2 之后的握手转录哈希，客户端会对照自己的转录校验；`POST /relay/noise/complete`（体 = 消息 3）回答一个加密确认帧 `{"ok":true}` 证明密钥确认。之后每个会合体都是一个或多个传输帧——u16 大端长度前缀，随后是拆分会话密钥下、空关联数据、64 位小端计数 nonce 的 ChaCha20-Poly1305 密文：

- `POST /relay/register` —— 帧 `{accountId, deviceId, platform, pushToken?}` → 帧 `{token}`
- `POST /relay/publish` —— 帧 `{accountId, kind, sessionId, eventId?, turn?}` → 帧 `{delivered}`
- `POST /relay/poll` —— 帧 `{token}` → 零或多个帧的待发信封，排空
- `POST /relay/stream` —— 帧 `{token, streamKey}`：流骑加密请求里客户端生成的 32 字节一次性密钥，因此活动推送从不与 HTTP 应答共享计数器。连接冲排待发队列，之后活动发布与同账号 presence 变化各以一帧到达；未知 token 得到干净的空关闭，在线设备不排队，poll 与 stream 永不重复投递。
- `POST /relay/presence` —— 帧 `{accountId}` → 帧 `[{deviceId, platform, online}]`，由打开的流推导在线状态的 roster。presence 帧是易失的——永不为离线设备排队，离线设备改读 roster；流帧是只带引用的信封，或同账号设备的最后一个流开/关时的 `{"type":"presence","deviceId":…,"online":…}`。

Noise 会话闲置 15 分钟后过期；过期或未知 id 应答 410。客户端串行执行同一会话的请求与响应交换，并在传输、分帧或认证失败后丢弃缓存密钥。失败调用绝不自动重放；下一次显式调用建立新密钥。握手端点保持明文——Noise 在消息 2 与 3 里隐藏静态密钥，这些字节本来就是公开的。

计数器使用无符号 64 位值（Node 使用 `BigInt`）。每个密钥只允许 0 至 `2^64−2` 的 nonce；保留值 `2^64−1` 在加密或解密前即被拒绝，认证失败不推进计数器。服务器以 410 退役耗尽的会话。独立流耗尽后关闭并移除订阅；无法发送的信封保留在队列中。poll 若在传输前加密响应失败，则保留整批队列。这些规则不提供投递确认或持久化队列。

## 跨实现证明

普通仓库测试通过 [`scripts/relay-noise.spec.ts`](../../scripts/relay-noise.spec.ts) 运行 Node 密码学测试集和真实 HTTP 服务。`gen-relay-vectors.mjs` 将合成的固定密钥向量写入 `vectors/relay-noise-vectors.json`；两份原生拷贝必须逐字节一致。Kotlin 与 Swift 回放握手、拆分密钥及传输帧，覆盖 `2^53`、`2^63` 附近和最后可用的 nonce，并在不推进计数器的前提下拒绝错误认证标签。边界帧使用独立编码的 nonce 字节，避免把某个端口的整数转换错误复制进预期结果。

## 边界

- LAN 直连仍是主传输；本会合是转发路径。
- Noise 在中继终结（中继按账号路由，因此读得到它解密的信封）：这是对抗网络观察者的链路安全，不是宿主与设备间的端到端保密。
- 信封只带引用——永不含源代码、提示词、凭据或 diff 内容（第 70 章）。
- APNs/FCM 推送投递在落地时骑 `pushToken` 槽。
