# Agent Note: 中继 Noise 传输

Status: implemented

[English](2026-09-01-relay-noise-transport.md) | 中文

## 问题

每个中继端点都跑在明文 HTTP 上：信封、roster 查询与 presence 行跨网络可被路径上任何人读取与伪造。方案的 relay 章节把「Noise 或 TLS 加密」列为缺口；PoC 地板有意延后了它。

## 决策

传输是 Noise_XX_25519_ChaChaPoly_SHA256，以 HTTP 作信使——涉及的每个运行时（node:crypto、JDK 17、CryptoKit）都原生携带 X25519、ChaCha20-Poly1305 与 SHA-256，而 TLS 会把证书生成拖进刻意零依赖的服务。`POST /relay/noise/hello` 携带握手消息 1，回答消息 2 加 `x-relay-session` 头——消息 2 之后的转录哈希，客户端对照自己的转录校验它，因此 id 是推导的而非断言的；`POST /relay/noise/complete` 携带消息 3，回答一个加密 `{"ok":true}` 帧证明密钥确认。此后每个会合体都是 u16 长度前缀的 ChaChaPoly 帧，骑拆分密钥、空关联数据与 Noise 的 64 位小端计数 nonce；poll 与 stream 回答帧序列，其余各一帧。流请求在已加密的体内携带客户端生成的 32 字节一次性密钥，流用自己的密码状态加密——这是 selftest 首先抓到的失败的设計修正：HTTP 应答与活动流推送共享会话计数器会让交错不确定、tag 错配。会话闲置 15 分钟过期（410，重新握手）；握手端点保持明文，因为 Noise 本就在消息 2 与 3 里隐藏静态密钥。

三个运行时基于各自原生密码学提供方实现 SymmetricState、CipherState 与两个 XX 角色。[Node 生成器](../../../../apps/relay/gen-relay-vectors.mjs)使用四个不同的合成标量，独立编码高位计数器的 nonce 字节。Kotlin 与 Swift 回放其握手、拆分密钥及流量向量。[仓库测试入口](../../../../scripts/relay-noise.spec.ts)运行 Node 密码学测试集和真实 HTTP selftest；原生 workflow 对本地应答方运行客户端。JDK 端口将小端 X25519 u 坐标字节转换为正 `BigInteger`；与 u=9 基点做密钥协商可推导固定标量的公钥。

每个流量密钥拥有精确的无符号 64 位计数器（`BigInt`、`ULong` 或 `UInt64`）。[Noise CipherState 与 ChaChaPoly](https://noiseprotocol.org/noise.html)保留 `2^64−1`；所有端口均在加密或解密前拒绝该值。最后可用 nonce 是 `2^64−2`，认证失败不递增计数器。JavaScript `Number` 无法表示 `2^53` 以上的连续计数；截断或回绕会重复使用同一密钥与 nonce。因此边界向量覆盖 `2^53`、`2^63` 两侧及最后可用 nonce。

客户端串行执行完整 HTTP 交换，包括惰性握手与响应认证。Swift 跨 actor 挂起点保持此顺序；取消会移除排队中的调用。传输、分帧或认证交换失败会退役缓存会话密钥并返回失败。下一次显式调用可建立新密钥；服务器可能已执行失败请求，因此禁止自动重放。独立流收到响应头后释放交换队列，并使用自己的流量密钥。

Node 服务器移除耗尽的会话并返回 410。耗尽的流 writer 移除订阅并关闭；未投递的信封保留在队列中，包括冲排积压队列时未发送的尾部。poll 仅在完整响应加密成功后移除队列。[HTTP 故障测试](../../../../apps/relay/server.test.mjs)在隔离 worker 中注入计数器，部署入口不包含测试控制。这些内存队列与响应写入不承诺投递确认或持久性。

## 后果

中继路径对网络观察者现已保密且完整性受保护；中继本身仍终结会话（它按账号路由，因此读得到它解密的内容——链路安全，不是端到端保密；宿主↔设备的端到端层会叠在其上）。明文 GET 端点已移除；参考壳的每个消费者要么说 Noise，要么收 410。`rt-` 会合令牌仍是唯一授权——XX 认证传输身份，但中继有意不按它们授权。node 客户端的流对象需要显式 `close()` 收尾：挂起在等待下一帧的 async generator 无法感知 `return()`，undici 的 5 分钟 body 超时原本是唯一能打断等待的东西。relay 车道剩余：APNs/FCM 投递（需外部推送凭据）与其上的后台唤醒。

## 考虑过的替代方案

前置 TLS 由反向代理终结被否决——壳的零依赖属性就是部署故事，node 没有新依赖造不出 X.509 证书。把整个 HTTP 会话跑进一条 Noise TCP 隧道（TLS 式）被否决——JDK HttpClient 与 URLSession 无法接受自定义传输，客户端将被迫重造 HTTP。用预共享中继静态密钥的 Noise_NK 被否决——XX 无需任何带外分发，且对被动观察者隐藏双方身份。每条流再来一次完整 Noise 握手（替代请求内一次性密钥）被否决——它把握手往返翻倍只解决一个随机密钥已解决的问题，因为流只是服务端→客户端单向。
