# DSH Relay 会合服务

[English](README.md) | 中文

跨端方案（第 68/69 章）的可自建会合服务：零依赖的 Node HTTP 服务——设备注册、只带引用的信封转发、按 poll 排空、推送流（连接先冲排离线队列，之后活动信封以加密帧到达；在线设备不排队），以及由打开的流推导的 presence（同账号的流收到设备上线/下线帧；presence 端点回答带在线状态的 roster）。每个会合端点都经 Noise 加密；中继永远不是会话数据库、工作区副本或权威，Windows/macOS 宿主保留全部会话权威。协议由 Android 与 Apple 会合核心在各自车道钉住；本服务是自托管镜像。

## 运行

```sh
node apps/relay/server.mjs        # PORT env overrides the default 8787
node apps/relay/selftest.mjs      # local assertions over the full flow; exit 0 = pass
node apps/relay/gen-relay-vectors.mjs  # regenerate the fixed-key Noise vectors, then sync the two native copies
```

## 传输加密

传输是 Noise_XX_25519_ChaChaPoly_SHA256（`noise.mjs`），经 HTTP 携带：`POST /relay/noise/hello`（体 = 握手消息 1）回答消息 2 加 `x-relay-session` 头——消息 2 之后的握手转录哈希，客户端会对照自己的转录校验；`POST /relay/noise/complete`（体 = 消息 3）回答一个加密确认帧 `{"ok":true}` 证明密钥确认。之后每个会合体都是一个或多个传输帧——u16 大端长度前缀，随后是拆分会话密钥下、空关联数据、64 位小端计数 nonce 的 ChaCha20-Poly1305 密文：

- `POST /relay/register` —— 帧 `{accountId, deviceId, platform, pushToken?}` → 帧 `{token}`
- `POST /relay/publish` —— 帧 `{accountId, kind, sessionId, eventId?, turn?}` → 帧 `{delivered}`
- `POST /relay/poll` —— 帧 `{token}` → 零或多个帧的待发信封，排空
- `POST /relay/stream` —— 帧 `{token, streamKey}`：流骑加密请求里客户端生成的 32 字节一次性密钥，因此活动推送从不与 HTTP 应答共享计数器。连接冲排待发队列，之后活动发布与同账号 presence 变化各以一帧到达；未知 token 得到干净的空关闭，在线设备不排队，poll 与 stream 永不重复投递。
- `POST /relay/presence` —— 帧 `{accountId}` → 帧 `[{deviceId, platform, online}]`，由打开的流推导在线状态的 roster。presence 帧是易失的——永不为离线设备排队，离线设备改读 roster；流帧是只带引用的信封，或同账号设备的最后一个流开/关时的 `{"type":"presence","deviceId":…,"online":…}`。

Noise 会话闲置 15 分钟后过期；应答 410，客户端重新握手。中继从未建立的 id 同样应答 410。握手端点保持明文——Noise 在消息 2 与 3 里隐藏静态密钥，这些字节本来就是公开的。

## 跨实现证明

没有 CI 车道运行本 Node 服务，互操作由固定密钥向量钉住：`gen-relay-vectors.mjs` 以钉住的 X25519 标量驱动一次完整握手与双向流量，写出 `vectors/relay-noise-vectors.json`；拷贝放在 Android 与 Apple 测试包里，它们的 Noise 端口必须逐字节复现握手消息、会话 id、通道绑定、拆分密钥与每一帧。

## 边界

- LAN 直连仍是主传输；本会合是转发路径。
- Noise 在中继终结（中继按账号路由，因此读得到它解密的信封）：这是对抗网络观察者的链路安全，不是宿主与设备间的端到端保密。
- 信封只带引用——永不含源代码、提示词、凭据或 diff 内容（第 70 章）。
- APNs/FCM 推送投递在落地时骑 `pushToken` 槽。
