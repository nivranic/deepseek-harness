---
description: "Apple 远程伴侣端：共享 link 客户端核心（配对、SPKI 钉扎、签名 RPC、NDJSON 流）与 CompanionUI SwiftUI 层（会话 UI、审批、Plan/Todo/Goal、双主题），构建于 dsh-link-contracts 生成的 wire 模型之上。"
kind: "package-reference"
---

# apps/apple — Apple 远程伴侣端

[English](README.md) | 中文

## 概述

`apps/apple` 承载跨端方案的 Apple 半边：一个 Swift 包 `SharedAppleRemoteCore` 拥有 link 客户端状态机——以 Ed25519 对二维码载荷完成配对、TLS 握手中的 SPKI 指纹钉扎、经共享 `/api` 链的签名单次 RPC、NDJSON Remote 流——而生成的 `LinkContracts.swift` 模型与黄金 fixture JSON 由 `pnpm run gen-link-contracts` 同步到此处，并被 `verify-link-contracts` 漂移门禁看护。第二个 target `CompanionUI` 承载 SwiftUI 应用层：基于 follow 流的会话列表与时间线、使用宿主结果词汇的审批/提问收件箱、Plan/Todo/Goal 面板，以及以单一语义令牌集呈现的双视觉风格（简约拟态与液态玻璃，含无障碍感知的降级规则）。其 view model 只依赖一个线缆驱动协议，整层可脱离宿主测试。iOS/iPadOS/macOS 应用壳构建于这两个库之上；它们尚未存在，而核心仍不引入任何 UI 框架。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Swift 包用 Xcode 构建（SwiftPM；iOS 16+、macOS 13+）。生成文件永不手改：

```sh
pnpm run gen-link-contracts     # regenerates Sources/SharedAppleRemoteCore/LinkContracts.swift and Tests/.../Fixtures/
pnpm run verify-link-contracts  # fails when the synced copies drift from the contract table
```

### 可观察行为

`LinkClient` 镜像 TypeScript 参考客户端：`pair(payload:deviceName:)` 用一次性配对码换取持久化的 `LinkCredentials`（真实部署存 Keychain，预览与测试用内存实现）；`describe()` 返回宿主描述；`call(_:args:)` 把网关信封解包为值或 `refused` 失败；`stream(_:payload:)` 逐帧产出 NDJSON 值，错误帧以类型化失败结束。每个请求以设备密钥对 `timestamp\nmethod\npath\nsha256hex(body)` 签名；每次 TLS 握手在写出任何请求字节之前钉扎证书指纹。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

- **在挑战处理器里钉扎。** `LinkPinningDelegate` 计算叶证书 SPKI DER 的哈希（P-256 固定头 + 65 字节点，或 Ed25519 头 + 32 字节原始密钥），不匹配即取消握手。
- **信封保真。** `LinkWire` 精确编码网关共享 `/api` 链期望的 `client-request` 形状，并解码 `server-response` 结果，包括直通的 JSON 值。
- **凭据藏在协议后。** `LinkCredentialsStoring` 把 Keychain 存储与内存实现分开，核心因此可脱离设备编译与测试。

### 源码地图

| 文件 | 角色 |
|---|---|
| `Package.swift` | SwiftPM 清单；共享核心与 fixture 测试 |
| [`Sources/SharedAppleRemoteCore/LinkClient.swift`](Sources/SharedAppleRemoteCore/LinkClient.swift) | 配对 / 描述 / 调用 / 流状态机 |
| [`Sources/SharedAppleRemoteCore/LinkSigning.swift`](Sources/SharedAppleRemoteCore/LinkSigning.swift) | 规范签名输入、SPKI 组帧、十六进制摘要 |
| [`Sources/SharedAppleRemoteCore/LinkPinning.swift`](Sources/SharedAppleRemoteCore/LinkPinning.swift) | 对配对指纹的 TLS 挑战钉扎 |
| [`Sources/SharedAppleRemoteCore/LinkWire.swift`](Sources/SharedAppleRemoteCore/LinkWire.swift) | 网关请求/响应信封与流帧 |
| [`Sources/SharedAppleRemoteCore/LinkCredentials.swift`](Sources/SharedAppleRemoteCore/LinkCredentials.swift) | 设备身份与存储协议 |
| [`Sources/SharedAppleRemoteCore/LinkKeychain.swift`](Sources/SharedAppleRemoteCore/LinkKeychain.swift) | Keychain 身份存储 |
| `Sources/SharedAppleRemoteCore/LinkContracts.swift` | 生成的 wire 模型——永不手改 |
| `Tests/SharedAppleRemoteCoreTests/` | fixture 回放与签名词汇测试 |
| [`Sources/CompanionUI/`](Sources/CompanionUI) | SwiftUI 应用层：主题、会话 UI、交互收件箱、Plan/Todo/Goal 面板、工具轨迹、文件浏览、子代理 |
| `Sources/CompanionUI/SessionFold.swift` | 纯领域状态折叠——一致性场景的 Swift 一半 |
| `Sources/LiteRuntime/` | Native Harness Lite 骨架：行为规范折叠 + 静态工具注册表 |
| `Tests/LiteRuntimeTests/` | Lite 行为规范一致性回放与注册表测试 |
| `Tests/CompanionUITests/` | 基于假线缆的 view model、主题降级与领域状态一致性测试 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [远程 link 访问子系统](../../docs/subsystems/remote-link.zh.md)——这些模型镜像的线缆词汇表。
- [dsh-link-client](../../packages/remote/link-client/README.zh.md)——本核心镜像的 TypeScript 参考客户端。
- [dsh-link-contracts](../../packages/remote/link-contracts/README.zh.md)——契约表与生成器。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **已纳入 CI 编译与测试**——[Apple Swift](../.github/workflows/apple-swift.yml) 车道在 `macos-latest` 上编译包并运行全部测试（PR、dev 与 master 的每次 `apps/apple` 变更）；fixture 回放在漂移门禁的两侧运行。
- **应用壳已入 CI 构建**——`project.yml`（XcodeGen）定义第 49 章 target：iPhone/iPad 与 Mac 伴侣各一个 DSH Companion，均为嵌入 `CompanionRootView` 的 `@main` SwiftUI 壳；车道生成 `Companion.xcodeproj`（不提交）并构建两个 scheme。macOS 直连宿主 target 以宿主侧骨架交付（`Hosts/`，车道构建）；更丰富的文件/Diff/工件查看器随后到来。
- **单一宿主身份**——凭据存储只持有一份配对；多宿主切换随伴侣端的宿主列表到来。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
