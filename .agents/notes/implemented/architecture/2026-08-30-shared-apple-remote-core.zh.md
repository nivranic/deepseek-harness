# Agent Note: Shared Apple Remote Core（Phase 2 开篇增量）

Status: implemented

[English](2026-08-30-shared-apple-remote-core.md) | 中文

## Problem

原生化方案（E:\11585 方案，第 73 章）的 Phase 2 以 Shared Apple Remote Core 开篇：在任何 iOS/iPadOS/macOS 伴侣 UI 存在之前，Apple 侧需要 link 客户端状态机——配对、SPKI 钉扎、签名单次 RPC、NDJSON 流——构建于契约生成器已发射的 wire 模型之上，并按第 19 章跨语言回放黄金 fixtures。仓库此前没有 Swift 代码、没有 SwiftPM 包，也没有机制让生成产物的 Swift 侧拷贝保持新鲜。

## Decision

`apps/apple` 是一个 SwiftPM 包（iOS 16+、macOS 13+），`SharedAppleRemoteCore` target 不引入任何 UI 地镜像 `dsh-link-client` 的状态机：`LinkClient`（在生成式 request、response、stream 与递归 JSON 模型上完成配对 / 描述 / 调用 / 流）、`LinkSigning`（规范签名输入 `timestamp\nmethod\npath\nsha256hex(body)`、CryptoKit 的 Ed25519、Ed25519 与 P-256 密钥的固定 SPKI 头）、`LinkPinningDelegate`（在 TLS 挑战处理器里计算叶证书的 SPKI 指纹，任何不匹配都在写出请求字节之前取消握手），以及藏在 `LinkCredentialsStoring` 协议后的凭据（Keychain 与内存两种实现）。生成产物是同步而非分叉：`gen-link-contracts` 把 `LinkContracts.swift` 写进包源码、每个黄金 fixture 一份 JSON 写入 `generated/fixtures/`，并把 fixtures 拷贝进测试 bundle 资源；`verify-link-contracts` 逐字节比对每一份拷贝。XCTest fixtures 把每个 JSON 解码进生成模型；签名测试覆盖规范输入、SPKI 组帧与签名/验签往返。

fresh pairing 把新绑定的 `LinkClient` 返回给 `CompanionRootView`，全部模型都以这一组 endpoint、pin 与 credential store 构建。unary 调用要求 Host 回显请求 `rpcId`，把成功但省略 value 的响应当作 void，并拒绝跨分支 result 字段。交互收件箱只接受 waterfall frame，从 `request` 读取用户可见字段，移除 cancel frame，并用当前 Host `ready.clientId` 发送 outcome；重连会清空旧一代身份，直到收到下一条 ready frame。

## Consequences

wire 类型变更会依次被 TypeScript 契约检查、生成产物漂移门禁与 macOS Apple 车道的 SwiftPM fixture 回放拦下。同一组 fixtures 覆盖 value、void、error、Remote Event 与 Session recovery 变体；`LinkClient.value` 另行证明 rpcId correlation 与 void 行为。Windows 无法执行 Swift/Xcode，本地证据因此保持 `NOT_EXECUTED`，native compile 与 runtime 证据归 Apple 车道所有。真实 Host-to-Swift acceptance 仍是独立的 Gate 1 blocker；生成式字节和 fake-wire view-model 测试不能替代它。

## Alternatives considered

手工把模型卖进 Swift 包被立即否决——那会分叉契约。从包源码 symlink 到 `generated/` 可以避免拷贝，但 SwiftPM target 不能包含包目录之外的文件，且 Windows 检出无法物化链接。先用 Swift 重写参考客户端的测试也被延后：fixture 回放加签名词汇测试钉住了 wire 契约，而完整的状态机测试（Swift 里的本地 TLS 服务器）属于能真正运行它们的编译车道。
