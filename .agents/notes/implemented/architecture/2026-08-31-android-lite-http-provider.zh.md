# Agent Note: Android Lite 真实 HTTP 提供方

Status: implemented

[English](2026-08-31-android-lite-http-provider.md) | 中文

## 问题

Android Lite 运行时只能经替身提供方驱动回合：没有东西会说 OpenAI 兼容的流式协议，端上模型调用——内嵌运行时的意义所在——没有真实的缝。

## 决策

`LiteHTTPProvider.kt` 在 JDK `HttpClient` 上镜像 Apple 的提供方栈。`LiteStreamLineParser` 是纯行解码：SSE `data:` 载荷、裸 NDJSON、空行与注释行、`[DONE]` 终止符都归约为 `Text`、`Reasoning` 或原始 `ToolCallEntries` 块——先读 `reasoning_content` 再 `content` 再 `tool_calls`，恰是 DeepSeek 服务的增量形状。`LiteToolCallAssembler` 按线缆 `index` 开槽，首个增量无 id 时合成 `tool-<index>`，追加参数碎片、只把名字填进空槽，流结束时按 index 序冲刷——从未收到名字的槽被丢弃而非半成品分发。提供方带 bearer 头投递 `{model, stream, messages}`，非 2xx 拒绝为 `Provider("HTTP_<status>")`，逐行把响应体流成块加组装后的调用，并按 URLError 语义映射传输失败：`HttpTimeoutException`/`SocketTimeoutException` → `timeout`、`UnknownHostException`/`ConnectException` → `unreachable`、其余 → `dropped`——连接时与流中皆然。

## 后果

`LiteStreamParsingTest` 钉住纯面：SSE 与裸 NDJSON 增量、各类非载荷行、跨 index 的碎片组装（参数精确拼接、按序冲刷）、冲刷后槽退役、合成 id、无名槽丢弃；传输分类器以构造异常逐类钉住。`LiteHTTPProviderTest` 对真实本地 `HttpServer` 闭环：脚本化 SSE 响应（reasoning + 文本 + 拆在两个增量里的工具调用 + `[DONE]` + keep-alive 注释）流出精确四个块，处理方同时观察到请求的路径、bearer 头、模型与 prompt；429 拒绝抛 `HTTP_429`；连向无人监听的端口抛 `Network("unreachable")`。Android 车道验证全绿。聊天面的实时流式 StateFlow 投影仍有意延后——等这个提供方真正喂给 UI 时才有意义。

## 考虑过的替代方案

用 OkHttp 做传输被否决——core 模块保持 JDK 栈纯 JVM（与 `LinkWire` 同一选择），OkHttp 决策已归应用层（随钉扎而来）。经生成契约模型解析被否决——提供方消费的是契约表不拥有的第三方线缆形状；本地 JsonElement 解码让这条边界显式。
