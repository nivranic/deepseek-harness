# Agent Note: 原生文件上传使用实际接收监听器的完整 HTTP 请求体预算

Status: implemented

[English](2026-09-28-native-http-upload-budget.md) | 中文

## Problem

Android 在本地限制源文件字节和编码后的上传参数，但 Native HTTPS 监听器限制的是完整缓冲 HTTP 请求体。RPC 元数据和签名准入还会占用参数之外的字节。文件可能满足 Android 的本地限制，实际请求却超过监听器上限。调大本地限制或估算 envelope 额外开销无法消除这项差异。

捕获原始 Gateway service receiver 的设备 adapter 可能让隔离的 Native 监听器使用自己的 HTTP 限制，却经另一 Cordis context 分派调用。未保留调用 context 就发布预算，可能返回另一个监听器的值；即使唯一的 Native 监听器位于隔离 context 中，这个问题仍然存在。

## Decision

共享设备 adapter 已由普通 service 方法 `createDeviceConnection(): TypertGatewayDeviceConnection` 取代。每个 Native 监听器通过自己的 context 调用 factory；返回的 RPC 和 stream 闭包保留该次调用的 receiver，并经既有 Gateway 分派路由，一次性配对兑换之外仍要求原生设备身份。factory 不是 Remote 方法。签名准入、权限、撤权与 stream 清理继续由既有 Gateway 分派负责。factory 不复制 Gateway 状态，也不把已解码的可信本地调用暴露为原生 transport。

`nativeRemote/httpRequestBudget` 通过独立 capability `native-remote.http-request-budget.v1` 和 `view` 权限公开；管理类监听器信息保持其 `device.admin` capability。返回的 `NativeHttpRequestBudget.maxRequestBodyBytes` 来自实际接收 Native 监听器使用的同一份已校验配置。它描述包含上限值的完整 UTF-8 JSON 请求体预算，包含 RPC 元数据和设备签名准入，不包含 HTTP headers、TLS 与 chunk framing。监听器不可用时失败，不返回猜测值。

每次显式 `fileUploads/upload` 时，Android client 先准入已知的文件上传和预算 capability，再从同一个已验证 Native client 读取预算，并校验它是正 safe integer。随后只创建一次 RPC 身份、一次新鲜 admission 和一个最终 UTF-8 字节数组；client 在创建 HTTP 调用前拒绝超预算的完整请求体，通过时发送已经检查的同一份字节且不重试。此路径没有预算缓存、二次序列化、自动重试或默认 Host 上限。实际观察到的本地请求体超限与编码参数超限一样映射为附件模型的 `REQUEST_TOO_LARGE`；非法或失败的预算发现保留其既有失败分类。

预算观察不预留容量，也不授予上传权限。Host 继续执行实际字节限制和当前设备授权，更小的代理上限或变化后的 Host 配置仍可拒绝已通过本地检查的请求。本地 512 KiB 源文件、1 MiB 编码参数和八项附件限制仍是独立约束。transport 检查覆盖所有 `fileUploads/upload` 调用者，包括文件分享。图片上传保留独立路径；查询或上传失败不能替换 pending 意图，也不能部分采纳分享批次，恢复操作是用户显式重新选择来源。

## Alternatives considered

**公布一个全局 Host 预算或统计监听器数量。** 全局值不能标识实际接收当前请求的监听器。仅有隔离监听器时，数量也不能证明分派正确。

**在替代 adapter 中调用可信本地 `invoke()` 或 `stream()`。** 这些方法不执行原生签名准入。复用它们会改变授权路径，而非修正调用 context。

**估算 base64 额外开销、比较字符串长度，或以 Host 预算替换源文件限制。** JSON 转义、非 ASCII 文本、元数据和 admission 都影响实际请求体。请求体上限不是源文件大小或内存分配目标。

**缓存一次成功预算或自动重试已拒绝的 mutation。** 缓存观察可能比监听器或 principal 存活更久，传输失败也可能留下无法确认的上传结果。每次重新读取和显式上传使这些生命周期保持独立。

## Consequences

