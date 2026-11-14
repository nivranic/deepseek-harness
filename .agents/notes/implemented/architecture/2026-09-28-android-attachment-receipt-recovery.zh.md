# Agent Note: Android 附件回执恢复保留显式发送意图

Status: implemented

[English](2026-09-28-android-attachment-receipt-recovery.md) | 中文

## Problem

Android 草稿的寿命可能超过为其暂存附件的具体 Host Session。恢复草稿不能恢复回执的授权。通用的输入无效提示无法解释如何替换附件，同时保留不同的新草稿，并避免在旧请求 id 下发送已改变的内容。

## Decision

`PromptSubmissionFailure.attachmentReceiptUnavailable` 仅识别 `session/attachment-invalid`，且字符串 `details.reason` 必须为 `FILE_NOT_STAGED` 或 `IMAGE_NOT_STAGED`。原因不在顶层 code 中。其他原因、缺失或类型错误的 details，以及其他 code，保留既有 Gateway 分类与展示。完整失败 envelope 仍用于诊断。

Session 输入区对这两种原因显示本地化恢复提示。提示明确说明，丢弃旧发送会同时删除未再编辑的对应草稿，并建议先复制需要保留的文字。用户随后移除仍存在的旧附件，重新选择，再显式发送。提示不推断超时、重启或其他原因：未知、跨 Session 或种类错误的回执也可能得到同一拒绝。

[文件](2026-09-27-android-file-attachments.zh.md)与[照片](2026-09-27-android-photo-attachments.zh.md)决定继续拥有选择器入口、上传限制、来源寿命和有序草稿附件。回执替换复用这些既有操作，不增加自动上传、发送、丢弃或来源读取，也不保存 provider URI 授权。不改变 Host 操作、Session 事件或加密输入格式。

## Pending sends and newer drafts

被拒绝的发送保留捕获的文本、附件和请求 id。即使输入区文字不同，显式重试仍提交原意图。编辑输入区会创建不同的请求 id，不改变待确认意图。丢弃移除指定的待确认意图，仅在输入区草稿的请求 id 仍匹配时一并移除该草稿；不同的新草稿保留。本地丢弃不撤回 Host 可能已接受的工作。

移除旧附件与添加新选择的上传分别改变草稿的请求 id。替换回执属于由此产生的新意图，不覆盖待确认重试。Host 字节去重可以保留相同 attachment id，即使上传回执与 prompt 请求 id 都是新的。

重试仍要求 Session 控制能力、输入可编辑、没有正在发送且没有附件操作。丢弃要求输入可编辑且没有正在发送；仅有附件操作不会禁用它。[输入检查点决定](2026-09-26-android-encrypted-input-checkpoints.zh.md)继续拥有输入保存、确认与进程恢复。

## Alternatives considered

**把所有 attachment-invalid 响应视为回执不可用。** 模型模态及其他附件失败需要不同修正。精确匹配两个 detail 值可使其他失败保留原处理路径。

**在待确认重试中替换回执，或自动重传记忆中的来源。** 两者分别改变捕获的意图，或假定恢复元数据并未提供的来源授权。新的显式选择与请求 id 保留用户控制。

**拒绝后同时清空待确认输入和新编辑。** 拒绝只涉及原请求。清除无关的新文字会销毁用户尚未提交的输入。

## Consequences

Core 验证通过 69 个 suite 中的 434 个测试，失败、错误及跳过均为 0。回执分类覆盖两个精确的 not-staged 原因及回落情形。发送意图测试验证原请求重试、独立新草稿保留、相同请求丢弃，以及编辑、移除和替换后各不相同的请求 id。

仅 Host 的可行性场景通过 1 个测试，退出码为 0。公开 Agent handle 完成真实文件上传、Session flush 与等待释放；无须额外写 title 即可读取持久化 header。普通 Session Controller resume 在相同持久身份下创建新的 Agent 和 Session 对象。携带旧回执的认证 HTTP prompt 收到准确的 not-staged 拒绝，不追加事件。

[已安装 Android 恢复场景](../../../../apps/web/tests/android-attachment-receipt-recovery.e2e.ts)通过 1 个用例，退出码为 0。应用与 instrumentation 构建均成功，已安装 APK 哈希匹配对应构建。真实 SAF 文件上传至 Host 存储并独立核对字节哈希。等待 Session 释放与普通 Controller resume 保持相同 Host 和持久 Session id，同时使旧回执失效。初次发送与显式重试得到真实 `session/attachment-invalid` / `FILE_NOT_STAGED` 拒绝；捕获的原意图与不同的新草稿均保持完整。显式丢弃保留新草稿，移除与 SAF 重选产生新回执，各次编辑合计形成四个不同草稿请求 id。准确两次上传和三次 prompt 调用，仅在最终显式发送后产生一条持久用户消息。Android PID、本地 Session 模型、Host 身份及唯一设备授权保持不变；请求、follow 与 driver 清理完成。

四张已复核截图记录完整拒绝指引、原 pending 文字与不同新草稿文字同屏、待发送的替换附件，以及唯一已接收文件消息和空输入区。待确认卡片可滚动：告知与丢弃按钮分别滚动至可见位置并检查后再点击，场景不要求整张卡片同屏。

独立回归通过 3 个文件、3 个用例，退出码为 0：[Files](../../../../apps/web/tests/android-file-attachments.e2e.ts)、[Photos](../../../../apps/web/tests/android-photo-attachments.e2e.ts)和[通知权限](../../../../apps/web/tests/android-notification-permission.e2e.ts)。这些结果与恢复用例分别记录。Photos 回归覆盖其既有入口和恢复行为，不验证图片回执失效后的恢复。

这些结果验证 SAF 文件因 Session 寿命结束而失效后的恢复，不验证 Host 进程重启或按时间到期。真实照片回执恢复、混合附件、物理设备，以及中断或断点续传仍属独立验收范围。
