# Agent Note: Host 侧设备载体终止原语（§29）

Status: implemented

[English](2026-10-02-gateway-device-termination.md) | 中文

## 问题

session-location-facts 一代证明了车道工具集内无法制造确定性设备级断线：移除 adb reverse 对空闲 follow 流不可检测（无应用层 keepalive 触达 WebSocket 控制层）、同 Session 重开复用活流、甚至穿过已移除隧道的新连接也曾成功——Host 侧仍持有 ESTABLISHED 套接字对。该代结论「确定性断线需要 Host 侧流终止原语」正是本增量收口的缺口：网关此前完全没有 host 平面管理面；唯一按设备结束流的机制是信任级的撤销，对连接断线语义错误。

## 决策

- `RemoteStreamMuxConnection` 向流 opener 暴露窄接口 `RemoteStreamConnectionHandle`，唯一方法 `terminate()` 无关闭握手地销毁载体套接字——正是真实断线在客户端眼中的物理形态。
- 网关在某设备的已准入流于一条物理连接上打开时把该连接绑定到该设备（业务流在 `admitRpcDevice` 后、`$events` 流在 `admitDeviceClient` 后），其已准入流全部结束后解绑；同一套接字上的多条已准入流共享同一句柄；集合同一性守卫防止陈旧解绑误删替换条目。
- `terminateDeviceConnections({deviceId})` 是公开的 host 平面服务方法：销毁该设备当前持有的全部活载体并返回数量。准入与授权不受影响——这是连接卫生不是撤销；客户端按自身重连策略处理。不持有活连接的设备终止数为零。
- Android companion 零代码改动：既有连接状态机本就把载体丢失读作传输中断，在重连延迟期间进入重连中状态，并以同一已准入身份重开 `session/follow`。新验收车道在真机 AVD 上（沿用 location-facts 车道的双 scaffold providers-only 结构）驱动该原语，证明稳定事实行离开并出现重连中状态词、follow 流重开后原样恢复。
- location-facts 车道的不可行断线注释与 golden 勘误为指向该原语与新车道。

## 备选方案

- **复用设备撤销结束流：** 撤销是需重新配对的持久信任状态变更；断线车道不应消耗信任状态，且 §29 在线状态是连接属性不是授权属性。
- **流级 error 帧而非销毁套接字：** 逻辑 error 帧保持物理载体存活，恰是上一代证明设备侧不可检测的半开形态。
- **应用层 keepalive：** 能在分钟级检测半开载体，但不能为车道或运维产生确定性断线。

## 后果

- 原语仅 host 平面：不是类型化 Remote 方法、不需要能力条目、设备不可调用。
- WS 层心跳仍是慢速被动检测器；本原语是主动的运维/车道工具。
- 网关包 README 双语记载该面。

## 开放工作

- 断线周期的真机资格（§34 硬件项）；运维面（CLI/Host UI）出现时可采纳该方法。
