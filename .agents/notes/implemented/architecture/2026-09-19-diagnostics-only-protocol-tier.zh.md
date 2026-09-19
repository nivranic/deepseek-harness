# Agent Note: 面向落后两代 Client 的诊断层级协议

Status: implemented

[English](2026-09-19-diagnostics-only-protocol-tier.md) | 中文

## 问题

规格第 14 节要求正式兼容矩阵：N-2 Client 对 N Host 只获得"Diagnostics only"。Gateway 只协商编解码器 1 与 2，其他显式版本一律 `gateway/protocol-unsupported` 拒绝——落后两代的 Client 与未知未来版本被混为一谈，两者都得到"拒绝并升级"，诊断准入根本不存在。

## 当前上游边界

`packages/api/gateway/src/protocol.ts` 的 `decodeRemoteRequest` 从显式 `apiProtocolVersion` 1 或 2 选择线编解码器（缺省元数据即冻结协议 1）；`host/negotiate` 从正整数报价中选最高共享编解码器。没有"已准入但降级"的层级概念。

## 决策

`apiProtocolVersion: 0` 成为显式的诊断层级声明：请求沿用冻结的协议 1 编解码（`LEGACY_DISCOVERY_PROTOCOL_VERSION`），`decodeRemoteRequest` 在编解码器之外返回 `diagnosticsOnly: true`。Gateway 在两条派发路径上执行层级准入：只有只读 Host 发现端点（固定的 `DIAGNOSTICS_ONLY_ENDPOINTS` 集合：`host/describe`、`host/negotiate`）通过；业务 RPC、流与事件结果结算以携带相同 endpoint 与 `supportedApiProtocolVersions` 详情的 `gateway/protocol-unsupported` 拒绝，Client 因此呈现常规 `incompatible` 升级指引。未知版本（3、-1、1.5、非数字）的拒绝行为不变——"Unknown → 拒绝并升级"与"N-2 → 仅诊断"保持区分。

## 备选方案

为层级拒绝引入专用失败码被否决：会波及已封存的 Remote 失败信封 schema、Kotlin/Swift 镜像与全部投影，而 Client 可见收益为零——既有 compatibility 类已映射到 `incompatible` 连接状态。让层级经 `host/negotiate` 报价准入被否决：negotiate 选择的是完整编解码器，诊断层 Client 把自己协商进完整层会颠倒矩阵行。把端点集合做成配置被否决：层级边界是第 14 节的协议不变量，不是部署选择。

## 契约

`decodeRemoteRequest(endpoint, payload)` 返回 `{ version, payload, diagnosticsOnly }`；version 仍是线编解码器，诊断层为 1。`DIAGNOSTICS_ONLY_PROTOCOL_VERSION` 为 0，`DIAGNOSTICS_ONLY_ENDPOINTS` 为 `host/describe` 与 `host/negotiate`。`dispatchRpc` 与 `openWireStream` 都在业务效果前拒绝集合外的层级请求。`host/negotiate` 仍要求互异正整数报价。

## 持久化

无；协议选择是逐请求的，不留存储状态。

## 安全

层级准入不授予任何授权：准入端点是只读 Host 发现命名空间，且请求元数据从来不是授权。层级请求打到其他端点在派发前失败，工具副作用与交互结算都不可能运行。

## 兼容性

编解码器 1/2 协商、缺省元数据行为与未知版本拒绝不变；唯一可观察变化是显式 0 不再在解码期抛出。失败码、详情结构、连接状态映射均未动，信封 schema 与 Kotlin/Swift 镜像保持字节一致。

## 失败处理

集合外的层级请求以 `gateway/protocol-unsupported` 失败，消息为 "Remote request API protocol is limited to diagnostics on this Host; update the application before reconnecting"。层级 Client 的 `host/negotiate` 报价仍按正整数校验，`[0]` 报价作为非法参数失败而不是完成协商。

## 测试

Gateway 套件 432/432（11 个文件）：协议解码在旧编解码器上准入 0 并保留净封包剥离规则、格式错误的 0 封包保持原样、未知版本拒绝；RPC 准入以 limited-diagnostics 消息拒绝业务与事件结果端点的层级请求，而层级 `host/describe` 到达方法派发；流准入以相同层级消息拒绝 `$events` 与业务流的层级打开。Host description 套件 9/9 不变。

## 推行

仅源码与测试；无配置、线格式或 schema 变更。

## 回滚

回退 `decodeRemoteRequest` 的层级分支与两处准入检查；显式 0 重新作为未知版本拒绝。

## 后果

第 14 节矩阵逐行落实：N/N 完整、N/N-1 协商、N-2 经 Host 发现仅诊断、未知拒绝并给出升级指引。冻结的 Client 始终能读取 Host 事实，向用户解释业务功能为何不可用。
