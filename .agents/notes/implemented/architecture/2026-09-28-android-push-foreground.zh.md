# Agent Note: Android Push 恢复遵循前台入口与模型所有权

Status: implemented

[English](2026-09-28-android-push-foreground.md) | 中文

## 问题

返回已有 Android Activity 不会重建保留的模型。因此，通过通知打开应用后，已经结束的事件观察仍可能保持静默。每次进入后台都停止观察，又会阻止在线 Host 产生本地通知；重建模型则会丢弃与此无关的 Session 历史和输入所有权。

## 决策

应用通过生命周期的 `ON_START` 事件调用 `PushModel.ensureWatching()`。在已经启动的 Activity 上注册观察器时，会补发同一个初始事件，不再另行无条件启动。首次连接和每次后续进入前台均使用一次同步准入。健康或正在启动的观察保留已有任务，包括 Activity 处于后台期间。没有定时器或后台重试循环。

模型准入首次观察，此后只有当前任务及其清理以正常 EOF 或 `canReconnectObservation()` 接受的失败结束，才准入下一次观察。分类使用原始异常：普通传输故障与已识别的临时 Host 失败可以恢复；权限、认证、兼容性、未知拒绝、无效响应、内部失败，以及证书或 TLS 对端失败均不能自动恢复。取消不转换为 EOF。支持快照的粗粒度失败类别不能授权重试。

同步准入在调度任务前占用下一次启动。既有流所有者等待已退休任务并隔离代际。只有当前代际的完成可以恢复重试资格，已取消的模型作用域不能恢复资格。清理期间进入前台不改变该任务；清理完成后，需要再次进入前台才能恢复。返回前台不会重启 Session、Workspace 或 Interaction 模型，也不发业务修改。

## 生产流与通知所有权

`CompanionModelSet` 在 ViewModel 作用域内拥有 Push 生产流。Compose 观察器在后台继续消费；旋转只移除该消费者及其生命周期监听，不停止生产流。监听器移除通过 `NonCancellable + Dispatchers.Main.immediate` 执行并等待完成，作用域取消后仍满足生命周期注册表的主线程要求。重建的消费者连接同一模型。Host 或模型退休仍关闭所拥有的任务。`stopWatching()` 立即使观察与待消费通知失效，并永久阻止该模型重新启动；`stopWatchingAndAwait()` 还等待流清理。两者均不取消 Host 任务，也不退休进程传输。

模型保留去重后的推送，通过 `takePendingNotifications()` 原子领取尚未消费的条目。消费记录先于平台呈现。重建或并发消费者不能再次领取，同一推送重新转发也不会生成另一条通知。这是最佳努力投递：缺少通知权限或无法呈现时，不排队等待后续重放。退休丢弃未消费的呈现项，迟到帧不能追加到已退休代际。

通知使用固定的本地标题和正文。既有 immutable PendingIntent 打开 `MainActivity`，不携带 Host、Session 或事件目标，不授予导航或审批权限。固定通知 id 使后来的通知替换已显示通知。Push 仅提示用户查看 Host 的权威状态，不含审批按钮，不额外配对，也不建立第二份 Session 事实。这些选择覆盖原规格第 50 节的 Background Push 和 Notification Action 事项，以及第 64 节的恢复状态；不构成完整移动发布验收。

[诊断决定](2026-09-27-android-native-gateway-diagnostics.zh.md)继续拥有本地、标明生产者的计数器及隐私规则。[原生传输决定](2026-09-25-native-remote-connection-source.zh.md)继续拥有签名准入和 TLS 身份。[输入检查点决定](2026-09-26-android-encrypted-input-checkpoints.zh.md)继续拥有草稿和待确认意图持久化。这些仍有独立价值的决定保持有效。

## 考虑过的替代方案

**每次进入后台都停止 Push。** 这会阻止用户切换到其他应用期间接收健康的同进程本地通知。

**每次连接消费者或进入前台都无条件重启。** 这会替换健康流并重试永久失败。若首次观察立即结束，独立的初始启动还会与生命周期补发事件重复。

**通过替换全部模型恢复。** Session 日志、游标及其他保留状态各有所有者，Push 恢复无需使它们退休。

**每次收集都把保留的推送列表作为呈现队列。** StateFlow 会向重建的消费者重放最新值。模型拥有消费记录，可避免旧通知再次显示。

## 后果

完整 Core 运行通过 68 个 suite 中的 427 项测试，没有失败、错误或跳过。十项[前台恢复测试](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/PushForegroundRecoveryTest.kt)覆盖重叠入口、正常及临时终结、永久失败、取消、清理、退休、有效迟到帧和原子消费。[既有投影测试](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/CompanionPushTest.kt)与[连接诊断测试](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/ConnectionDiagnosticsTest.kt)保留各自独立检查。

应用与 instrumentation APK 构建、安装成功。八项安装态用例全部通过：七项[生命周期用例](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativePushObserverLifecycleTest.kt)和既有[通知目标用例](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/PushNotificationTargetTest.kt)。生命周期用例验证立即终结、后台消费、前台恢复、永久失败和重建；目标用例检查实际 immutable PendingIntent，但不点击通知。

[真实 Host 通知场景](../../../../apps/web/tests/android-push-foreground.e2e.ts)的单项用例通过，包含成功的 instrumentation 退出清理。测试拥有的 wire 包装通过私有取消信号结束第一条已签名 `$events` 迭代器，并等待其自然 EOF；物理 mux 保持完整。HOME 和真实 SystemUI 通知点击保留同一进程、Host、模型、Session、完整草稿及待确认 prompt。恢复仅新增一次订阅且没有业务重放；健康返回和旋转不新增订阅，也不重新显示已消费通知。四张完整屏幕截图已逐张检查，覆盖两次系统通知、恢复后的 Session 及旋转，在受测模拟器上未发现布局阻断。恢复后的草稿仍可编辑并保留键盘，旋转后保留待发送失败提示。

场景先显式发送一次 prompt，并通过受控拒绝保留待确认输入；零业务调用断言从该准备步骤之后开始。两次 Host 审批等待由测试代码取消，不能视为 Android 自动取消。通知权限预先授予，因此不验收权限弹窗流程。

逻辑事件流 EOF 不能证明物理断网、mux 重连、Host 重启、FCM/APNs、进程死亡后投递、实际 Recents 入口、精确通知目标或真机后台行为。这些验收限制保持开放。
