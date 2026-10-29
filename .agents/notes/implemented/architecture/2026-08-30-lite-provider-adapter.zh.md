# Agent Note: Lite 真实提供方适配器骨架

Status: implemented

[English](2026-08-30-lite-provider-adapter.md) | 中文

## 问题

Lite 循环此前只驱动脚本化提供方；Phase 3 需要真实缝——一个流式 chat-completion 客户端，把提供方字节解码为 Lite 分块，并按行为规范自身的词汇（`network/error` 种类、`provider/error` 代码）报告失败，使折叠记录的正是规范命名的东西。

## 决策

`LiteHTTPProvider`（`LiteProviding` 上的 actor）按 prompt 各发一个 OpenAI 兼容流式补全，经 `LiteStreamLineParser` 把 `URLSession.bytes` 的行转为分块——纯函数，同时接受 SSE（`data: {…}`、`[DONE]`、注释）与裸 NDJSON，解码 chat delta 形状（`reasoning_content`→思考、`content`→文本、完整 `tool_calls` 条目→工具调用）。`LiteTransportError` 分类失败：`URLError` 代码映射到规范的网络种类（超时→timeout、不可达族→unreachable、中断/不允许→dropped），非 2xx 响应成为 `provider` 代码（`HTTP_<status>`）。循环驱动器的 catch 现在把分类后的错误折叠为对应事件——`.network`→`network/error`、`.provider`→`provider/error`——而非把一切压平成泛化提供方错误。

## 后果

真实端点可以原样接入循环；折叠的终局结果如今区分传输丢失（保留部分内容供恢复）与提供方拒绝（清除流式），与规范场景的描述完全一致，驱动器测试用抛错提供方钉住该映射。解析在无网络下对 SSE 与 NDJSON 形式做单测；HTTP 路径本身需要 macOS 车道编译运行（既有告解）。刻意延后：跨分块的工具调用参数碎片累积（本骨架服务整调用增量——已在适配器注明）、assistant/system 历史组装、重试退避策略——都随真正消费它们的产品面落地。

## 考虑过的替代方案
把一切失败映射为 `provider/error` 被否决——规范把两族失败分开正因为恢复方式不同（恢复连接与重试），驱动器正是这一区分落地之处。引入完整流式 SDK 被否决——一个请求形状、一个行解析器、一个纯函数让这条缝可评审且无钥可测。现在就解析工具调用碎片被否决——mock 与规范场景携带整调用；碎片组装是提供方行为问题，随真实流录制添加。
