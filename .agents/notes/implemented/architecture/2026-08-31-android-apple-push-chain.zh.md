# Agent Note: Android 与 Apple 的最小推送链路

Status: implemented

[English](2026-08-31-android-apple-push-chain.md) | 中文

## 问题

第 70 章为三个时刻排定推送——审批等待、提问等待、任务完成——内容最小化为引用：源码、Prompt、凭据、Diff 内容永不上推送，详情待应用打开后经安全 Remote Link 获取。承载 APNs/FCM 的中继已延后，所以伴侣端既无推送词汇、无链路、也无呈现。

## 决策

最小推送链路骑在今天就存在的线上——`$events` 实时流——词汇形状恰为中继日后承载而设。`CompanionPush` 三个成员只携带引用数据（`ApprovalWaiting`/`QuestionWaiting` 带会话与事件 id，`TaskCompleted` 带会话 id 与轮次）；标题与共享正文行是设备端本地化字符串（`宿主等待审批`/`宿主等待答复`/`任务完成` + `打开应用，经安全连接查看详情。`）。解析器只提取引用字段：`pushFromForward` 读 `$events` 的审批或提问转发、绝不触碰其 `title`/`text`；`pushFromTurnEnd` 只投影 reason 为 `completed` 的 `turn/end`。内容最小化是结构性的——类型上没有承载线缆内容的字段——被禁类别想搭车都不可能。

两侧各在共享流缝上架一个推送视图模型：Kotlin `PushModel`（StateFlow 承载去重后的推送）经 `PushNotifications` 呈现（平台通知渠道、无运行时授权时尽力而为、点按重开应用）；Swift `PushViewModel` 带 `CompanionPushPresenting` 缝，其 `SystemPushPresenter` 构造最小化的 `UNNotificationContent` 交给 UNUserNotificationCenter；`CompanionRootView` 在交互收件箱旁启动监听。流丢失即结束监听——收件箱保留自己的订阅，中继到来时由它承载这些推送。

## 后果

Kotlin 侧 FakeWire 驱动、Swift 侧 FakeWire 加录制 presenter 替身钉住同一条链路：带 `title` 与 `text` 字段的转发产出仅含引用的推送；同一事件的再转发去重；非推送帧与缺会话 id 的帧不投影；本地化通知内容断言最小化的标题与正文。turn/end 解析测试钉住 completed 是/aborted 否/其他标签否。两条车道验证全绿。留给中继阶段：APNs/FCM 投递、后台唤醒、Android 的运行时通知授权流程。

## 考虑过的替代方案

从交互收件箱派生推送被否决——那会把答复面耦到通知面、且 TaskCompleted 无路可走；推送视图模型自有 `$events` 订阅，代价只是一条额外的流。把转发的 `title` 带进通知被否决——审批标题是宿主撰写的 内容，第 70 章把线画在仅引用；设备端本地化词典让载荷天然最小。
