---
description: "Apple 远程伴侣端：共享 link 客户端核心（配对、SPKI 钉扎、签名 RPC、NDJSON 流）与 CompanionUI SwiftUI 层（会话 UI、审批、Plan/Todo/Goal、双主题），构建于 dsh-link-contracts 生成的 wire 模型之上。"
kind: "package-reference"
---

# apps/apple — Apple 远程伴侣端

[English](README.md) | 中文

## 概述

`apps/apple` 承载跨端方案的 Apple 半边：一个 Swift 包 `SharedAppleRemoteCore` 拥有 link 客户端状态机——以 Ed25519 对二维码载荷完成配对、TLS 握手中的 SPKI 指纹钉扎、经共享 `/api` 链的签名单次 RPC、NDJSON Remote 流——而生成的 `LinkContracts.swift` 模型与黄金 fixture JSON 由 `pnpm run gen-link-contracts` 同步到此处，并被 `verify-link-contracts` 漂移门禁看护。`LinkClient` 直接消费生成式 unary、stream 与递归 JSON 模型；不存在第二套 Swift envelope 词汇。第二个 target `CompanionUI` 承载 SwiftUI 应用层：基于 follow 流的会话列表与时间线、使用 Host Remote Event outcome 词汇的审批/提问收件箱、Plan/Todo/Goal 面板、只读工件面板（第 56 章），以及以单一语义令牌集呈现的双视觉风格（简约拟态与液态玻璃，含无障碍感知的降级规则）。其 view model 只依赖一个线缆驱动协议，整层可脱离宿主测试。iOS/iPadOS/macOS 应用壳是这两个库之上的轻薄宿主，并在 Apple 车道构建；核心仍不引入任何 UI 框架。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Swift 包用 Xcode 构建（SwiftPM；iOS 17+、macOS 14+）。生成文件永不手改：

```sh
pnpm run gen-link-contracts     # regenerates Sources/SharedAppleRemoteCore/LinkContracts.swift and Tests/.../Fixtures/
pnpm run verify-link-contracts  # fails when the synced copies drift from the contract table
```

### 可观察行为

