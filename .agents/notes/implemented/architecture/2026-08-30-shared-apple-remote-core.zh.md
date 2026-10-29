# Agent Note: Shared Apple Remote Core（Phase 2 开篇增量）

Status: implemented

[English](2026-08-30-shared-apple-remote-core.md) | 中文

## Problem

原生化方案（E:\11585 方案，第 73 章）的 Phase 2 以 Shared Apple Remote Core 开篇：在任何 iOS/iPadOS/macOS 伴侣 UI 存在之前，Apple 侧需要 link 客户端状态机——配对、SPKI 钉扎、签名单次 RPC、NDJSON 流——构建于契约生成器已发射的 wire 模型之上，并按第 19 章跨语言回放黄金 fixtures。仓库此前没有 Swift 代码、没有 SwiftPM 包，也没有机制让生成产物的 Swift 侧拷贝保持新鲜。

## Decision

`apps/apple` 是一个 SwiftPM 包（iOS 16+、macOS 13+），唯一库 target `SharedAppleRemoteCore` 不引入任何 UI 地镜像 `dsh-link-client` 的状态机：`LinkClient`（配对 / 描述 / 调用 / 流，`LinkWire` 处理网关 `client-request`/`server-response` 信封）、`LinkSigning`（规范签名输入 `timestamp\nmethod\npath\nsha256hex(body)`、CryptoKit 的 Ed25519、Ed25519 与 P-256 密钥的固定 SPKI 头）、`LinkPinningDelegate`（在 TLS 挑战处理器里计算叶证书的 SPKI 指纹，任何不匹配都在写出请求字节之前取消握手），以及藏在 `LinkCredentialsStoring` 协议后的凭据（Keychain 与内存两种实现）。生成产物是同步而非分叉：`gen-link-contracts` 现在还把 `LinkContracts.swift` 写进包源码、每个黄金 fixture 一份 JSON 写入 `generated/fixtures/`，并把 fixtures 拷贝进测试 bundle 资源；`verify-link-contracts`（hygiene 聚合的漂移门禁）逐字节比对每一份拷贝。XCTest fixtures 把每个 JSON 解码进生成的模型并往返配对载荷；签名测试覆盖规范输入、SPKI 组帧与签名/验签往返。

## Consequences

wire 类型变更现在在伴侣端发布前会连续三道门禁失败：typecheck（zod schema 不再满足协议类型）、manifest/Swift/Kotlin 漂移门禁，以及——待 macOS runner 落地后——同步 fixtures 上的 `swift test`。Swift 源码已编写但尚未纳入本仓库 CI 编译：这台 Windows 主机无法运行 Xcode，仓库 runner 均为 Linux，编译验证等待 macOS 车道；期间由 fixture 与漂移门禁承载契约保证，且该包刻意避免花哨的 Swift 特性，使首次 `swift build` 低风险。伴侣应用本体（会话 UI、审批、Plan/Todo/Goal、文件/Diff/工件查看器、简约拟态 + 液态玻璃双主题）是基于此核心的后续增量。

## Alternatives considered

手工把模型卖进 Swift 包被立即否决——那会分叉契约。从包源码 symlink 到 `generated/` 可以避免拷贝，但 SwiftPM target 不能包含包目录之外的文件，且 Windows 检出无法物化链接。先用 Swift 重写参考客户端的测试也被延后：fixture 回放加签名词汇测试钉住了 wire 契约，而完整的状态机测试（Swift 里的本地 TLS 服务器）属于能真正运行它们的编译车道。
