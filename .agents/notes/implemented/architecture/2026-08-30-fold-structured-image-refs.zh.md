# Agent Note: 伴侣折叠层的结构化图片引用

Status: implemented

[English](2026-08-30-fold-structured-image-refs.md) | 中文

## 问题

附件面落地时折叠层只把图片块渲染为内联摘要文本——不透明的附件 id 从未进入伴侣状态，于是无处安放"点按加载"：视图模型的 `readAttachment` 有了，却没有可寻址的对象去调用它。

## 决策

`CompanionDomainState` 增加 `images`：按首次出现排序、按附件 id 去重的 `CompanionImageRef { attachmentId, mediaType, width, height, name? }` 列表，在折叠时收集。两个折叠层遍历同样三个携带内容的事件——`user/message`、`assistant/message`、`tool/result`——像文本投影一样嵌套穿过 tool-result 内容，Swift 镜像 TS 参考（空名规范化为 nil，与 TS 展开省略键的方式一致）。黄金场景 `image-attachment` 的期望状态现在钉住收集到的列表，一致性回放据此约束两种语言。`RemoteSessionViewModel` 投影该列表，`SessionView` 渲染 `AttachmentCard` 横向条：缓存字节按构建平台解码为图片（UIKit/AppKit），否则卡片点名引用并以"载入"走 `readAttachment`。

## 后果

折叠层对每张图片同时携带人类摘要（内联文本）与机器地址（结构化引用）；图片条是第一个渲染宿主字节的伴侣界面。收集是追加为主且幂等——重放与重连后的再订阅不会产生重复行。含大量图片的会话在状态里持有完整列表，其上限即会话自身的图片数。

## 考虑过的替代方案

折叠时急切读取字节被否决——折叠层对引用保持纯；取数是用户意图动作。按时间线条目组织图片条被否决——首次出现顺序加 id 去重才符合会话里图片被引用的真实方式。