参考实现 `RelayClient` 跨 actor 挂起点串行执行完整 HTTP 交换，在传输、分帧或认证失败后丢弃缓存密钥，不重放请求。取消等待中的调用只移除该次等待，不会取消正在执行的交换或使其会话失效。[中继传输语义](../relay/README.zh.md#transport-encryption)统一说明无符号 nonce 上限、恢复规则与独立流密钥。Apple workflow 负责执行此 Swift 实现的运行验证。

所有应用 scheme 消费生成的产品 xcconfig，并展开显式 [AppInfo.plist](Config/AppInfo.plist) 模板，保留完整 SemVer、构建号和分发渠道。[应用发布标识](../../docs/development/product-release-identity.zh.md) 拥有公共输入与平台验证说明。

[Apple archives workflow](../../.github/workflows/apple-archives.yml) 拥有 iOS 设备 Companion 与通用 Mac Companion 的 Release 归档验证。它选择一个干净提交，禁用 Xcode 签名，拒绝 provisioning profile，并通过 ZIP 往返检查内嵌标识、可执行文件平台、架构切片、文件字节、符号链接及 Unix 权限。归档报告保留启动未执行状态，并排除 DirectHostMac；它不是完整 RC 或 iOS 模拟器验收报告。实际归档生产需要该 workflow 的 macOS/Xcode runner，以及用于解析 plist 的 Python 3。[归档决策](../../.agents/notes/implemented/process/2026-09-07-apple-companion-archives.zh.md) 说明这些证据为何分开。

DirectHostMac 拥有 `DirectHostRuntime` 管理器与临时本地 WebView。它通过 `HostRuntimeSupervisor` 启动打包的 `dsh` 可执行程序，等待已认证的 HTTP 健康检查，并把会话与管理行为交给现有 Web UI。重新启动会等待前一 helper 退出，并保留应用 home。默认 home 为 `~/Library/Application Support/DeepSeek Harness/Host`；显式 `DSH_HOME` 必须是不含控制字符、且不是根目录的 POSIX 绝对路径。非法配置在启动前失败，不会使用默认 home。原生状态消息不包含运行时 stdout、stderr 或认证 URL。应用要求其架构的运行时可执行程序与 helper 位于 `Contents/Resources/Runtime`；缺少这些文件的源码壳会报告不可用。[直连宿主决策](../../.agents/notes/implemented/architecture/2026-08-31-macos-direct-host.zh.md) 拥有生命周期限制和验证要求。

[Mac Host candidate workflow](../../.github/workflows/mac-host-candidate.yml) 在临时 macOS runner 上拥有原生 bundle 组装与应用验收。生产器从所选干净提交构建 runtime、rg、spawn-helper 和生命周期 helper，检查可执行文件架构、平台、最低系统版本与产品版本，并使用 ad-hoc 签名封装应用。它以临时 home 运行 bundle 内的 Web profile 和生产 WebView，然后用 SHA256 摘要绑定源码、工具链、文件清单与 ZIP。构建或验收失败会阻止已验证候选 artifact 的生成。Developer ID 签名、公证、完整进程所有权与完整 RC 供应链回执仍是独立要求。

原生崩溃采集也会生成[产品诊断记录](../../docs/development/product-diagnostics.zh.md)，关联 checkout 中的版本、构建号和源码 SHA。它保留错误类别与采集完整性，不复制报告消息或栈帧。

Mac Host 的**导出运行时诊断…**操作会准备本地 JSON 快照，包含打包后的产品标识、管理器状态和有界生命周期计数。它排除运行时输出、会话内容、路径、连接地址和凭据。随应用打包的 Gitleaks 扫描器必须通过检测/脱敏 canary 并报告零发现，才会打开原生保存对话框。取消、超时和应用正常退出都会等待扫描 helper；应用突然退出后，父管道也会请求清理。连接、协议、角色、capability、更新、原生崩溃记录和会话诊断仍明确标为未采集。[导出决策](../../.agents/notes/implemented/architecture/2026-09-08-local-runtime-support-export.zh.md)拥有隐私与生命周期要求；Mac 候选车道验证 ready、stopped 和启动失败状态的真实保存字节。没有打包扫描器的源码壳会拒绝导出。

`LinkClient` 镜像 TypeScript 参考客户端：`pair(payload:deviceName:)` 只接受 fresh client 自身拥有的 endpoint 与 pin，以一次性配对码换取持久化的 `LinkCredentials`（真实部署存 Keychain，预览与测试用内存实现）；`describe()` 返回 Host 描述；`call(_:args:)` 校验回显的 `rpcId`，把成功但省略 value 的响应映射为 `.null`，并带出结构化 refusal；`stream(_:payload:)` 逐帧产出 NDJSON 值，错误帧以类型化失败结束。unary 与 stream 的传输处理仅把 JSON 字符串字段 `error` 等于 `forbidden` 的 HTTP 403 映射为 `.refused(code: "forbidden", message: ...)`；消息依次取非空字符串 `message`、`reason`，最后回退到 `HTTP 403`，其他所有非 2xx 响应仍为 `.carrier`。失败的 stream 会读取该响应体以完成分类，成功的 stream 则在未预消费字节的前提下进入 NDJSON 解析。每个请求以设备密钥对 `timestamp\nmethod\npath\nsha256hex(body)` 签名；每次 TLS 握手在写出任何请求字节之前钉扎证书指纹。`InteractionViewModel` 只从每代 Host `ready.clientId` 更新回答身份，从 `waterfall.request` 读取交互字段，应用 cancel frame，并在重连后等待新的 ready frame。

[本地 Link 诊断投影](Sources/SharedAppleRemoteCore/LinkDiagnostics.swift)记录有界 HTTP 与流计数、固定失败类别、最后已知配对角色和选定的已认证协议字段。读取投影不会加载凭据或发起请求。已配对应用在进入前台时刷新描述；刷新、失败或取消配对会清空 Host 值，早先查询不能覆盖较新观测。计数描述本地工作，不代表连接健康或当前授权。[共享导出核心](Sources/SupportExportCore/DocumentScanner.swift)负责完整字节准入，并等待后台打开、扫描和取消操作全部结束。

Companion 的**导出诊断信息**操作在配对前后均可使用。[导出器](Sources/CompanionUI/CompanionSupportExporter.swift)将应用标识、扫描器来源和既有 Link 观测序列化为一份文档，上限为 16 KiB，扫描期限为 10 秒。[原生适配器](Shells/SupportScannerAdapter.swift)要求内嵌标识匹配已链接扫描器的版本和规则。系统保存操作只接收准确批准字节；交付前取消会拒绝输出。取消任一 Apple 保存对话框后，应用释放已批准文档，并允许再次导出。文档保持 `complete: false`，列出缺失的应用源码、健康、连接、有效角色、更新、崩溃与会话生产者。扫描器源码 SHA 不充当缺失的应用源码标识。

生成 Xcode 项目前，需要[扫描器准备 Action](../../.github/actions/apple-support-scanner/action.yml)在 `.support-scanner/` 下的输出。两个 Companion 目标链接静态 framework，并以文件夹资源打包其来源和许可证。它们禁用 Xcode 的 Debug dylib 布局，使 Debug 与 Release 的扫描器代码均保留在被检查的可执行文件中。[最终应用检查](../../scripts/verify-apple-app-scanner.py)对照准备记录与 Git 重查这些字节，比较各可执行切片的 Go 模块图，并执行维护中的二进制漏洞检查器。Debug 标识与 Release 归档报告绑定这些结果；包测试和库探针不能证明保存文档或设备验收。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

- **在挑战处理器里钉扎。** `LinkPinningDelegate` 计算叶证书 SPKI DER 的哈希（P-256 固定头 + 65 字节点，或 Ed25519 头 + 32 字节原始密钥），不匹配即取消握手。
- **生成式信封保真。** `LinkContracts.swift` 提供 `LinkClient` 与 `CompanionUI` 使用的 request、response、stream、Remote Event 与递归 JSON 模型；fixture 测试往返 value、void、error、ready、waterfall、cancel、outcome 与 Session 恢复变体。
- **fresh transport ownership。** 配对界面把新配对的 client 返回给 root，root 以这一组确切的 endpoint、pin 与 credential store 构建全部模型，不再使用配对前 placeholder。
- **凭据藏在协议后。** `LinkCredentialsStoring` 把 Keychain 存储与内存实现分开，核心因此可脱离设备编译与测试。

### 源码地图

| 文件 | 角色 |
|---|---|
| `Package.swift` | SwiftPM 清单；共享核心与 fixture 测试 |
| [`Sources/SharedAppleRemoteCore/LinkClient.swift`](Sources/SharedAppleRemoteCore/LinkClient.swift) | 配对 / 描述 / 调用 / 流状态机 |
| `Sources/SharedAppleRemoteCore/RelayRendezvous.swift` | 中继会合地基（第 68/69 章）——设备注册、仅引用信封扇出、按 poll 排空的内存态单账号转发；信封桥接见 CompanionUI 的 pushFromRelayEnvelope；自托管壳见 `apps/relay` |
| `Sources/SharedAppleRemoteCore/Noise.swift` | 基于 CryptoKit 的 Noise_XX_25519_ChaChaPoly_SHA256——中继的传输加密栈（握手状态机、拆分密码状态、u16 封帧），由 node 参考实现的固定密钥向量逐字节钉住 |
| `Sources/SharedAppleRemoteCore/SessionHandoff.swift` | 第 40 章 Handoff L1 的设备侧：以扁平入参从折叠源状态构建快照线值（不耦合 Lite 类型），经 `session/handoff` 发送——宿主创建全量会话、钉住标题并把渲染简报入队 |
| `Sources/SharedAppleRemoteCore/RelayClient.swift` | 中继的 Noise 加密 HTTP 消费者：惰性 XX 握手（转录绑定会话 id + 加密密钥确认）、register/publish/poll/presence 的帧式 AEAD 体，以及骑请求内一次性密钥的推送流；对照真实本地 Noise 应答方测试 |
| [`Sources/SharedAppleRemoteCore/LinkSigning.swift`](Sources/SharedAppleRemoteCore/LinkSigning.swift) | 规范签名输入、SPKI 组帧、十六进制摘要 |
| [`Sources/SharedAppleRemoteCore/LinkPinning.swift`](Sources/SharedAppleRemoteCore/LinkPinning.swift) | 对配对指纹的 TLS 挑战钉扎 |
| [`Sources/SharedAppleRemoteCore/LinkCredentials.swift`](Sources/SharedAppleRemoteCore/LinkCredentials.swift) | 设备身份与存储协议 |
| [`Sources/SharedAppleRemoteCore/LinkKeychain.swift`](Sources/SharedAppleRemoteCore/LinkKeychain.swift) | Keychain 身份存储 |
| `Sources/SharedAppleRemoteCore/LinkContracts.swift` | 生成的 unary、stream、Remote Event、恢复与 JSON 模型——永不手改 |
| `Tests/SharedAppleRemoteCoreTests/` | fixture 回放与签名词汇测试 |
| `Tests/LinkNativeAcceptance/LinkNativeAcceptance.swift` | 执行共享真实 Host 垂直切片 corpus 的独立 Swift driver |
| [`Sources/CompanionUI/`](Sources/CompanionUI) | SwiftUI 应用层：主题、会话 UI、交互收件箱、Plan/Todo/Goal 面板、工具轨迹、文件浏览、子代理 |
| `Sources/CompanionUI/SessionFold.swift` | 纯领域状态折叠——一致性场景的 Swift 一半 |
| `Sources/CompanionUI/FileChange.swift` | 工具轨迹到只读文件变更的投影——第 55 章首版 Diff 呈现 |
| `Sources/CompanionUI/ArtifactsView.swift` | 只读工件面板——工件引用与状态的列表呈现（第 56 章） |
| `Sources/CompanionUI/CompanionPush.swift` | 第 70 章最小推送链路——`$events` 转发折为仅引用数据的推送、本地通知内容与呈现缝，中继（APNs/FCM）延后 |
| `Sources/LiteRuntime/` | Native Harness Lite 骨架：行为规范折叠 + 静态工具注册表 |
| `Sources/LiteRuntime/LiteArtifactReading.swift` | 第 56 章资源通道消费面——工件字节按 id 读取，文本类直呈、其余类型与大小、缺失空态 |
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

- **已纳入 CI 编译与测试**——[Apple Swift](../../.github/workflows/apple-swift.yml) 车道在 `macos-15` 上编译包并运行全部测试（PR、dev 与 master 的每次 `apps/apple` 变更）；fixture 回放在漂移门禁的两侧运行。
- **真实 Host 验收**——同一车道让 `LinkNativeAcceptance` 对 shipped base 加 desktop Host composition 执行唯一的 13 步共享 corpus。结果分别记录 Host 与 Client commit 以及 protocol、contract、Session format 版本；缺少或跳过任一步都会让车道失败。
- **已安装 iOS 应用启动**——[CompanionStartupTests](UITests/CompanionStartupTests.swift) 在全新 iPhone 模拟器上启动生产应用壳，检查未配对表单和空输入下禁用的提交按钮，并向保留的 XCTest 结果附加截图。此检查不验证 App 与 Host 配对或真实设备网络。
- **应用壳已入 CI 构建**——`project.yml`（XcodeGen）定义基于 `CompanionRootView` 的 iPhone/iPad 与 Mac Companion 壳，以及基于 `DirectHostRuntime` 的独立 `DirectHostMac` target。Apple Swift 车道构建三个 scheme；独立的 Mac Host candidate 车道组装并验证 Host bundle。其无密钥 UI 测试确认首次使用声明、选择 Configure later，并操作生产界面的 New session 控件，随后检查停止、启动与重启。[Mac Host 决策](../../.agents/notes/implemented/architecture/2026-08-31-macos-direct-host.zh.md)说明测试观察器权限和签名证据。Full Host 发布验收仍要求外部所有者管理脱离的工具进程组、PTY session 及 helper 意外死亡；Companion 归档不覆盖此要求。
- **单一宿主身份**——凭据存储只持有一份配对；多宿主切换随伴侣端的宿主列表到来。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
