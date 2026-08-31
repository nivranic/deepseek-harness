# Agent Note: 工件读取面

Status: implemented

[English](2026-08-31-artifact-read-surface.md) | 中文

## 问题

工件生产方交付时只能创建：模型能创作工件却读不回来，配对的伴侣只看到引用与状态而没有到达字节的线径。第 56 章的切分同样钉住读取面——日志证明引用，资源通道服务字节。

## 决策

两个对称读取面落在既有通道上。`artifact_read` 是模型可见工具：按引用 id 调 `ctx.artifacts.get`，通道从未存储该 id 时响亮失败（`found no content stored under id "<id>"`），完整内容原样返回，调用会话记录过该工件时从其 `artifact/created` 附带 `kind` 与 `title`——读取不要求归属会话，因为它不改变任何东西。`session/artifact` 是远程线面，镜像 `session/attachment`：配对 observer 发送 `{request: {sessionId, artifactId}}`；授权即日志本身（该会话的日志必须携带此 id 的 `artifact/created`——否则 `ARTIFACT_NOT_REFERENCED`），通道供 base64 字节（引用超出其内容寿命时 `ARTIFACT_CONTENT_MISSING`——响亮，绝不静默空读），响应携带日志元数据。link 契约增长带黄金 fixture 的 `LinkArtifactReadValue`，再生进 Swift 与 Kotlin 模型；两个伴侣对称消费——`RemoteSessionViewModel.readArtifact(_:)` 与 `SessionModel.readArtifact` 按.id 缓存解码字节，与附件读取完全同形，拒答时返回 null。

## 后果

工件生命周期往返闭环：创建记引用、通道存字节，模型（会话内）与配对伴侣（经线）都能读回内容。此面剩余：分页读取（每次读取整内容往返、付出工件体积）、二进制输入、已存字节的保留策略。

## 考虑过的替代方案

经工作区文件通道供读被否决——工件活在 `DSH_HOME` 之下、在包含检查守卫的每个工作区根之外，文件浏览将不得不击穿自己的边界。从通道推导 `kind` 与 `title`（在字节旁存元数据）被否决——日志已持有元数据；存第二份会在回放所示与读取所返之间滋生漂移。线面对缺失内容静默返回 null 被否决——远程面区分"从未引用"与"已引用但内容已逝"，伴侣才能各自诚实渲染。
