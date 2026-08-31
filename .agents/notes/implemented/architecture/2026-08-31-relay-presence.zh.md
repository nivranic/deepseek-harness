# Agent Note: 由打开的流推导中继 presence

Status: implemented

[English](2026-08-31-relay-presence.md) | 中文

## 问题

第 69 章把 presence 列为会合关切之一，但没有任何东西推导它：设备无法得知账号里的另一台设备是否可达，名册看不到谁持有流。推导源已经存在——流式投递为每台在线设备保持一条打开的连接——所以 presence 必须读这份状态，而不是发明第二条信道。

## 决策

presence 由打开的流推导，绝不单独追踪：设备在其持有至少一条打开的流期间在线。壳在同一状态上提供两个面。`GET /relay/presence?accountId=…` 按注册序应答账号名册 `[{deviceId, platform, online}]`；未知账号列为空。当设备的第一条流打开（在连接排空之后）或最后一条流关闭时，同账号的每条其他打开的流收到一行 `{"type":"presence","deviceId":…,"online":…}`。流行其余情况保持裸的引用信封——`type: presence` 键是唯一判别式，poll 与 stream 上的信封解码不变。presence 行按设计是瞬态的：永不为离线设备排队，离线设备读名册——中继不保存 presence 历史、不持有权威。两个客户端对称消费：`RelayStreamEvent`（envelope | presence）是 Android（`Flow`）与 Apple（`AsyncThrowingStream`）的流元素，`RelayPresence` 两侧解码名册。缺 `deviceId` 的 presence 行在两侧的线边界上响亮失败。

壳已在本地端到端冒烟：名册随流打开翻转、同账号流在连接/关闭时收到上下线对、隔壁账号保持隔离。两条车道对真实本地套接字服务器证明客户端（Android 用 JDK `HttpServer`，Apple 用扩展了原始行与定长体脚本的 NWListener HTTP 服务器）。

## 后果

在线设备现在实时看到账号设备的来去，并可按需读名册；推送投递步可用同一在线态跳过已流式设备的 APNs/FCM。中继车道剩余：壳上 Noise TLS、填入 push-token 槽的 APNs/FCM 投递、后台唤醒。

## 考虑过的替代方案

为离线设备排队 presence 行（处处投递语义）被否决——presence 只在活跃时有意义，重连时排到的"在线"行会是谎言。单独的 presence 订阅端点被否决——设备已持有的流就是订阅；第二条信道会复制会合必须保持最小的连接状态。心跳活性暂被否决——打开的 TCP 流是诚实的 PoC 信号；keepalive 精化随 TLS 一道属于后续。
