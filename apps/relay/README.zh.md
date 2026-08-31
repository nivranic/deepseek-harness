# DSH Relay Rendezvous

[English](README.md) | 中文

跨端方案（第 68/69 章）的自托管会合壳：零依赖 Node HTTP 服务——设备注册、仅引用的信封转发、按 poll 排空，以及推送流（连接即排空待发队列，此后实时信封以 NDJSON 行到达；在线设备不再入队）。中继永远不是会话数据库、工作区副本或权威；Windows/macOS 宿主持有全部会话权威。协议由两侧车道里的 Android 与 Apple 会合核心钉住；本壳为自托管而镜像它。

## 运行

```sh
node apps/relay/server.mjs        # PORT env overrides the default 8787
```

端点：`POST /relay/register` `{accountId, deviceId, platform, pushToken?}` → `{token}`；`POST /relay/publish` `{accountId, kind, sessionId, eventId?, turn?}` → `{delivered}`；`GET /relay/poll?token=…` → 排空待发的引用信封；`GET /relay/stream?token=…` → 同样的信封以 NDJSON 行送达——连接即排空待发队列，此后实时发布直达打开的流（未知 token 得到干净的空关闭；在线设备不排队，poll 与 stream 永不重复投递）。TLS 由前置层终结；APNs/FCM 推送唤醒在投递落地时经 `pushToken` 槽接入。

## 边界

- LAN 直连仍是主传输；本会合是转发路径。
- 信封只携带引用——永不携带源码、Prompt、凭据或 Diff 内容（第 70 章）。
- presence 订阅、Noise TLS 与 APNs/FCM 推送投递是中继车道的后续步骤；本壳是 PoC 地基。
