# Agent Note: Kotlin 线缆客户端半边

Status: implemented

[English](2026-08-30-android-wire-client.md) | 中文

## 问题

Android core 能折叠 fixtures 但不会说 link 这门语言：没有信封、没有签名、没有钉扎、没有 HTTP。Swift 的 `SharedAppleRemoteCore` 定义了任何 Compose 界面与宿主配对之前，Kotlin 伴侣必须镜像的线缆半边。

## 决策

`apps/android/core` 以 JDK crypto、OkHttp 与 kotlinx JSON 实现这份镜像。`LinkWire` 携带直通 `WireValue`，以及 canonical unary `payload.args`、回显 rpcId/result 解析和 NDJSON stream frame；stream request 使用自身顶层 `args`。`LinkSigning` 镜像四行签名输入、小写 SHA-256 十六进制与 `java.security` 的 Ed25519。`LinkPinning` 取叶子 SPKI DER 的指纹，并提供在任何 call 运行前已安装到 Link transport 的 trust manager 与 hostname verifier；私有 Host 由 QR 认证的 SPKI 标识，而非 public-CA DNS identity。`LinkClient` 只在 payload endpoint 与 pin 拥有该 client 时接受配对，把成功但省略 value 的结果映射为 void，并带出结构化失败。测试对着本地 HTTP 与动态生成的 HTTPS server 运行，包括 wrong-pin 情形下 handler 不得收到请求字节的断言。

Compose runtime 向全部模型暴露一个稳定的 `SwitchableWireDriving` handle，并只在 restore 或 fresh pairing 后替换其 delegate。Session follow 在 carrier loss 后重试，并由下一份 authoritative snapshot 替换 fold。交互模型清除上一代 identity，等待 Host `ready.clientId`，从 `request` 读取 waterfall 字段，移除 cancel frame，发送 `outcome`，并以有界延迟重试 stream。[Android Link 传输与流所有权](2026-09-02-android-link-transport-and-stream-ownership.zh.md)决策在执行前登记每个网络 call，退役被替换的 client，串行化模型 stream generation，并让可等待 teardown join 每条 active 或 pending stream job。

## 后果

Android 车道在 JDK 17 与 Gradle 8.14 上拥有 Kotlin/JUnit 与 app assembly 证据。它还会让独立 Kotlin driver 对 shipped base 加 desktop Host composition 执行共享的配对至撤销 corpus，缺少任一步都会失败。这台 Windows 宿主有 JDK 17，但没有 Gradle 或 Android SDK，本地 native run 因此保持 `NOT_EXECUTED/HOST_ENVIRONMENT`。生成式 fixtures、TypeScript 契约检查与源码审查不能替代该车道；只有 native suites 与上传的真实 Host-to-Kotlin 结果都通过，G1-ANDROID 才能关闭。

## 考虑过的替代方案

BouncyCastle 被否决，因为 JDK provider 原生支持 Ed25519 签名与验签。Link transport 不采用 `HttpURLConnection`，因为它无法在 DNS、connect、request write、response header 与 response-body read 全阶段暴露同一个可靠取消 owner；[传输所有权决策](2026-09-02-android-link-transport-and-stream-ownership.zh.md)记录替代实现及范围更窄的备选方案。
