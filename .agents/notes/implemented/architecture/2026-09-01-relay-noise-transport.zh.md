# Agent Note: 中继 Noise 传输

Status: implemented

[English](2026-09-01-relay-noise-transport.md) | 中文

## 问题

每个中继端点都跑在明文 HTTP 上：信封、roster 查询与 presence 行跨网络可被路径上任何人读取与伪造。方案的 relay 章节把「Noise 或 TLS 加密」列为缺口；PoC 地板有意延后了它。

## 决策

传输是 Noise_XX_25519_ChaChaPoly_SHA256，以 HTTP 作信使——涉及的每个运行时（node:crypto、JDK 17、CryptoKit）都原生携带 X25519、ChaCha20-Poly1305 与 SHA-256，而 TLS 会把证书生成拖进刻意零依赖的服务。`POST /relay/noise/hello` 携带握手消息 1，回答消息 2 加 `x-relay-session` 头——消息 2 之后的转录哈希，客户端对照自己的转录校验它，因此 id 是推导的而非断言的；`POST /relay/noise/complete` 携带消息 3，回答一个加密 `{"ok":true}` 帧证明密钥确认。此后每个会合体都是 u16 长度前缀的 ChaChaPoly 帧，骑拆分密钥、空关联数据与 Noise 的 64 位小端计数 nonce；poll 与 stream 回答帧序列，其余各一帧。流请求在已加密的体内携带客户端生成的 32 字节一次性密钥，流用自己的密码状态加密——这是 selftest 首先抓到的失败的设計修正：HTTP 应答与活动流推送共享会话计数器会让交错不确定、tag 错配。会话闲置 15 分钟过期（410，重新握手）；握手端点保持明文，因为 Noise 本就在消息 2 与 3 里隐藏静态密钥。

四个运行时都直接实现框架——SymmetricState（链密钥、转录哈希）、CipherState（密钥、计数器）与双角色的 XX 消息序列——任何一处都没有 Noise 库。没有 CI 车道运行 node 服务，互操作由固定密钥向量钉住：`apps/relay/gen-relay-vectors.mjs` 以钉住的标量驱动一次握手与双向流量，Kotlin（`link/Noise.kt`）与 Swift（`Noise.swift`）端口必须逐字节复现握手消息、会话 id、通道绑定、拆分密钥与每一帧。node 参考 selftest 覆盖真实本地 socket 上的完整流程；原生车道回放向量并对照本地 Noise 应答方（JDK HttpServer；一个解析请求并路由的 NWListener 服务器）跑完整客户端流程。两个 JDK 事实支撑了移植：XDH KeyFactory 以小端字节序读 u 坐标的 BigInteger（raw 字节反转进 spec），且钉住标量的公钥没有直接推导入口——与可导入的 u=9 基点做一次 KeyAgreement 即得，因为 scalarmult_base(s) = DH(s, 9)。

## 后果

中继路径对网络观察者现已保密且完整性受保护；中继本身仍终结会话（它按账号路由，因此读得到它解密的内容——链路安全，不是端到端保密；宿主↔设备的端到端层会叠在其上）。明文 GET 端点已移除；参考壳的每个消费者要么说 Noise，要么收 410。`rt-` 会合令牌仍是唯一授权——XX 认证传输身份，但中继有意不按它们授权。node 客户端的流对象需要显式 `close()` 收尾：挂起在等待下一帧的 async generator 无法感知 `return()`，undici 的 5 分钟 body 超时原本是唯一能打断等待的东西。relay 车道剩余：APNs/FCM 投递（需外部推送凭据）与其上的后台唤醒。

## 考虑过的替代方案

前置 TLS 由反向代理终结被否决——壳的零依赖属性就是部署故事，node 没有新依赖造不出 X.509 证书。把整个 HTTP 会话跑进一条 Noise TCP 隧道（TLS 式）被否决——JDK HttpClient 与 URLSession 无法接受自定义传输，客户端将被迫重造 HTTP。用预共享中继静态密钥的 Noise_NK 被否决——XX 无需任何带外分发，且对被动观察者隐藏双方身份。每条流再来一次完整 Noise 握手（替代请求内一次性密钥）被否决——它把握手往返翻倍只解决一个随机密钥已解决的问题，因为流只是服务端→客户端单向。
