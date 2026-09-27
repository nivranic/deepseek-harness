# Agent Note: Android 照片使用暂存图片回执与单一有序附件意图

Status: implemented

[English](2026-09-27-android-photo-attachments.md) | 中文

## 问题

选中的照片需要先通过 Host 图片校验与规范化，持久 prompt 才能引用它。把照片当作通用文件会向模型提供文件句柄，而不是图片；把内联字节保留在加密输入中则会让重试身份依赖较大的载荷。分离文件与图片列表还会丢失用户的混合选择顺序。源字节、规范化字节、暂存回执授权和已接受消息身份拥有不同生命周期，不能相互替代。

## 决策

Session 控制与 `image-upload.stage.v1` 均已声明时，Session 输入区提供 **+ → 照片**；`file-upload.stage.v1` 独立控制 **+ → 文件**。照片入口通过 AndroidX `PickVisualMedia(ImageOnly)` 请求一张图片。文件与照片共用一个活动选择持有者，因此取消、Activity 重建、Session 替换和 Host 退役遵循[文件附件决定](2026-09-27-android-file-attachments.zh.md)中的一次性授权。应用不取得持久 URI 授权，也不保存源 URI；进程恢复不能重新打开或上传所选来源。

Android 接受 PNG、JPEG、WebP 和 GIF 源 MIME 类型；未知类型和 HEIC 直接拒绝，不进行转换。应用限制每个源文件最多 512 KiB、混合草稿最多 8 个附件、UTF-8 上传参数 JSON 最多 1 MiB。JSON 限制不包含带签名的 RPC envelope，这些限制也不与 Host 协商。读取与上传保持为显式、有界的工作；阻塞的内容提供方可能延长取消清理。共享的 `SessionAttachmentAdmission` 占用在选择、读取、上传及取消清理期间，从模型入口拒绝发送与重试。所属任务或生命周期完成后释放占用，包括协程主体启动前已被取消的情况。

Host 的 `fileUploads/uploadImage({ data, mediaType, name? })` 操作要求 `prompt.send`，并使用附件服务的规范 base64 校验、支持格式检查与规范化。它返回不透明的图片 `receiptId` 及规范化 `image` 元数据。Host 在回执内私下保留源编码字节数。规范化后的字节、尺寸与媒体类型描述已存图片，不必等于所选来源；`originalDimensions` 是可选元数据，不是重新读取来源的授权。

Android 在单一有序的 `SessionDraft.attachments` 列表中保存文件与图片。图片条目保留回执、规范化附件 id、媒体类型、字节数、宽、高、可选名称及可选原始尺寸。prompt 组装使用文件回执部分和独立的 `{ type: 'staged-image', receiptId }` 标签，保留混合顺序。[输入检查点决定](2026-09-26-android-encrypted-input-checkpoints.zh.md)拥有严格的版本 3 持久化：版本 1 和 2 被拒绝，其加密字节保持原样。恢复草稿只恢复元数据与观察。修改文本或附件会创建新请求 id；未修改的显式重试保留完整原始意图，即使输入区已有更新的编辑。

Session Controller 在接收方普通 Session 内解析每个暂存回执，并拒绝不匹配的文件/图片类别。暂存与内联图片都要求所选模型支持图片。附件准入合并计算两者的出现次数与原始编码字节总量，重复引用也计入，并在写入任何内联图片前检查。暂存总量使用 Host 保留的源字节数，不使用可能更小或更大的规范化字节数。被接受的暂存图片转换为既有持久 `ImageBlock`；持久事件不含源 URI 或 base64。[附件服务](../../../../packages/attachment/attachment/README.zh.md)拥有图片准入与存储，[上传服务](../../../../packages/client/file-upload/README.zh.md)拥有回执发布与绑定。

## 回执生命周期与恢复

文件与图片回执共用 prompt 绑定、投递失败回滚、队列/历史观察后的退役及请求 id 去重。未发送回执在 Host 重启或所属 Session 销毁后过期。Android 保留过期的待确认意图供用户检查；替换附件需要显式丢弃，再重新选择并上传。移除卡片或丢弃本地输入无法撤回 Host 已接受的 prompt。

图片回执发布前取消不会返回可用回执，但正在进行的 Host 存储写入仍可能完成。Session 或 Host 替换会拒绝迟到的本地结果；取消与本地移除都不保证存储回滚。不可变且未引用的对象继续遵循既有保留策略，不新增垃圾回收。[通用文件上传决定](../feature/2026-08-26-generic-file-upload.zh.md)继续拥有原样文件存储、命令附件与模型文件句柄；文件选择器和输入检查点决定因其独立的生命周期与恢复规则继续保持有效。

## 考虑过的替代方案

**把照片作为通用文件上传。** 通用文件保留原始字节，并投影为按需读取路径。照片入口需要图片校验、规范化及模型既有图片通道，因此使用独立的暂存图片操作。

**持久保存内联 base64 或源 URI 授权。** 两者都会扩大持久意图的职责，并诱使恢复后自动读取来源。完成上传后的 Host 回执与规范化元数据足以支持显式发送和重试；不可读取或已过期的授权保持为可见失败。

**使用规范化字节计算 prompt 预算。** 规范化可能缩小较大来源，也可能放大较小来源。回执内由 Host 持有的原始计数，在混合暂存与内联图片时保留源预算。

**分别保留文件和图片草稿列表。** 拼接列表会改变用户选择顺序，并削弱完整意图相等判断。单一带标签列表在持久化、确认及重试中保留顺序。

## 构建验证

[根 Host 编译程序](../../../../tsconfig.host.json)包含 Android E2E 测试族，[Web Client 编译程序](../../../../apps/web/tsconfig.json)排除它们。每个驱动只属于一个编译面，因为 Host 与 Client 的 Cordis `Context` 声明不能共处一个程序。真实 Loader 验证要求同时运行 `pnpm run build:lib:host` 与 `pnpm run build:lib:client`；file-upload 包的[打包配置](../../../../packages/client/file-upload/tsdown.config.ts)在 Client 阶段生成其 Node 入口。仅构建 Host 无法提供该场景加载的全部产物。

## 后果

聚焦 Host 验证的 9 个文件、170 个测试全部通过；Host 与 Client 构建及完整 Host 类型检查通过。完整 Android core 结果记录 63 个套件、385 个测试通过，无失败、错误或跳过，其中包括模型持有的发送互斥与取消清理。9 个安装态[选择器测试](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeFileAttachmentPickerTest.kt)全部通过。

[照片场景](../../../../apps/web/tests/android-photo-attachments.e2e.ts)已在 Android 34 x86_64 模拟器通过，两个已安装 APK 的哈希与当前构建一致。系统 Photo Picker 与 SAF 形成图片/文件/图片的有序草稿，独立 Host 存储哈希与已知无元数据 PNG 和文件字节匹配。删除测试专属源照片并终止应用进程后，同一授权、回执、顺序和请求身份恢复，没有自动上传或提交。显式发送产生唯一用户来源消息，ImageBlock/FileBlock/ImageBlock 内容完整匹配；系统提示词快照元数据单独核对。Session 授权图片读取返回已核验的 PNG，Android 展示发送名称。

Android UI 提供照片入口，不新增附件存储、Session 事件类型、自动修改重放或上传续传协议。Host 规范化保持权威，Android 进程恢复后仍显式呈现暂存回执过期。模型响应使用无密钥录制回放，不证明真实模型的图片理解。物理设备、第三方照片提供方、HEIC 转换及相机/分享 intent 入口仍不在已验收范围内。
