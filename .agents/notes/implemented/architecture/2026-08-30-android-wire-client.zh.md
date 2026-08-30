# Agent Note: Kotlin 线缆客户端半边

Status: implemented

[English](2026-08-30-android-wire-client.md) | 中文

## 问题

Android core 能折叠 fixtures 但不会说 link 这门语言：没有信封、没有签名、没有钉扎、没有 HTTP。Swift 的 `SharedAppleRemoteCore` 定义了任何 Compose 界面与宿主配对之前，Kotlin 伴侣必须镜像的线缆半边。

## 决策

`apps/android/core` 仅凭 JDK 栈获得这份镜像——零外部加密或 HTTP 依赖。`LinkWire` 携带直通 `WireValue`（经 JsonElement 树往返，整型数为裸整数）与三种信封形式：`client-request` 单数信封、`{ok, value|error}` 结果、NDJSON 流帧。`LinkSigning` 镜像规范的四行签名输入、小写 SHA-256 十六进制，以及 `java.security` 的 Ed25519——裸私钥包上 PKCS#8 前缀，SPKI 装帧与 JDK 自身的 `publicKey.encoded` 逐字节一致，并附测试用的 verify。`LinkPinning` 取叶子证书 SPKI DER 的指纹（JDK 直接给出 DER，无需按曲线装帧）；接入 TLS 握手随应用模块的 OkHttp 栈到来，本对象是两者共用的校验。`LinkClient` 配对（全新 JDK Ed25519 密钥对、SPKI 入体）、describe、以三条凭据头调用 `/api` 单数端点（每次新签 epoch 毫秒时间戳）、以及流式 NDJSON——失败帧以 `Refused` 收束。测试对着真实的本地 `com.sun.net.httpserver.HttpServer` 运行——配对持久化身份、签名调用携带可校验的头、业务拒绝带出错误码、流在失败帧前持续产出值——另以一份提交在库的 Ed25519 证书 fixture 校验钉扎指纹。

## 后果

车道上全部 18 个 core 测试全绿，覆盖一致性折叠、词汇、tokens、线缆信封、签名向量、钉扎与完整的客户端往返。Compose 应用模块现在可以在能工作的客户端之上构建配对与六标签面。车道还抓到两个 Kotlin 事实：`kotlinx.serialization.json.serializer` 作为 import 不可解析（reified `encodeToString` 自会找到序列化器）；钉扎失配报告命名 `presented` 与 `pinned`——测试起初把两者断言反了。

## 考虑过的替代方案

BouncyCastle 被否决——JDK 提供方原生支持 Ed25519 签名与验签。现在就上 OkHttp 被否决——纯 JVM 模块保持无框架；应用模块拥有 TLS 栈，钉扎正该接在那里。