每次显式文件上传现在都会在 mutation 前多执行一次只读 RPC，且本地检查仍是建议性的：接收请求的 Host、其前置代理或后续配置变化仍可拒绝已通过本地检查的请求。

[原生监听器隔离场景](../../../../apps/web/tests/native-remote-isolation.e2e.ts) 3 个用例全部通过，退出码 0。在根监听器存在（其请求体上限与隔离监听器不同）或不存在两种组合下，隔离监听器的常规 profile RPC 和 stream 经过签名准入、viewer 权限拒绝、stream 中途撤权、取消与监听器释放后仍保持在接收监听器的 scope 内，存活的根监听器保持自己的 scope。预算用例对真实的 2048 字节监听器上限执行：两种查看角色都读到接收监听器的值，完整字节数恰为 B−1 与 B 的真实签名编码文件请求体通过上传与存储准入，B+1 在任一准入前收到 HTTP 413。预算内的 viewer 上传因 `prompt.send` 被 `gateway/permission-denied` 拒绝，被撤权的 collaborator 收到 `device/already-revoked`，且没有记录任何用户消息。测量的请求体使用非 ASCII 文件名，JSON 转义计入被检查字节。

聚焦 Android core 轮次 7 个 suite 共 57 项测试通过，无失败、错误或跳过，其中包含 7 项 [client 预算测试](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/gateway/NativeGatewayUploadBudgetTest.kt) 与 3 项 [预算解析测试](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/gateway/NativeHttpRequestBudgetTest.kt)：每次显式上传重新读取预算并按包含上限签名、编码参数低于自身限制时按完整请求体拒绝、绕过 UI 准入的直接 wire 调用、缺失或未知 capability、malformed/被拒绝/不可用的回复不复用先前额度、图片与 prompt 操作不查询文件预算、被取消的查询不发送其等待的文件，以及公开 Host 选择终止持有中的预算查询。该单元轮次在本增量更早的构建轮中执行；其后的最终源码调整由下方已安装场景与回归场景覆盖，未重复执行单元轮次。

[已安装 Android 预算场景](../../../../apps/web/tests/android-native-upload-budget.e2e.ts) 单用例通过，退出码 0，已安装应用与 instrumentation APK 哈希与被测构建一致。真实的 Host 传输拒绝先保留一条旧 pending prompt。随后一个处于本地源文件与编码参数限制内的真实 SAF 文件在本地被拒绝为 `REQUEST_TOO_LARGE`：恰好一次预算读取、零次文件 POST、零次 prompt，旧 pending prompt 与新草稿都保持原状。显式丢弃后显式选择更小文件会再次查询预算并上传一次；Host 存储字节与独立哈希一致，最终显式发送只产生一条持久用户消息。Android 进程、Host 身份与单一设备授权保持不变。三张截图（`budget-refused`、`smaller-file-ready`、`sent-smaller-file`）与已安装 APK 哈希保存在 `.artifacts/android-native-upload-budget-ui/` 下。

聚焦回归以退出码 0 通过：[Files](../../../../apps/web/tests/android-file-attachments.e2e.ts)、[回执恢复](../../../../apps/web/tests/android-attachment-receipt-recovery.e2e.ts) 与 [分享接入](../../../../apps/web/tests/android-share-intake.e2e.ts) 各一例。host 与 client 构建 face 以及生成的 Cordis catalog 门禁在改动后以退出码 0 通过。当天早些时候的两次运行失败并在上述结果前修正：隔离场景的预算用例经 Agent scope 而非 Host service 解析 `fileUploads`；catalog 门禁拒绝了 factory 方法缺失的 JSDoc。

这些结果验证的是被测试的模拟器、脚手架与 TLS 路径。物理设备、任意第三方发送方与提供方、流式、断点续传或图片请求体预算、Swift 接入与完整 Mobile Release 验收仍是独立的后续验证工作。保留的 [Native transport 决定](2026-09-25-native-remote-connection-source.zh.md)、[设备准入决定](../feature/2026-09-21-per-request-device-admission.zh.md)、[Files 决定](2026-09-27-android-file-attachments.zh.md) 与 [Share 决定](2026-09-28-android-share-intake.zh.md) 继续分别负责安全、来源和输入生命周期。
