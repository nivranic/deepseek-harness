# Agent Note: 二进制工件输入

Status: implemented

[English](2026-08-31-artifact-binary-input.md) | 中文

## 问题

工件此前端到端都是文本的：`artifact_create` 收必填的 `content` 字符串，通道存其 UTF-8 字节，每个读取方都把字节解回文本。模型生成图像、表格或任何字节载荷时，没有办法把它作为一等工件交给用户——上一条 Note 恰好留下这个洞。

## 决策

创作格式成为日志真理。`artifact/created` 增加必填 `format: 'text' | 'bytes'`——一个持久判别式，之后的每个读取方（模型工具、线端点、原生消费者）都信它而不是猜。`artifact_create` 收 `content`（文本）XOR `data`（base64 字节）；schema 表达不了 XOR，因此 execute 在两者同给与都不给时以稳定文本响亮失败。base64 解码严格：容忍 ASCII 空白（模型会给长编码换行），任何其他非规范输入都被拒绝，而不是被 Node 的宽松解码器静默截断。`artifact_read` 以记录的臂作答——文本按 UTF-16 码元分页进 `content`，字节按字节分页进 base64 `data`——调用会话从未记录的 id 落入 base64 臂，因为没有日志行，创作格式不可知，base64 是无损呈现。线 `session/artifact` 端点按日志格式同样分页，并在 `SessionArtifactValue` 返回 `format`，`LinkArtifactReadValue` 因此增长该字段（连 `LinkArtifactFormat` 枚举再生进 Swift 与 Kotlin），两个原生 `readArtifact` 消费者都解码并透出它。invariant 增加封闭格式集。

## 后果

字节载荷从此一等：生成的 PNG 或 PDF 经与文本相同的日志引用加资源通道拆分旅行，两种都一次工具调用。base64 使 create 参数与字节臂读取的模型可见字节膨胀三分之一——分页让这笔开销可切片。伴侣工件折叠有意不带 format（它只渲染 id 与状态）；一个对字节与文本区别渲染的面板，可以在需要时从读取值取该字段。此面剩余：已存字节的保留策略。

## 考虑过的替代方案

单独的 `artifact_create_binary` 工具被否决——两个生产者名字让 schema 面翻倍，日志仍然需要判别式来给读取方路由；一个带受检 XOR 臂的工具更小。只在读取响应上记录 format（按可解码性推导）被否决——可解码性是启发式，会把合法 UTF-8 的二进制标错，而本仓库信任的权威事件流是日志。接受 Node 宽松 base64 解码器被否决——模型的笔误会静默截断字节，工件渲染坏了却没有失败可指。
