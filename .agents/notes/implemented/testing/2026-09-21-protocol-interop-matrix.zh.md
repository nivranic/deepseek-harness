# Agent Note: 协议版本互通矩阵固定为单一测试

Status: implemented

[English](2026-09-21-protocol-interop-matrix.md) | 中文

- 日期：2026-09-21
- 类别：testing
- 范围：`packages/api/gateway`

## 问题

第 14 节要求 N/N-1/N-2 兼容矩阵。网关已实现每一行——协议 2 当前、协议 1 遗留、显式 `apiProtocolVersion: 0` 的仅诊断发现层级、未知版本拒绝——但证据分散在三个套件中且各单元格断言粒度不一，没有一个单一工件陈述整张网格。可追溯行因此一直把矩阵列为未完成。

## 决策

把网格固定为一个规范测试。`pins the protocol-version by endpoint-class interop matrix`（gateway.host.spec.ts）以真实 `HostDescriptionGateway` 启动真实网关使两个发现端点可解析，然后遍历版本 {0、1、2、未知/畸形} × 端点类别 {发现、业务 RPC、事件结果结算、流打开}：发现端点准入每个协商层级；业务与事件结果准入 1 和 2（事件结果正格经业务级 `interaction-closed` 证明版本准入）；0 在发现之外得到诊断拒绝消息；未知版本得到通用 `gateway/protocol-unsupported`；流打开的拒绝行直接走 `wireStream.open`。准入版本的流行留在流套件——那里有注册的 Remote 事件源支撑。README 以双语言表格记录同一网格，线上契约对测试与人各陈述一次。

## 考虑过的替代方案

- 拉起真实 N-1/N-2 Host 构建做跨发布互通：诚实的资格验证，但尚无可测的已发布版本；如实记为 §14 真正剩余的工作而非本地伪造。
- 不带注册事件源复制流正格行：注册拒绝会遮蔽版本准入，这些单元格留在其 fixture 所在处。

## 后果

- 网关测试树新增对 `@deepseek-ai/dsh-api-host-description` 的 dev 依赖（仅测试，无 peer）。
- 本地矩阵只是版本轴的证据；§14 的跨发布、设备撤销状态、闭合错误语义与变更身份行仍开放。
