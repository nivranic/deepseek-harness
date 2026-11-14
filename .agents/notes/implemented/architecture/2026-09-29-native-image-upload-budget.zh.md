# Agent Note: 原生图片上传采用同一完整请求体预算准入

状态：implemented

[English](2026-09-29-native-image-upload-budget.md) | 中文

## 问题

[文件预算决策](2026-09-28-native-http-upload-budget.zh.md)只覆盖 `fileUploads/upload`。`fileUploads/uploadImage` 在未读取监听器预算的情况下发送完整签名请求体，一张处于本地源文件与编码参数限制内的 Photo Picker 图片仍可能超过接收监听器的请求体上限，并以传输失败而非准入结果的形式暴露。只要 Host 声明了 `image-upload.stage.v1`，输入区的照片入口就保持可用，即使 Host 未同时声明 `native-remote.http-request-budget.v1`，该入口的每次上传也都会失败。

## 决策

Native 客户端的预算准入现在覆盖两个显式上传端点。`fileUploads/upload` 与 `fileUploads/uploadImage` 各自通过同一已验证 Native 客户端读取接收监听器的预算一次，校验后在构造 HTTP 调用前对最终发送的完整 UTF-8 字节做拒绝判定。观察到的超限映射为附件模型的 `REQUEST_TOO_LARGE`，不重试、不追加 receipt、不替换草稿与 pending；每次显式上传各读一次新预算、不缓存、不使用默认值，均沿用文件预算决策。输入区的照片操作同时要求 `image-upload.stage.v1` 与 `native-remote.http-request-budget.v1`；仅缺少预算能力时，入口提示指出缺少 Host 上传限制而非图片支持。[文件预算决策](2026-09-28-native-http-upload-budget.zh.md) 继续持有预算发现、分派作用域与失败类别的所有权。

## 已考虑的替代方案

**仅按编码参数准入图片。** RPC 元数据与签名准入使完整请求体大于参数本身；文件决策比较最终字节正是为此。

**为两类上传缓存同一预算。** 跨请求缓存可能复用另一监听器或更早配置的值；每次显式上传都读取新值。

**预算能力缺失时仍保留照片入口。** 每次图片上传都将在传输层失败且没有准入解释；入口改为报告缺失的前置能力。

## 结果

Android core 全量套件 450 个测试无失败、无错误、无跳过，包含[客户端预算测试](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/gateway/NativeGatewayUploadBudgetTest.kt)的图片用例：每次显式图片上传读取新预算并按 inclusive 上限签名、超出一字节在 POST 前被拒绝、拒绝或能力缺失的 Host 被阻断而非回退到无上限请求体、prompt 操作不查询预算。support export 夹具补记了文件增量过滤单测轮未记录的 `native-remote.http-request-budget.v1` 能力行。

[已安装图片预算场景](../../../../apps/web/tests/android-native-image-upload-budget.e2e.ts) 单用例 exit code 0 通过，两个已安装 APK 哈希与被测构建一致。一张经单个 ancillary tEXt 块填充到 1280 字节的真实 PNG——编码参数在 2048 内——在恰好一次预算读取后被本地拒绝为 `REQUEST_TOO_LARGE`，零图片 POST、零 prompt，文本草稿保留。删除被拒来源照片后，显式较小的选择再次读取预算并一次上传 69 字节源 PNG，Host 存储与会话授权读取返回已验证字节，最终显式发送只产生一条含单个 ImageBlock 的持久用户消息。三张截图（`image-budget-refused`、`small-image-ready`、`sent-small-image`）与已安装 APK 哈希保存在 `.artifacts/android-native-image-upload-budget-ui/`。

聚焦回归 exit code 0 通过：[Photos](../../../../apps/web/tests/android-photo-attachments.e2e.ts)——照片入口门控变更后必需——以及 [Files](../../../../apps/web/tests/android-file-attachments.e2e.ts)、[receipt 恢复](../../../../apps/web/tests/android-attachment-receipt-recovery.e2e.ts)与[分享采纳](../../../../apps/web/tests/android-share-intake.e2e.ts)各一例。以上结果验证被测模拟器、脚手架与 TLS 路径；物理设备、第三方发送方、图片批次准入、流式与断点续传、Host 重启后的预算失效仍为独立资格工作，边界由文件预算决策持有。
