---
description: "Host 与 Client 会话控制：创建、恢复、提示、跟随历史并投影实时会话状态。"
kind: "package-reference"
---
# Session Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-session-controller` 拥有 Host 的 `ctx.sessionController` 服务，以及生成的 Client `session`、`skills` 和 `fileReferences` Remote namespace。它提供 Session 生命周期与历史、Host generation 模型目录、用户可调用 skill（技能）发现和 Agent（智能体）范围的文件引用。当 Client 需要按 Session 寻址的操作时，请通过 API Gateway 使用它。

## 目录

- [使用本包](#use-this-package)
- [会话媒体引用](#session-media-references)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

文件引用适配器声明 `file-reference.list.v1`，技能目录声明 `skill.catalog.v1`。这些操作集独立描述发现 API，与文件查看器、会话候选及技能调用分开。实际挂载的提供者与权限检查仍决定操作结果。

-----

<a id="use-this-package"></a>
## 使用本包

fork 的子会话标题更新失败时，原样拒绝 rename 的 `RemoteError`；已发布的子会话仍可访问。

独立的 `session.search.v1` 和 `session.attachment.v1` 能力分别准入内容搜索和持久化图片读取。API Gateway 在传输前拒绝未公布的操作，并随所属 Connection 代际取消待完成读取。附件授权仍要求被寻址 Session 日志中存在对应引用。

Client 子级目录要求 `subagent.catalog.v1`。Connection 代际撤销清除目录内容、打开菜单、待完成刷新归属和父级可用提示，同时保留持久地址及已选择的驻留 Session。迟到目录回执不能发布数据或移除替换请求。子级寻址 prompt 与 interrupt 回执也保留起始 Host 归属，替换后不能发布旧错误或确认状态。

`session.rename-at.v1` 暴露 `renameAt(SessionRenameAtRequest)`，字段为 `sessionId`、原始 `title` 和 `expectedRevision`（标题事件序号或 null）。标题服务以 `session/revision-conflict` 拒绝已变化的编辑基线；若规范化后的标题与当前用户固定标题相同，则返回原有接受结果。`ISession.prepareRename()` 在编辑前捕获版本，并在重试时保留；缺少投影数据时不发送请求，直接失败。不支持此能力的 Host 和直接 `rename()` 调用保留无条件重命名语义。这提供条件变更安全性，不是持久化的变更 ID 回执账本。

Client 控制流在打开前等待已准入且声明 `session.control.v1` 的 Host；事件 journal 同样要求 `session.follow.v1`。Journal 重连期间保留已发布历史，直到具备该能力的连接代次提供替换快照。能力缺失时保持等待，直到具备该能力的连接代次到来；销毁会取消等待并释放观察订阅。Host 能力声明和 Client 操作准入共同使用 `./capabilities` 声明。

历史页与 follow opening 快照为每个持久 Session 事件携带一条 `{ type: 'event', event: SessionWireEvent }` record。Client 把每条已接受 record 保留为一个持久 `SessionEventLikeEntry`；Assistant token 边界保留在 `assistant/message` 或 `assistant/attempt` 的紧凑流内。工具参数、结果内容、失败信息和 `tool/result.data.meta` 原样通过；控制器不解析工具定义、不运行展示转换器，也不附加 UI 数据。

此 owner 声明 `session.follow.v1`（跟随与分页）、`session.control.v1`（控制、prompt、队列更新与取消）、`session.manage.v1`（列举、创建、重命名与 fork）和 `model.select.v1`（目录与选择）。[Host 发现](../host-description/README.zh.md)在其 Remote 定义可用时报告这些操作集合；能力存在不代表变更操作可安全重试。

额外的 `session.cancel-turn.v1` 能力提供 `cancelTurn({ sessionId, turnStartSeq })`。只有 `turnStartSeq` 等于当前 `activeTurnStart` 投影时，Host 才请求取消；过时目标或显式 null 返回接受结果且不执行操作。Client 每次点击捕获目标，投影尚未到达时报告不可用状态而不作推断。未声明该能力的 Host 使用旧的当前活动 `cancel` 操作，后者不承诺迟到重试安全。两种操作都不恢复冷 Agent，按目标取消保留待处理 inbox。

对于可继续子级，`subagent.interrupt-turn.v1` 选择 `subagents.interruptTurnByParent`。Client 每次点击捕获 `subagentTiming.active.startSeq`，已知空闲投影则使用 null。Timing 缺失或活动目标缺失时在派发前失败；对声明按目标中断的 Host，不能退回范围更宽的操作。没有该能力的 Host 使用旧的父级寻址中断。父级权限和目标匹配仍由 Host 负责。

Client journal 在发布 follow 快照、live entry 或历史页之前验证精确的 V3 事件 envelope。它复用浏览器安全的 Session validator，检查必需的 surface marker、精确的 replacement endpoint、更早且唯一的 source seq、内嵌 Assistant 来源、request header 可选字段的省略规则以及工具错误一致性。无效 record 直接失败，不删除字段或归一化；范围成员与来源存在性仍由 Host 的持久日志检查。

每个 endpoint 都声明自己的激活策略。列表只读取持久化 header 与 projection cache row，绝不调用逐 Session stat 或打开冷 Session body。当前格式 cache identity 可以提供全部列表 hint；生命周期匹配的 predecessor cache 只能提供版本兼容的 title，作为可能过时的展示事实，绝不能作为权威 fold seed。搜索、附件、历史页、日志跟随和 skill 发现可以在不激活 Agent 的情况下检查 persistence。queue 变更与取消要求 live 状态；模型、重命名、prompt 和文件引用操作可以解析或恢复普通 Session。提示词会在解析 Agent 或追加 Session 事件前，拒绝既没有非空白文本也没有附件的 content；queue edit 只接受非空文本 content。prompt 准入从注入的 [`fileUploads`](../../client/file-upload/README.zh.md) Host 服务取得不透明凭证，在把完整有序内容列表交给 `ctx.attachments` 前解析每个属于同一 Agent 的凭证。Prompt 重试复用其 `requestId` 首次被接受的结果，不会再次插入消息。持久化 inbox 插入记录在消息被领取或移除后仍保留接受凭据，包括尚未记录 `user/message` 的间隔。异步附件处理结束后，准入会在插入前立即重新检查；未发生插入的失败仍可重试。复用已接受的身份不会提交替换内容。只有 create 与 fork 会直接创建新 Agent。该服务把同一套感知 preset 的恢复策略和 subagent ownership fence 同时用于自身方法，以及其他 Remote namespace 使用的 Typert Agent 与 Session lookup。Queue 变更只有一个狭窄例外：当前 projection identity 为 continuable 且来自自身非 seed suffix 的在线 child，可以在两个 inbox 目标上使用普通 Edit、Remove 与 QueueDock Steer action。One-shot、缺失、未知、损坏、仅含 seed identity 或冷 child 继续被拒绝，且不会恢复。skill 目录优先使用已有 live Agent，否则使用所记录 preset 的常驻 scope，因此列表查询绝不会启动 Agent。[声明文件服务](../../client/ui-deliverables/README.zh.md) 在授权并解析日志记录的文件后，调用 Host 本地的 `workspaceDesktop()` 和 `openWorkspacePath()`。这些辅助方法不属于 Session Remote 命名空间。本地的 `action: "reveal"` 选择文件管理器导航；省略时打开默认应用。

Client 适配器提供 `SessionEventStream`，即绑定到一个普通 Session 或 direct subagent address 的 Gateway `RemoteJournalStream`。它在读取首个 page 前打开 follow，只发布连续的 `replace`、`prepend`、`append` 与 `settle-assistant` 变更，并通过 tail page 修复重连或 seq 缺口。向后分页有两个动词：`loadOlder()` 拉一页 50 条消息，而 `loadThrough(seq)`——轮次跳转加载器——按每页 200 条消息循环拉取直到窗口覆盖目标 seq，重复调用会下调共享目标，遇到无进展的页即停止，忙碌状态复用同一个 `loadingOlder` 快照位。Web 适配器显式选择接收无 cursor 的 Assistant frame：每个 opening 携带活跃 attempt 的 `startedAfterSeq`、`nextIndex` 与紧凑 stream，每个 stream member 都成为排在持久 cursor 之间的 Client-only `assistant/live-chunk` 条目。Host 会随该 baseline 捕获 follower 本地到达序号，并抑制该 cut 及之前的 buffered frame；replacement Agent 可以从 revision 一重新开始。活跃 opening 之后到达的持久 `assistant/message` 或 `assistant/attempt` 只有在其 seq 晚于 `startedAfterSeq` 且轮次与步骤匹配时才会保持暂存；匹配的 end type、seq 与 index 会发布一个具名 settlement delta，删除该 attempt 的瞬态 row、加入持久条目，并保留同一步骤中更早的 retry。已知 attempt 的 revision、密集 index 或 settlement 缺口会重新打开 follow；若 controller 错过 start，则忽略 unknown-attempt frame，并正常发布其持久 settlement。Abandoned end 会发布不含持久条目的 settlement delta，使瞬态 row 立即退出。持久缺口修复 page 不携带 Assistant baseline，因此 held notification 会重新打开 follow 一次，以取得配对的 page 与 baseline。每条历史 record 只覆盖自身的事件 seq。业务、persistence 或无法恢复的连续性错误会终止 stream，只有物理载体断开才触发自动恢复。`SessionControlStream` 是 Gateway `RemoteSnapshotStream`；每代都以完整的进程本地 baseline 开始，因此重连会替换 queue、jobs 和 projection 状态，而不会把瞬态值当作持久事件。每次 inbox 变更时，Host 会先发布 projection frame，再从同一份已校验的折叠后值派生 queue replacement，因此监听器注册顺序不会产生陈旧的 queue frame。Client Agent 上下文提供独立 [`fileUpload`](../../client/file-upload/README.zh.md) 服务使用的身份；Session 对象提供生命周期、prompt、queue 与历史操作，不提供文件传输。

Session 对象还承载本地提交回显：`session.beginSubmission` 在调用方序列化与提示词之前，同步把一条回显写入 `SessionSnapshot.pendingSubmissions`，会话 UI 因此能在点击提交的当帧显示消息。回显按顺序存放图片预览与持久文件引用。Session 根据当前运行状态与请求的投递模式推导其 `transcript`、`queued` 或 `steering` 位置，并在序列化期间保留该位置。提示词的 `requestId` 是关联标识：Host 把它回显为 durable user source 的 `rpcId`，queue occurrence 也把它投影为 `SessionQueuedItem.rpcId`。回显在观察到其 durable event 或 queue occurrence 后延迟一个动画帧退休，带标识的提示词失败或被放弃时立即退休，销毁时按 failed 退休。每次退休恰好触发一次 `onRetire`；observed 退休还会携带有序的持久附件引用，让 composer 释放成功卡片并保留失败草稿。回显只存在于 Client 内存；刷新与重连只从持久事件重建会话。


面向用户调用的 `skills/list` 元数据包含胜出提供方可选的指令文件 `path`。输入框可据此预览文件，无需加载每个 skill 的正文或激活冷态 Agent。

<a id="session-media-references"></a>
## 会话媒体引用

当 `connection`、`fs` 与 `attachments` 均被组合时，`SessionMediaReferences` 在鉴权 `connection.fetch` 通道上挂载 `GET|HEAD /api/file?path=<绝对路径>`。它通过 `ctx.fs` 读取普通文件，包括已注册工作区之外的临时路径与远程提供方中的文件。目录包含关系与 MIME 类别均不限制访问；`mime-types` 提供响应类型，未知扩展名使用 `application/octet-stream`。GET 复用 `readBytes` 执行读取前及读取中的字节限制；HEAD 只读取元数据。所有文件均使用 `ctx.attachments.imageLimits.maxImageBytes`（通常为 20 MiB）；超过此上限返回 413。响应包含完整文件，忽略 Range，并携带 `private, no-store`、`nosniff` 与沙箱 CSP，使直接打开的 HTML/SVG 无法以 API 源身份执行脚本。客户端重写位于 `ui-chat`（`AssistantMarkdown`）；音视频文件响应已可用，Markdown 音视频播放器节点仍是独立工作。

-----

<a id="configuration"></a>
## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `nativeOpen` | 平台探测 | 是否能把 Session 工作区路径交给原生桌面打开器 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-api-session-controller)是所有受支持字段及其 JSDoc 的完整来源。

-----

<a id="model-experience"></a>
## 模型体验

无；任何模型可见效果都由被调用的 Agent 命令负责。

#### KV Cache 影响

无直接影响；模型请求仍由 Agent 和 LLM（大语言模型）包拥有。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 图片字节上限不校验解码后的尺寸或像素数。
- Control baseline 表示进程本地状态，因此 Host 重启后无法重建 jobs。
- follow 恢复失败会对调用方可见，而不会无限重试。
- 浏览器原始字节上传使用一次不带断点续传偏移的流式 HTTP 请求；重试会从第零字节重新传输整个文件。
- 文件引用补全使用共享 Agent lookup，因此可能恢复冷 Session；`skills/list` 目录是不激活 Agent 的 skill 元数据读取路径。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。每个分页与帧都会对照其指向的持久 Session 校验。
