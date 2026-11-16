# Agent Note: Android 分享入口确认单个目标并原子采用完整批次

Status: implemented

[English](2026-09-28-android-share-intake.md) | 中文

## 问题

外部分享可能在配对前、其他选择器活动时，或 Host、Session 切换期间到达。收到 Intent 不代表已授权读取提供方、上传或提交 prompt。逐个把附件导入草稿会暴露部分批次，并在发送互斥期间留下空隙。采用后的本地保存失败也不同于上传失败：重复导入会把内容追加两次。

## 决策

`MainActivity` 通过 `singleTask` 和 `onNewIntent` 接收 `ACTION_SEND`、`ACTION_SEND_MULTIPLE`。`NativeShareIntake` 只在内存保留一份待处理文本与 URI 载荷，不查询提供方元数据、打开流或上传。新投递不能覆盖待处理或导入中的内容；消费后，即使 URI 相同，新显式投递仍是新的待确认输入。文本、URL 及类似 HTML 的内容均作为原始文本保留，不触发导航或抓取。

接收卡片显示当前 Host 与普通 Session，并要求确认 **添加到草稿**。捕获目标包含准确的附件模型与输入所有者、Host key 与代次、Session id 与选择代次。确认再次检查所显示目标、角色、输入可用性、Session 控制支持及相关上传能力。Core 在与 prompt 互斥相同的锁内比较预期 Session 代次。目标替换会取消捕获的操作，不自动采纳新目标。已有文件、照片或相机选择器仍持有自己的票据与回调；分享投递不能消费它。确认入口持续禁用，直到该操作独立返回结果并完成清理；不会排队自动导入。

新的分享进入待确认状态时，清除输入区焦点并收起软件键盘，方便用户核对 Host、Session 及确认控件。

Intent 解析优先采用有序 `EXTRA_STREAM` 载荷；只有不存在该载荷时才读取 `ClipData` 中的 URI 条目。两种表示不会拼接，重复出现的条目也不去重。来源必须是具有 authority 且不含用户信息的 `content` URI；格式错误的 extras、嵌套 Intent、selector 和应用私有相机提供方 URI 均被拒绝。应用不取得持久源授权，不删除共享文档，也不把源字节存入输入检查点。

传入文本限制为 64 KiB UTF-8，传入及合并后草稿的附件限制为 8 个，每个来源限制为 512 KiB，每次编码上传参数 JSON 限制为 1 MiB。JSON 限制不包含带签名的 RPC envelope；这些应用限制不与 Host 协商。文件上传还在派发前检查 [Native 请求体预算](2026-09-28-native-http-upload-budget.zh.md)，不改变批次的本地原子采纳，也不增加图片请求体预算。确认后才在 I/O dispatcher 解析 MIME。声明为图片的来源必须解析为支持的 PNG、JPEG、WebP 或 GIF；未知或不支持的图片类型直接失败，不降级为通用文件。其他条目按提供方 MIME 选择图片或文件准入。解析后的类别必须受允许，应用才会查询名称或打开字节。

[查看位置链接决定](2026-09-28-android-view-deep-links.zh.md)拥有 `ACTION_VIEW` 导航。分享收到的 URL 仍为文本。两个外部入口都不能替换对方的待处理操作；繁忙拒绝后，需要在既有工作结束时显式重试或重新投递。

## 原子采用到草稿

`NativeFileAttachmentsModel.importShare()` 在整个有序批次中持有一个 `SessionAttachmentAdmission`。它复用普通附件入口的有界读取、编码上传及回执校验，不在条目之间释放准入占用。从提供方及 RPC 工作、原子采用，直到后续 `inputs.flush()` 检查点尝试结束，发送、重试和其他附件入口持续被阻止。取消等待所属工作结束；即使父级取消导致协程主体无法启动，完成处理仍会释放占用。

只有整组有效的暂存回执才能进入一次原子输入更新。该更新按最新草稿重新核对目标及附件总量，保留已有附件和上传期间的编辑，追加传入的有序附件，并用一个空行连接非空的已有与传入文本。更新只生成一个新请求 id，原始待确认 prompt 全部保持不变。采用前，任何读取、上传、回执、限制或所有权失败都不会由导入修改草稿。此类失败后，已经暂存成功的 Host 对象可能仍无引用；批次不新增存储回滚或垃圾回收。

`NativeShareResult` 区分 `NotAdopted` 和 `Adopted(requestId, saved)`。若原子更新后发生取消或 `inputs.flush()` 失败，独立的完成结果仍保留已经采用这一事实。两种已采用结果都会消费待处理分享。`saved = false` 保留已采用草稿，提供既有本地输入保存重试，不再次上传或追加。只有同一个采用方 `CompanionInputState` 报告 `SAVED`，保存提示才会清除；另一 Host 保存成功不能清除它。两类失败都不会调度自动上传重试或 prompt。

