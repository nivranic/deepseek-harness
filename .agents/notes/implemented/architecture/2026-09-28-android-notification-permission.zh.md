# Agent Note: Android 通知权限由应用进程拥有

Status: implemented

[English](2026-09-28-android-notification-permission.md) | 中文

## 问题

由 Compose 实例保存的通知请求历史会在旋转时丢失。只在回答后记录请求，还会让重叠的前台入口在系统弹窗仍打开时再次请求。保留的回答也无法反映用户在应用之外修改的通知设置。

## 决策

`CompanionApplication.notificationGrant` 为进程延迟创建并持有唯一的 `NotificationGrantController`。控制器仅保留应用上下文用于系统查询；Activity、Host 模型和 Session 均不拥有或重置其历史。通知权限可以在配对前请求，保留既有首次入口行为。获准的请求是否显示系统弹窗，由 Android 决定。

控制器通过同一把锁串行执行 `refresh()`、`claimRequest()` 和 `onUserAnswer()`。`claimRequest()` 仅接受系统尚未允许且进程请求预算未使用的情况，并在调用 launcher 前记录 `requested=true`。重复或重叠的领取不能启动第二次自动请求，包括首次回调尚未返回时。启动失败不退还预算。状态仅存在内存中，新进程获得新的预算。

`systemEnabled` 记录最近一次 `NotificationManager.areNotificationsEnabled()` 的结果。刷新保留 `requested` 和 `lastAnswer`。权限回调记录回答并重新读取系统：肯定回答不能覆盖系统关闭状态，历史拒绝也不能覆盖后来授予的系统权限。`lastAnswer` 是历史，不是权限权威。该应用级开关不描述每个通知频道、Host 权限或传输健康；呈现时仍再次检查 Android。

## 生命周期与设置入口

`NativeNotificationGrantObserver` 仅通过生命周期 `ON_START` 先刷新、再领取请求。添加到已经启动的 Activity 时会补发该事件，完成首次准入，不再单独初始调用。Host 配对状态不是前提，也不作为 effect key。Activity result launcher 在稳定的 composition 位置保持注册，回调始终指向同一个 Application 控制器。监听移除通过 `NonCancellable + Dispatchers.Main.immediate` 执行并等待完成，包括观察作用域已经取消时。

通知关闭时，未配对和已配对界面均以紧凑一行显示 **应用通知已关闭** 与 **打开通知设置**。按钮发送 `Settings.ACTION_APP_NOTIFICATION_SETTINGS`，并在 `Settings.EXTRA_APP_PACKAGE` 中指定当前应用包名。它不直接修改权限，也不请求新的 Host 授权。经系统生命周期返回时刷新投影；测试不能通过主动调用 `refresh()` 代替真实返回。

找不到权限 Activity 时显示固定请求失败提示；找不到通知设置或设置入口被拒绝时显示固定设置失败提示。这些提示属于 composition，重建后可以消失，但进程拥有的 `requested` 标志不会回滚。关闭状态与显式设置入口仍可使用。异常消息不进入普通 UI 文案，也不增加持久拒绝偏好。

[Push 前台决定](2026-09-28-android-push-foreground.zh.md)继续拥有观察恢复、退休及模型内通知消费。授予权限本身不重启生产流，也不重放已消费条目。健康观察及既有 Session/输入所有者保持不变；Android 通知权限不授予 Gateway 或审批权限。既有 Push 记录中预授权限的测试仍只证明其原范围，不能充当系统权限弹窗证据。

## 考虑过的替代方案

**把请求历史留在 composition 或 Host ViewModel 中。** composition 随旋转重建，Host 模型随配对和选择变化退休，两者生命周期均不匹配应用权限请求预算。

**仅在回调返回时标记 requested。** 异步回答前可能到达另一生命周期入口，结果也可能同步返回。先领取再启动可以覆盖两种顺序。

**把上次回答作为当前设置，或只在配对变化后刷新。** 系统设置可以在拒绝之后授予权限，而 Host 没有变化。前台系统读取可以观察到该变化。

**持久化拒绝历史或自动重试启动失败。** 这些选择会增加跨进程策略或重复提示。本实现保留每进程最多一次的既有约束，并通过显式设置恢复。

## 后果

应用与 instrumentation APK 构建通过。完整安装态运行通过 18 项用例，runner 成功退出：五项[控制器用例](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NotificationGrantControllerNativeTest.kt)、五项[权限生命周期用例](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NotificationPermissionLifecycleTest.kt)，以及八项既有 Push 回归。控制器用例验证同步准入、系统权威和历史保留。生命周期覆盖包含三项真实弹窗用例与两项受控观察器用例：Allow、Deny、弹窗期间及之后的重建、重叠观察器、清理，以及请求和设置启动失败。真实权限弹窗打开期间重建 Activity，回答仍送达同一个 Application 控制器。HOME 后通过显式启动 `MainActivity` 返回，不涉及 launcher UI 或 Recents 操作。真实权限用例使用独立 instrumentation 进程和隔离应用权限基线，不使用 `GrantPermissionRule` 或生产状态重置后门。Core 源码未变，其先前测试基线未在本增量重跑。

最终[真实 Host 权限场景](../../../../apps/web/tests/android-notification-permission.e2e.ts)的单项用例通过，包含成功的 instrumentation 清理。其显式 runtime 权限驱动模式省略预授，既有调用者保留默认行为。活跃 instrumentation 始终拥有 Deny、应用设置按钮、实际应用级通知总开关及 Back 的系统 UI 操作。真实设置返回后，观察到同一 PID 和 Application 控制器。同时使用外部 UIAutomator owner 会破坏该控制路径，因此不采用。

场景在零业务调用区间前，准备一次显式拒绝的 prompt 和不同的新草稿。Host 通知 A 在 Settings 位于前台、应用位于后台且权限被拒绝时到达，消费后没有系统通知。授予权限、经 Back 返回及旋转均不重放 A。新的 B 产生真实系统通知，点击后返回应用。当前 Host/Session/模型所有者、完整新草稿与不同的待确认意图、健康订阅计数和设备授权均保持不变。测试代码取消并等待两次 Host 审批请求结束，Android 不会自动回答或取消它们。六张完整屏幕截图记录首次权限弹窗、旋转后的拒绝状态、关闭及开启的系统设置、新 Host 通知，以及返回后的 Session。

默认预授模式的回归通过四文件、五用例：[Push 前台](../../../../apps/web/tests/android-push-foreground.e2e.ts)、[VIEW 深链接](../../../../apps/web/tests/android-view-deep-links.e2e.ts)、[游标续传](../../../../apps/web/tests/android-cursor-resume.e2e.ts)及[输入持久化](../../../../apps/web/tests/android-input-persistence.e2e.ts)。它们与最终权限用例分开，也不关闭另行保留的间歇 cursor 调查。

通知设置变化可能终止应用。进程或 driver 丢失是独立结果，不能通过启动 MAIN 或另一 instrumentation 会话后宣称设置返回成功。新进程不保留控制器身份、拒绝历史或 Push 模型的消费游标。频道级禁用、撤权杀进程恢复、真机、FCM/APNs，以及进程死亡后的权限或通知投递仍保持开放。本决定覆盖原规格第 50 和 64 节的通知及权限状态事项，不构成 Mobile Release 或任一整节完成。
