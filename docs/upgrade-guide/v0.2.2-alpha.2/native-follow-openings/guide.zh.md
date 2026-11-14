---
kind: upgrade-guide
description: "原生 Session follow 请求使用完整 opening 快照，取代 wire 续传游标。"
---

# 原生 follow 请求使用完整 opening

[English](guide.md) | 中文

## 变更

`session/follow` 接收 Session 地址与可选窗口参数，不包含 `fromSeq`。每条新流以完整的有界快照开始。Kotlin 与 Swift 的 `NativeFollowResume.request` 现在只接收地址和分页大小，`withResumeCursor` 已移除。

Android 日志在本地保存最后序号，用来校验与保留记录的重叠。一致的重叠保留已加载的较早历史，缺口则使权威 opening 替换窗口。矛盾会明确报错，不发布部分合并结果。加密历史在本次变更后仍可读取。

## 迁移

1. 从 follow 请求中移除 `fromSeq`，并从 `NativeFollowResume.request` 调用中移除游标参数。游标仅与对应记录一起保留，用于本地协调。
2. 每次重连都接受完整 opening 快照。保留较早前缀前先比对重叠记录；替换未覆盖历史，遇到矛盾时停止。
3. 子代理地址的 `mode` 使用 `one-shot`、`continuable` 或 `unknown`，不接受 `timeline`。
4. 运行共享 Kotlin/Swift 请求夹具和 Host 原生 follow 契约场景。在获准的安装环境中验证进程重启与载体断开场景，再声称设备验收通过。