## 恢复与所有权

旋转保留内存中的分享持有者。`SavedStateHandle` 只记录 pending/done 状态；进程恢复将未完成分享标为中断，不从该标记重建文本、来源或 URI 授权。已消费分享恢复后不显示中断提示。恢复的 Activity 或带 `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY` 的启动不重新处理原始分享 Intent。之后显式到达的新 Intent 可以创建新的待确认输入。已采用草稿使用既有加密输入格式，恢复回执时不读取提供方，也不自动提交。

[文件决定](2026-09-27-android-file-attachments.zh.md)继续拥有文档选择器与源读取，[照片决定](2026-09-27-android-photo-attachments.zh.md)继续拥有图片暂存及混合回执语义，[相机决定](2026-09-27-android-camera-attachments.zh.md)继续拥有应用所持输出的清理及外部回调退役。[输入检查点决定](2026-09-26-android-encrypted-input-checkpoints.zh.md)继续拥有持久输入身份与恢复。分享入口组合这些机制，不改变 Host 协议或加密输入版本。

## 考虑过的替代方案

**收到分享就读取或上传。** 用户尚未确认 Host 或 Session，访问提供方本身也可能失败或执行工作。接收只保留已投递值，确认先确定准确目标，再进行 I/O。

**循环使用普通单附件选择器准入。** 每次释放都可能允许在条目之间发送 prompt，每个已采用回执也会暴露部分批次。单次占用与最终的一次草稿更新保留完整批次意图。

**重新应用开始确认时捕获的草稿。** 上传可能与用户更新的编辑重叠。在输入锁内追加可保留当前文本及附件，避免用旧快照替换它们。

**把检查点失败当作尚未采用的分享。** 草稿已经包含该批次。继续允许重试原分享会再次上传并追加，因此采用与保存分别报告。

**恢复 URI 载荷或重放 Activity 原始 Intent。** 已保存值不能证明当前提供方授权，也不能代表新的显式导入决定。未采用且已中断的分享需要重新投递；完成后的回执通过输入存储恢复。

## 后果

分享入口扩展草稿，不发送消息，也不创建第二套附件协议。发送方授权可能过期，提供方可能阻塞取消，失败批次也可能留下已暂存的 Host 对象。物理设备、任意第三方发送方/提供方、跨平台分享及真实模型附件理解需要独立验收。

完整 Android core 结果记录 66 个套件、406 个测试通过，无失败、错误或跳过。其中 10 个[批次测试](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/NativeShareAttachmentsModelTest.kt)和 6 个[生命周期测试](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/NativeShareAttachmentsLifecycleTest.kt)覆盖原子采用、限制、互斥与取消。应用与 instrumentation APK 构建通过。

模拟器安装态运行的 31 个用例全部通过：12 个[分享入口测试](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeShareIntakeTest.kt)、1 个 [Activity 测试](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeShareActivityTest.kt)、9 个文件/照片选择器用例及 9 个相机用例。分享覆盖包含 Intent 解析、准确目标所有权、取消、恢复及跨旋转的单 Activity 投递。

[真实 Host 分享场景](../../../../apps/web/tests/android-share-intake.e2e.ts)的单个用例通过，两个已安装 APK 的哈希均匹配当前产物。系统文件应用通过真实 Sharesheet 投递测试自有来源；查看和取消分享保留草稿，不修改 Host。断言核验确认卡片收起键盘，Host、Session 及确认控件均可见。显式确认纯文本分享追加原始文本及 URL。暂缓第二次上传证明首个回执不能部分更新草稿或允许发送；完整采用保留并发编辑及投递顺序。独立计算的 Host 文件与图片字节哈希匹配已知二进制及无元数据 PNG。

场景核对源文件哈希后，只删除测试自有来源，并在另一分享待确认时终止应用。重启丢弃待处理分享，同时恢复已完成草稿及请求身份，不上传或发送 prompt。显式发送准确记录一条包含原顺序附件内容的用户来源消息。这些证据验收所测模拟器及系统分享路径；模型响应来自无密钥录制回放。

较广的原生回归通过 9 个文件、12 个用例，覆盖分享、相机、照片、文件、输入持久化、两个 prompt 重试路径、诊断、查看位置及三个凭据恢复用例。局部键盘修复后，聚焦运行通过分享和[持久下载](../../../../apps/web/tests/android-download-adoption.e2e.ts)，共 2 个文件、2 个用例；最新安装态运行也通过全部 31 个用例。各次运行分别记录，不累加为独立用例总数。当前分享的五张整屏截图均已审阅：接收卡片完整显示目标且键盘关闭，草稿编辑仍正常使用键盘，恢复和发送后的附件保留展示名称及顺序。
