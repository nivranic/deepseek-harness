# Agent Note: 中继流式投递

Status: implemented

[English](2026-08-31-relay-streaming-delivery.md) | 中文

## 问题

会合地基只交付了按 poll 排空：设备必须反复询问才知道有没有东西到达，而部署壳从未被运行过（其处理器把响应写到请求对象上——每次调用都会抛错）。第 68 章保持中继只做转发，所以增长步必须加投递、不加权威。

## 决策

poll 投递升级为同一 HTTP 词汇上的流式投递，三侧对称。`GET /relay/stream?token=…` 以 `application/x-ndjson` 应答：连接即把该设备的待发队列作为前几行排空，此后连接保持打开，每次实时发布以一行到达。有打开流的设备实时收信封、不再排队——publish 直写打开的流而不入离线队列，poll 与 stream 永不重复投递；未知 token 得到与 poll 一致的确定性空应答（响应头、零行、干净关闭）。壳（`apps/relay/server.mjs`）承载该语义，并已在本地端到端冒烟验证（离线入队 → 连接排空 → 实时推送 → 此后 poll 为空），请求/响应对象 bug 一并修复。设备核心对称消费：Android `RelayClient.stream(token)` 返回 `Flow<RelayEnvelope>`（仅对响应头设超时，body 不设限）；Apple 补齐完整 `RelayClient`（基于 URLSession 的 register/publish/poll/stream，`RelayEnvelope`/`RelayDevice` 改为 Codable），`stream(token)` 是骑在 `bytes.lines` 上的 `AsyncThrowingStream`。两条车道都对真实本地套接字服务器证明消费者——Android 用 JDK `HttpServer`（chunked，脚本行之间保持打开），Apple 用 `NWListener` 上手写的最小 HTTP/1.1 服务器（Apple 树里第一个真实套接字测试；URLProtocol 桩无法增量交付 body）。

LAN 直连仍是主传输；该流仍是会合路径，不是 link 客户端里的 `RelayTransport`。

## 后果

在线设备在信封发布的当下即知，无需轮询；离线设备重连后仍按 poll 排空。中继车道剩余：presence 订阅、壳上的 TLS/Noise、以及填入 push-token 槽的 APNs/FCM 投递——该流为那次投递备好了实时路径。

## 考虑过的替代方案

用 WebSocket 做流被否决——钉住的词汇是 HTTP/NDJSON（link 载波同样以 NDJSON 流式），零依赖壳不引入协议实现就无法承载 WebSocket 握手。对在线设备也入队（处处投递、重连去重）被否决——重复抑制会把中继推向它不得持有的投递权威；实时或入队按设备二选一且总量守恒。
