# Agent Note: 原生文件上传使用实际接收监听器的完整 HTTP 请求体预算

Status: proposed

[English](2026-09-28-native-http-upload-budget.md) | 中文

## Problem

Android 在本地限制源文件字节和编码后的上传参数，但 Native HTTPS 监听器限制的是完整缓冲 HTTP 请求体。RPC 元数据和签名准入还会占用参数之外的字节。文件可能满足 Android 的本地限制，实际请求却超过监听器上限。调大本地限制或估算 envelope 额外开销无法消除这项差异。

捕获原始 Gateway service receiver 的设备 adapter 可能让隔离的 Native 监听器使用自己的 HTTP 限制，却经另一 Cordis context 分派调用。未保留调用 context 就发布预算，可能返回另一个监听器的值；即使唯一的 Native 监听器位于隔离 context 中，这个问题仍然存在。

## Proposal

以普通 service 方法 `createDeviceConnection(): TypertGatewayDeviceConnection` 替换共享设备 adapter。每个 Native 监听器通过自己的 context 调用 factory；返回的 RPC 和 stream 闭包保留该次调用的 receiver。factory 不是 Remote 方法。签名准入、配对的唯一 unsigned 例外、权限、撤权与 stream 清理继续由既有 Gateway 分派负责。factory 不复制 Gateway 状态，也不把已解码的可信本地调用暴露为原生 transport。

通过独立 capability `native-remote.http-request-budget.v1` 和 `view` 权限公开 `nativeRemote/httpRequestBudget`。其 `NativeHttpRequestBudget.maxRequestBodyBytes` 来自实际接收 Native 监听器使用的同一份已校验配置。它描述包含上限值的完整 UTF-8 JSON 请求体预算，包含 RPC 元数据和设备签名准入，不包含 HTTP headers、TLS 与 chunk framing。监听器不可用时失败，不返回猜测值。管理类监听器信息仍要求 `device.admin`。

每次显式 `fileUploads/upload` 时，Android 先准入已知的文件上传和预算 capability，再从同一个已验证 Native client 读取预算，并校验它是正 safe integer。随后只创建一次 RPC 身份、一次新鲜 admission 和一个最终 UTF-8 字节数组。client 在创建 HTTP 调用前拒绝超预算请求体；通过时发送已经检查的同一份字节。此路径不引入预算缓存、二次序列化、自动重试或默认 Host 上限。

预算观察不预留容量，也不授予上传权限。Host 继续执行实际字节限制和当前设备授权。更小的代理上限或变化后的 Host 配置仍可拒绝已通过本地检查的请求。非法或失败的预算发现保留其既有失败分类；只有实际观察到的本地请求体超限映射为附件模型的 `REQUEST_TOO_LARGE`。

本地 512 KiB 源文件、1 MiB 编码参数和八项附件限制仍是独立约束。transport 检查覆盖所有 `fileUploads/upload` 调用者，包括文件分享。图片上传保留独立路径。查询或上传失败不能替换 pending 意图，也不能部分采纳分享批次；恢复操作是用户显式重新选择来源。

## Alternatives considered

**公布一个全局 Host 预算或统计监听器数量。** 全局值不能标识实际接收当前请求的监听器。仅有隔离监听器时，数量也不能证明分派正确。

**在替代 adapter 中调用可信本地 `invoke()` 或 `stream()`。** 这些方法不执行原生签名准入。复用它们会改变授权路径，而非修正调用 context。

**估算 base64 额外开销、比较字符串长度，或以 Host 预算替换源文件限制。** JSON 转义、非 ASCII 文本、元数据和 admission 都影响实际请求体。请求体上限不是源文件大小或内存分配目标。

**缓存一次成功预算或自动重试已拒绝的 mutation。** 缓存观察可能比监听器或 principal 存活更久，传输失败也可能留下无法确认的上传结果。每次重新读取和显式上传使这些生命周期保持独立。

## Acceptance criteria

Gateway 测试必须区分保留的 root 与 isolated adapter 的 RPC 和 stream 行为，包括签名准入、权限拒绝、撤权和取消。使用不同限制的真实 TLS 监听器必须返回实际接收者的 metadata 与预算；仅有隔离监听器的组合以及同级实例释放也必须保持同一归属规则。

Host 测试必须准入完整签名编码文件请求体的 B−1 与 B 字节样本，并在上传或存储准入前拒绝 B+1。Android 测试必须测量完整请求体，执行绕过 UI 准入的直接调用，拒绝非法预算、缺失或未知 capability，以及 Host 替换后的迟到结果。文件分享失败必须保持本地原子采纳。

已安装 SAF 证据必须展示真实本地预算拒绝且没有文件 POST 或 prompt，随后显式选择更小文件、核对 Host 字节并产生一条已接受消息。预算读取单独计数。既有 Files、receipt 恢复和分享行为需要定向回归证据。测试结果在各 owner 执行并检查前保持待验证。

## Risks

本提案依赖 context-bound factory 的实证；单监听器预算示例通过不能替代它。保留的 [Native transport 决定](../../implemented/architecture/2026-09-25-native-remote-connection-source.zh.md)、[设备准入决定](../../implemented/feature/2026-09-21-per-request-device-admission.zh.md)、[Files 决定](../../implemented/architecture/2026-09-27-android-file-attachments.zh.md)和[Share 决定](../../implemented/architecture/2026-09-28-android-share-intake.zh.md)继续分别负责安全、来源和输入生命周期。本项不证明流式、断点续传或图片请求体预算、物理设备行为、Swift 接入或完整 Mobile Release 验收。
