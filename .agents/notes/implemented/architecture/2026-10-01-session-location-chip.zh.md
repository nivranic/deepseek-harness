# Agent Note: Session 头部 chip 公开第 29 节全部位置事实

Status: implemented

[English](2026-10-01-session-location-chip.md) | 中文

## Problem

第 29 节要求每个 Session 公开 Host、运行模式、工作区、权限预设与在线状态，并在顶部长期显示简洁 chip（`● Work PC · Windows`）。运行位置 chip 此前只承载 Host 名/平台加第 10 节权限层级；运行模式、工作区与实时在线状态没有任何呈现面，而第 34 节 remaining 仍把桌面分屏差异列为开放——分屏差异增量其实已经交付。

## Decision

- chip 可见文本保持简洁——Host 事实、工作区目录名、权限层级，仅在连接非 ready 时追加状态词——而 `title` 属性额外公开运行模式（`完整运行时`，读自 descriptor）与工作区全路径，使第 29 节每项事实都可及，且不撑宽头部。
- `ConversationSessionHeaderInjected.hooks` 新增 `connectionState`（与 root composer gate 读取的同一个 `ConnectionHandle.state` observable），header 直接观察第 18 节的连接词汇，而不是从 Host 事实的存在推断任何东西。dot 在 ready/未观察时保持成功色，connecting/authenticating/reconnecting 期间取业务色，七个阻断状态取警示色，各配一个本地化短状态词（`session.locationState.*`）。
- 工作区名取 session summary `cwd` 的最后一段路径；列表尚未收录的 Session（无 summary 行）自然省略该段与 title 路径，与 chip 已有的「未描述 Host」缺席语义一致。
- 第 34 节 remaining 文本在同一变更中修正：桌面分屏差异是已交付证据（共享配对之上的逐页签切换），该节开放项只剩真机资格验收。

## Alternatives considered

- **五行事实全部内联渲染：** 规格自己的 chip 示例只有两段；五段 chip 在手机宽度上挤占头部，title 让完整集合悬停即得。
- **复用 composer gate 文案作状态词：** `connection.gate.*` 是句子长度的恢复指引；chip 需要单词级状态，因此拥有同一词汇之上的 `session.locationState.*` 短词集。
- **从 Host 事实推断在线状态：** Host 事实在连接掉线后仍然保留（描述最后一个已建立代次），会把离线会话显示为在线；只有连接 observable 知道实时状态。

## Consequences

- 第 29 节五个位置事实每项都在头部表面公开，双语各有本地化短词；第 18 节连接词汇的任何状态回归都会破坏 chip 矩阵。
- 从未协商 descriptor 的 Host 不显示运行模式段（事实未知，而非默认补值），chip 对代次实际承载的内容保持诚实。
- chip 仍是纯显示面：不导航、不阻断任何东西；composer gate 与名册切换保持各自机制。

## Open work

- chip 显示 summary 的工作区目录；从 chip 直达工作区选择器刻意不在范围（composer 与 hero 已拥有工作区切换）。
- Lite 运行模式还没有生产方（`runtimeMode: 'full'` 是当今唯一取值）；Lite Host 出现时其标签无需再接线即可进入 title。
