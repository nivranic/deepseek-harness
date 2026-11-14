# Agent Note: Lite 回合在自己的工具输出上继续

Status: implemented

[English](2026-10-21-in-turn-tool-round-continuation.md) | 中文

## 问题

gen-63 收口了跨回合回喂半环，但一个回合仍在它的流结束那一刻终结：`finish_reason` 根本不在 Lite 词汇里——行解析器只读 `choices[0].delta`，携带 `finish_reason` 的终结 chunk（delta 为空或缺席）被整段丢弃——而 `drive()` 在 `collect` 后无条件落 `message/completed` + `turn/completed`。调用 `calculator` 的模型要等用户再发一条消息才能看到结果并继续；每条工具链每一跳都花一次手动提示。

## 决策

在回合内闭合循环。`LiteStreamChunk` 增 `Finish(reason: String?)`；行解析器在 delta 要求丢弃 piece 之前读 `choices[0].finish_reason`，provider 在 `[DONE]` 之后、组装工具调用冲刷之后 emit 捕获的 reason——宿主 `translate.ts` 的延迟 finish 形态，从未声明 reason 的 wire 以 `Finish(null)` 收尾绝不猜测，`STREAM_CLOSED` 截断守卫原样。`drive()` 以轮循环替换无条件终点：每个以 `finish === "tool_calls"` 结束且无 handoff 的轮落下自己的 `message/completed`（纯工具轮保留空 assistant 行——宿主对 assistant 消息的绝不丢弃投影）、记录自己的工具行边界、携带现已含活回合已完成轮次的 history 再次请求；非 `tool_calls` 结束或 `MAX_LITE_ROUNDS_PER_TURN = 8` 次请求以 fail-soft 收束回合——最后一轮的 assistant 行与终结事件照常落、事件流绝不截断。上限是固定循环安全不变量（典型链三请求内收敛、八给两倍余量），不是部署调参。history 领域形态围绕轮重塑：`LiteTurnRecord(userText, rounds)`，每个 `LiteTurnRound` 是一次模型响应——回复文本、工具调用、逐 id 结果——导出经逐轮工具行游标切分回合与轮，`wireMessages()` 按宿主序列化器的交错序逐轮重放（工具轮=一条携调用的 assistant 行加按调用序逐 id 一条 `role:"tool"` 行；文本轮=一条纯 assistant 行；两者皆无的轮不上 wire，对齐宿主空 assistant 投影规则）。新 `multi-round-tool-turn.json` conformance fixture 钉 fold 形状——一个回合的 conversation 两条 assistant 行——`LiteFold.kt` 与 `LiteChat.kt` 零改动：journal 记账保持每回合恰一个结局事件，chapter 64 原样。

## 备选方案

无测试 seam 而复用按 prompt 键控的 script 通道做 follow-up 被拒——同回合续请求共享 prompt，故 scripted provider 增可选 `followUps` 列表（默认保持旧行为）纯粹为逐轮断言的诚实。上限按已执行工具调用数而非模型请求数计被拒：请求是计量端点上的成本单位，请求界是更紧的不变量。把零轮活回合携带进续请求 history 被拒——那会重复 prompt 行（请求本身已携带），导出保留旧的首轮丢弃语义。上限升格为 `Config` 字段被拒：它是防失控循环的安全不变量，不是随部署变化的选择。

## 后果

Lite 会话现在端到端跑真工具链：模型调用工具、看到结果、在同一回合内继续——至多八次请求——wire 形态逐字段对齐宿主序列化器的交错行。重启仍丢工具上下文（chapter 64 忠实——已记录代价）。`role:"tool"` 交错续请求行在 JVM 测试中对内嵌 HTTP 服务器验证，含 driver 跨真 provider 两请求集成；多轮请求形状的真模型接受度仍属 e2e 域。core JVM 测试：572 -> 579。

## 开放跟进

工具行 journal 持久化（chapter-64 决策，本代未动）；余三执行器（`url_fetch` 携端点策略——§54 经测量不阻塞、`image_inspect`/`attachment_read` 无 intake 生产者）；配对宿主目录拉取的真宿主 e2e；目录热刷新 UI 仍自 gen-64 台账开放。
