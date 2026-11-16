# Agent Note: Steer 提交通入共享能力契约（第 30 节）

Status: implemented

[English](2026-10-01-model-steer.md) | 中文

## Problem

第 30 节要求遗留的 steer 承诺只在共享契约内延续：`HostDescriptor` capabilities 广播 `model.select.v1` 与 `model.steer.v1`，Client 按能力渲染，不得各平台自建词汇。`model.steer.v1` 从未被广播——steer 承诺裸 ride 在 `session/prompt` 的 mode 参数上，Web composer 按隐式地址规则提供转向而非能力门控，Android companion 则硬编码 `mode: "queue"`，完全没有转向入口。

## Decision

- `SESSION_REMOTE_CAPABILITIES` 在既有 `prompt` 方法上广播 `model.steer.v1`。该条目刻意与 `session.control.v1` 重叠（两者对 `prompt` 都声明 `prompt.send`），因此网关按首个匹配能力查权限的语义在此方法上与顺序无关。
- `ComposerControlAvailability` 新增 `steer`，取广播与可接纳 prompt 路径的合取；Web 输入条仅在两者同时成立时渲染显式转向提交，一次性子代理地址排队而非转向（只有普通 Session 与 continuable 子代理接受新 turn）。运行中/空闲的区分归 Host：Client 只发意图（`mode: "steer"`），Host 将其转为 `agent.steer`，空闲 driver 会启动一个 turn。
- Android 经 `NativeObservedCapability.MODEL_STEER` 观察该能力（无独立端点——承诺 ride 在 `prompt` 上），在排队发送旁渲染 转向发送，`submitPrompt` 新增 `steer` 参数选择 wire mode；默认 `queue` 的 wire 与此前逐字节一致。
- 转向入口让 composer 保持验收车道对着软键盘演练过的单行形态，用两字短标签（转向）：全宽标签（转向发送）在手机宽度上会溢出行、把输入框挤压到竖向撑高、会话列表高度塌缩——这是待确认发送重试车道通过 pending 卡片滚出组合树暴露的回归。验收词汇寻址的 testTag 全部保持不动。
- 验收车道将真实 AVD companion 配对到回放 Host，提交一份转向草稿，证明恰好一条携带 `mode: "steer"` 的设备签名 `session/prompt` dispatch 且其录制 turn settle，外加待发 prompt 清空。

## Alternatives considered

- **独立 steer 端点：** 承诺已经 ride 在 `prompt` 的 mode 参数上；另开方法只会把准入（附件回执、requestId 去重、权限）拆到两条路径，契约没有收益。
- **从观察到的 turn 状态推导 steer 可用性：** Client 在点击时刻无法可靠得知 turn 状态；运行/空闲语义归 Host，Client 只按广播门控并发送意图。
- **无条件转向入口：** 违反第 30 节按能力渲染的要求，且会向从未承诺该能力的 Host 提交 `mode: "steer"`。

## Consequences

- 今天每个 Host 都广播 `model.steer.v1`，未广播路径仅由单元测试覆盖（能力保留是代码级改动，不是配置旋钮）。
- Web 对一次性子代理的转向提交按普通 prompt 排队，Android 排队提交在 wire 上不变。
- Host 能力详情列表新增本地化 转向发送 条目，support 导出快照补 `model.steer.v1` 观察能力键，`HostDescriptor.capabilities` 的广播保持排序输出。

## Open work

- 第 30 节的另一半——Android 的 model-select 采编入口——仍开放；`model.select.v1` 已广播、Web 选择器已存在，Android 侧尚无 select UI。
- 真机资格验收仍开放；车道运行在本地 AVD 回放 Host 上。
