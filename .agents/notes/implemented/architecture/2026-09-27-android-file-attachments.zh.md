# Agent Note: Android 文件附件保留单次显式选择与完整 prompt 意图

Status: implemented

[English](2026-09-27-android-file-attachments.md) | 中文

## 问题

本地文档必须先到达所选 Host，prompt 才能引用它。选择器结果、源读取和上传响应可能在 Session 或 Host 切换后才返回。暂存回执的生命周期也不同于本地草稿：恢复其元数据不代表 Host 仍接受它。Android 输入区需要文件入口，同时避免以旧请求身份发送新草稿，或把恢复的 URI 元数据当作再次读取的权限。

## 决定

Host 声明 `file-upload.stage.v1` 且 Session 控制可用时，Session 输入区提供 **+ → 文件**。它使用 `ACTION_OPEN_DOCUMENT` 和 `*/*` 一次选择一个文件。`NativeFileAttachmentPicker` 由 Activity ViewModel 持有，跨旋转保留原始 `NativeFileAttachmentsModel` 和一次性的 `NativeFileSelection`。恢复的进程不具有选择授权。已取消选择器在结果返回前仍占用位置，避免第二次选择消费旧结果。重复、取消和已退役的结果不能为另一 Session 代次或 Host 打开源文件。

`AndroidNativeFileAttachmentSource` 仅在核心模型的 I/O dispatcher 调用时读取显示元数据并打开所选 content URI。应用不取得持久 URI 授权，不在输入检查点中保存源 URI，也不删除源文档。源流在所属工作完成前关闭。Session 切换使所选代次失效；取消和 Host 退役等待所属提供方 I/O 与 RPC 工作结束。阻塞的提供方可能延长等待。

`NativeFileAttachmentsModel` 接受不超过 512 KiB 的文件，每份草稿最多接受 8 个文件，并将 UTF-8 编码后的上传参数 JSON 限制为 1 MiB。这些是应用提供的本地限制。JSON 限制不包含带签名的 RPC envelope；Host 独立限制完整请求体，两者不进行限额协商。模型将通过准入的字节编码为 base64，通过所选模型的签名 wire 调用 `fileUploads/upload`。它不使用 Host 流式路由，也不支持可恢复上传偏移。

返回的回执与文件元数据以 `SessionFileAttachment` 进入所选 Session 草稿。上传完成后显示可移除的文件名与大小卡片；选择、读取或上传期间禁用发送及待确认 prompt 重试。prompt 可以只含文件而不含文本。移除只修改本地草稿，不删除 Host 字节。失败提示使用固定本地化类别，不包含源路径或提供方原始异常。`DomainFold` 将收到的持久文件块呈现为文件名与字节数摘要。

## 持久意图与回执生命周期

[输入检查点决定](2026-09-26-android-encrypted-input-checkpoints.zh.md)拥有严格的版本 2 文档、主体隔离及完整文本/文件请求身份。prompt 组装发送文本与有序文件回执引用。即使输入区已有更新的文本或文件，显式重试仍复用原始待确认意图及其回执。确认只在完整意图仍匹配时清理输入区草稿。进程恢复重新加载已保存回执，不上传或提交它们。

[通用文件上传决定](../feature/2026-08-26-generic-file-upload.zh.md)继续拥有 Host 字节存储、Session 范围暂存回执、持久 `FileBlock` 准入和模型可见文件句柄。其内存暂存回执可能在 Host 或 Session 退役后过期。Android 保留失败意图，不在重试时替换回执。恢复需要显式移除并重新选择、上传文件；必须先显式丢弃未确认的原始意图，不能悄悄改写它。丢弃本地输入不会撤回 Host 可能已接受的 prompt。

取消编码上传不能保证回滚：Android 取消或拒绝迟到响应前，Host 可能已经保存字节。这些未引用字节继续遵循 Host 附件保留策略。输入持久化、Host 上传存储和[保存 Host 的采纳](2026-09-26-android-saved-host-catalog.zh.md)仍是独立有用的决定；本 Note 拥有它们的 Android 文档选择器消费方。

## 考虑过的替代方案

**持久保存 URI 权限，或自动继续恢复的文件选择。** 源 URI 与用户当前上传意图不同。仅内存选择器授权使进程恢复只进行观察，再次上传需要新的显式选择。

**在待确认重试内部替换过期回执。** 这会改变既有请求 id 所关联的文件意图。待确认意图保持不变，替代上传属于新的显式意图。

**新增原生流式或可续传上传协议。** 既有编码操作无需增加传输协议即可支持有界文件入口。代价是本地文件大小限制，以及失败后从字节零重新传输。

**收到任何成功确认就清理草稿。** 较早发送可能在文本或文件编辑后完成。只清理完全一致的完整意图才能保留更新的编辑。

## 后果

核心 XML 结果记录 62 个测试套件中的 373 个测试全部通过，无失败、错误或跳过。其附件覆盖包括字节与编码 JSON 限制、回执校验、完整意图身份、持久化、选择代次拒绝，以及等待源读取/请求取消。六个[安装态选择器测试](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeFileAttachmentPickerTest.kt)全部通过。

[真实 Host 场景](../../../../apps/web/tests/android-file-attachments.e2e.ts)在 Android 34 x86_64 模拟器和系统文档提供方上通过，已安装应用/测试 APK 的哈希与当前构建匹配。它独立计算 Host 已存字节的哈希，检查本地移除与加密输入，并终止 Android 进程后恢复相同设备授权、文件回执及请求 id，不自动上传或发送 prompt。显式提交准确产生一条用户来源消息，包含完整文本与有序 `FileBlock` 列表；插件来源的 system-prompt 快照元数据单独核验。这不表示完整的 `user/message` 事件流只有一个事件。

原生组合回归的四个文件、五个用例全部通过：文件附件、[输入持久化](../../../../apps/web/tests/android-input-persistence.e2e.ts)、两个[丢确认恢复用例](../../../../apps/web/tests/android-prompt-retry.e2e.ts)，以及[持久下载](../../../../apps/web/tests/android-download-adoption.e2e.ts)。这些结果仅验收所测模拟器和系统提供方。

本工作不增加照片、相机或分享 intent 入口、持久 URI 访问、后台上传调度或上传续传。物理设备、第三方文档提供方、真实模型使用文件及跨平台互操作仍未通过资格验证。
