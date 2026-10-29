# Agent Note: link 附件面

Status: implemented

[English](2026-08-30-link-attachment-surface.md) | 中文

## 问题

方案第 54 章把"上传附件 / 下载 Artifact"列为远程 Files 首版的一部分。宿主早已拥有两半——prompt 内联 base64 图片块由控制器经 `ctx.attachments` 准入，`session/attachment` 返回持久字节——且两个端点都在 link 允许清单里。但线缆词汇表对图片一无所知：契约表没有附件类型，伴侣折叠把图片块渲染为空文本，Apple 端既发不了也取不到图片。

## 决策

契约表新增五行附件词汇——`LinkImageMediaType`、`LinkImageDimensions`、`LinkImageAttachmentRef`、`LinkAttachmentReadValue`（`session/attachment` 响应）、`LinkPromptImagePart`（内联上传块）——每个都经 `satisfies` fixture 钉住真实的 `dsh-attachment` / `dsh-api-session-controller` 类型，`LinkContentBlock` 增加可选 `attachment` 引用。参考折叠现在把图片块在其文本旁内联渲染为 `图片 名称（mediaType，宽×高）`，Swift 折叠逐字节镜像（整型 double 去掉 `.0` 以匹配 JavaScript 的数字转字符串），新黄金场景 `image-attachment` 通过一致性回放钉住混合文本/图片消息。`RemoteSessionViewModel` 增加两个消费半边：`send(text:images:)` 用内联 `CompanionImageUpload` 部件构造 prompt 内容数组；`readAttachment(_:)` 以会话动词的 `{request:{…}}` 信封调用 `session/attachment`，解码生成值并按附件 id 缓存 `Data` 字节。

## 后果

已配对的伴侣现在可以随 prompt 提交照片并取回折叠日志引用的任何图片，全程走既有端点与角色——上传走 `session/prompt`（controller），下载走 `session/attachment`（observer），允许清单零变更。内联摘要刻意隐藏不透明的附件 id；结构化图片面（从折叠点按渲染）需要折叠携带引用，待产品要渲染而非点名时再落地。Swift 在本机仍是已编写未编译（既有 macOS 车道告解）。

## 考虑过的替代方案

独立上传端点被否决——prompt 附带准入已原子地校验、规范化并持久化，第二条路径会复制准入策略。经 `workspaceFiles` 暴露附件字节被否决——附件活在内容寻址存储而非工作区树中，`session/attachment` 已按会话日志授权读取。
