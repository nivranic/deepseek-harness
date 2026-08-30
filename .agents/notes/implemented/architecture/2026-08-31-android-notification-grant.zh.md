# Agent Note: Android 运行时通知授权

Status: implemented

[English](2026-08-31-android-notification-grant.md) | 中文

## 问题

第 70 章推送链路只是尽力呈现：Android 13+ 上 POST_NOTIFICATIONS 是运行时授权，不主动请求的话系统会静默丢弃链路发出的每条通知。中继阶段的 Android 侧——授权流程——是推送路径上唯一在真机上无法工作的一块。

## 决策

授权逻辑拆成 core 的纯投影与 app 的 Activity 绑定流。`NotificationGrantState` 携带系统启用读数、本进程是否已问、用户末次回答：呈现随系统启用走，缺授权时一进程一问——拒绝在本进程内保持，恢复路径是用户在系统设置里改授权、由刷新时的启用读数观察。app 侧 `NotificationGrantController` 以 StateFlow 持有投影、记录系统对话框回答并重读启用；`CompanionApp` 在配对完成后刷新投影，`shouldRequest` 为真时经 `RequestPermission` 契约发起一次请求。`PushNotifications` 暴露控制器与自身呈现守卫共享的启用读数（`notificationsEnabled`）。

后台唤醒与 APNs/FCM 投递仍随中继延后；本增量只是授权侧。

## 后果

`NotificationGrantTest` 钉住投影：启用的系统无需询问即可呈现；缺失的授权一进程恰问一次（新状态会请求、记录过的拒绝不会）；授予的回答翻转系统读数并呈现。Android 车道验证全绿。授权侧就位后，中继阶段剩余的 Android 工作是投递（APNs/FCM）与后台唤醒。

## 考虑过的替代方案

首次推送到达时才请求被否决——询问会打断在意料之外的时刻，而配对完成正是"这个应用将与你对话"的自然时机。每次拒绝后反复请求被否决——Android 13+ 会自动拒绝重复请求，投影诚实地建模为一问，把设置读数当恢复信号而不是纠缠。
