# Agent Note: 中继会合地基

Status: implemented

[English](2026-08-31-relay-rendezvous-foundation.md) | 中文

## 问题

第 68/69 章把中继延后，而推送路径的每个依赖都悬在它上面：APNs/FCM 投递与后台唤醒需要可经其投递的东西，却没有设备注册、没有转发。方案的约束仍然成立：中继只做会合与转发——绝不是会话数据库、工作区副本或权威——Windows/macOS 宿主持有全部会话权威。

## 决策

最小地基是会合语义，双侧 app 核心对称钉住：`RelayRendezvous`（内存态、按 69.1 单账号）注册设备——身份加 APNs/FCM 投递将填的 `pushToken` 槽——向账号的每台设备发布一封仅引用信封、按 poll 以到达序排空；账号隔离、未知 token 排空为无。信封即第 70 章最小化词汇（`kind`、`sessionId`、`eventId?`、`turn?`），两侧各自桥接到自己的推送类型（`asPush()` / `pushFromRelayEnvelope`）——推送投递要骑的具体依赖链。Android 另外交付 HTTP 消费者（`RelayClient`：register/publish/poll）并经会合核心支撑的真实本地服务器证明；Apple 的客户端缝随部署的服务到来，其桥在 CompanionUI 测试。`apps/relay/server.mjs` 是供真实部署自托管的壳。它是单独部署的基础设施，而不是 Harness 应用：不挂载 Cordis 树，不拥有会话权威或业务 Gateway，也不持久化 Harness 业务状态；内存中的设备、队列、stream 与 Noise 会话记录均为临时状态。[由一个 dsh 启动应用 profile](2026-08-22-single-dsh-application-launcher.zh.md)负责该分类，[中继 Noise 传输](2026-09-01-relay-noise-transport.zh.md)负责其加密传输。

LAN 直连仍是主传输；第 68 章的告诫在结构上被尊重——这是会合词汇与转发骨架，不是接进 link 客户端的 `RelayTransport`。

## 后果

两条车道验证对称的会合测试（注册与扇出、排空退役队列、账号隔离、未知 token 空）加信封到推送的桥（三种桥接、未知类别桥为无）；Android 的真实服务器回路端到端证明 HTTP 消费者。[流式投递](2026-08-31-relay-streaming-delivery.zh.md)、[presence](2026-08-31-relay-presence.zh.md)与 [Noise 传输](2026-09-01-relay-noise-transport.zh.md)决策分别负责这些扩展。填入 push-token 槽的 APNs/FCM 投递仍不属于本地基。

## 考虑过的替代方案

把中继建成带自有 CI 的 workspace 包被否决——方案钉的是单账号少量设备的会合；零依赖壳加两个钉住协议的核心才是对的体量。让壳通过 `dsh` profile 启动被否决——中继不组合 Harness 服务，不能仅为共用启动器就取得 Cordis 应用生命周期、业务 Gateway 或会话权威。现在就把 `FutureRelayTransport` 接进 link 客户端被否决——第 68 章说不要提前建中继传输；会合词汇与壳保持缝敞开而不假装它已上线。
