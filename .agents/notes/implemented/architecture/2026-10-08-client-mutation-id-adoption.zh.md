# Agent Note: fork 与 command execute 采纳 clientMutationId 收据

Status: implemented

[English](2026-10-08-client-mutation-id-adoption.md) | 中文

## 问题

第 17 节要求状态变更请求携带 `clientMutationId`，使 Host 能识别网络重试后的重发请求。mutation-idempotency-lanes 测绘发现 27 条写通道：25 条经五种既有机制结算，而 session fork 与 command execute 每次调用铸造新身份，重试会完整重跑命令——第二个独立子会话、第二次 handler 执行与第二对 command 事件。该测绘把采纳语义记为开放设计裁定，并用直接测试钉死当时行为。

## 决策

两车道采纳该裁定：可选的客户端铸造身份+Host 进程内收据登记。`SessionForkRequest` 增加 `clientMutationId?: ClientMutationId`，`commands.execute` 在新的 `CommandExecutionRequest` 请求对象上携带同名字段（`(agent, request, signal)`——session-controller 全体 `@Remote` 方法既有的请求对象形态，也是 typert 分析器「取消信号必须末位」规则所要求的形态）。身份为品牌类型，在 wire 边界校验（非空、无首尾空白、至多 128 字符；fork 报 `gateway/bad-request`、execute 抛 `TypeError`，各随其包的边界惯例），并在任何副作用之前查询：同一 Host 进程内已结算身份的重发原样返回首次结算——同一个子 `SessionForkValue`（不再观察 source、不再建会话）、同一个 `CommandExecution`（保留原 commandId 与 result，不重入 handler、不追加生命周期事件）。收据登记 FIFO 有界 1024 条；被驱逐的身份按新请求重跑。fork 仅在子会话完整创建且 workspace 挂接后记录；execute 仅在已结算结果路径记录——准入错误是已结算的执行、会记录，而抛错的 handler 与未解析语法不记录，失败的可变更因此保持可重试。

## 备选方案

耐久（重启存活）收据被有意推迟：prompt 车道的收据之所以跨重启存活，是因为它们本身就是会话事件；fork 与 execute 的耐久归属需要新的 SessionEventMap 词汇（fork 收据日志事件或 command/run 载荷增长）连同完整的格式目录与 SDK 投影流程——本次采纳不预先占用该结构决定。signal 之前的显式 undefined 位置参数被拒绝，采用请求对象惯例。

## 后果

到达同一活 Host 进程的重发在两车道上幂等；mutation-idempotency-lanes 的钉死测试随本变更同步更新——不带 id 的重试仍产生第二份副作用，采纳仅对携带 id 的请求生效。客户端发送方尚未铸造该 id：wire 字段与 Host 收据先行落地（与设备准入相同的服务端先行次序），客户端接线是后续项。

## 开放事项

两车道的耐久重启存活收据；客户端发送方接线；多版本互通矩阵照旧开放。
