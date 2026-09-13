# Agent Note: 隐私安全的会话遥测

Status: implemented

[English](2026-09-02-privacy-safe-session-telemetry.md) | 中文

## 问题

共享 base 在缺少 `DSH_TELEMETRY_MODE` 时选择 `FEEDBACK_ONLY`，因此记录 `/feedback` 会在部署方未预先选择的情况下构造外发传输。捕获协调器还会复制完整 Session 事件载荷与 `session.cwd`；没有规则的导出可能因此包含提示词、推理、系统提示词、工具 schema、工具参数与结果、反馈文本、错误消息、源代码与文件内容，以及本地路径。确认文本只会在反馈事件已触发释放之后才披露该行为。

## 决定

共享 base 与提供方直接构造都默认 `DISABLED`。只有显式 `DSH_TELEMETRY_MODE=FULL` 或 `FEEDBACK_ONLY` 才会构造 OTLP 导出器；任何非空 `DSH_TELEMETRY_DISABLED` 仍是加载前的强制退出开关。部署方仍可显式选择 `FEEDBACK_ONLY` 以按反馈触发前缀；仅记录反馈不再是随附默认授权机制。

Service Definition 会在 `session-telemetry/record` waterfall（瀑布式事件）之前应用强制隐私投影。seam 记录不携带 body 值，只包含[子系统隐私清单](../../../../docs/subsystems/session-telemetry.zh.md#privacy-inventory)中的有界诊断字段；OTLP JSON 编码器可能把无内容 body 表示为 `{}`。模型产生的工具名与任意错误名／代码均不外发；错误报告使用固定的内置类别词汇，并以 `CustomError` 兜底。未知插件事件只暴露记录时间、假名化 Session 身份、事件类型与序号。waterfall 收到已冻结且 Session id 已假名化的记录；返回后，协调器只保留键和值均未改变的原始属性，因此监听器可以删除字段或选择固定 severity，但不能新增、改写或别名复制外发数据。

`ctx.sessionTelemetry` 只暴露 `sharing` 披露。每个 Service Provider 都向协调器提供私有 `SessionTelemetrySink`，因此其他插件不能注入任意外发记录，也不能驱动提供方关闭。匿名 identity owner 持久化一个私有 256-bit 根种子，并在不同 HMAC 域下派生公开用户身份与 Session 假名。POSIX 读取要求当前用户所有且 group／other 均无权限。首次创建会以禁止替换的方式发布已完整写入的同目录 inode；读取会比较打开前、文件描述符与打开后的身份。轮换会发布或采用一个完整私有的禁止替换 claim，确认当前目标，再以原子方式把共享 claim 移至其路径，因此相互配合的进程使用同一种子，中断的进程也会留下可恢复 claim。暴露或超限的普通根种子文件会在不读取内容的情况下轮换；检查会在发布前拒绝不安全或已经变化的路径。Node 没有按 device 与 inode 执行的跨平台 compare-and-replace 操作，所以能写 harness home 的进程可以在最终检查与 rename 之间替换目录项。rename 不会跟随符号链接或写入其目标，但可以替换该目录项，因此自定义 home 必须由运维方保护。Windows 新文件继承 harness home DACL，因为 Node.js mode bit 无法验证该 ACL。协调器在捕获前解析该身份，并在任何可扩展回调前对 Session 与父 Session id 做假名化；根种子与 Session 密钥绝不会离开 identity 包。OTel 提供方只把派生的公开用户 id、产品版本、平台与架构作为 Resource 属性；两个静态 instrumentation scope 都携带包版本，并把每条 SDK 日志记录绑定到 `ROOT_CONTEXT`，使环境中的活动 span 无法添加 trace 关联。

## 考虑过的替代方案

**保留按反馈门控的随附默认值，并改善确认文本。** 否决，因为事件后的披露无法授权已经开始的释放，而且自由文本反馈动作即使面对有界诊断字段也不构成部署授权。

**保留原始记录，并要求每个部署方挂载脱敏监听器。** 否决，因为遗漏或不完整的监听器会在可信边界上 fail-open。数据最小化归捕获 owner，且必须在没有部署扩展时成立。

**显式 opt-in 后允许 `FULL` 绕过隐私投影。** 否决，因为环境配置只授权遥测传输，不授权无限制的源代码、提示词、工具输出内嵌凭据或 workspace 路径。未来的载荷共享功能必须定义自己的显式数据类别与授权。

**哈希或加密完整载荷。** 否决，因为可逆加密仍会导出敏感载荷，而不透明哈希比结构化事件元数据更缺少诊断价值，却仍保留关联风险。

## 后果

全新 profile 不发出遥测网络请求。显式上传模式保留版本／平台关联、假名化 Session 时间线、固定事件结果、固定错误类别与生命周期信号，同时在结构上消除敏感载荷泄漏。接收方不再获得工具名、错误代码、自由文本反馈或 transcript 重建能力；需要时，用户通过单独授权的支持渠道发送这些内容。单元测试与真实 Loader 测试断言：提示词、推理、系统提示词、工具名／参数／结果、反馈、错误名／代码／消息、源代码／文件内容、workspace 路径、原始 Session id、私有 identity 材料以及环境 trace／span id 绝不会出现在捕获的 OTLP JSON 中，而权威 Session 日志保留原始内容。
