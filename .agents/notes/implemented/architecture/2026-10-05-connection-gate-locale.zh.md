# Agent Note：连接门文案的多语言矩阵以构造方式闭合

Status: implemented

[English](2026-10-05-connection-gate-locale.md) | 中文

## Problem

第 18 节遗留项把多语言矩阵与闭合错误语义记为仍待验证。十一个连接状态都有门文案，但消费方以运行时模板拼字典键（`t(\`connection.gate.${state}\`)`），没有任何东西把 `ConnectionState` 联合与字典绑在一起：未来第十二个状态若漏配门键，编译照常通过、运行时渲染原始键；也没有测试断言 zh（键集真值源）与 en 两本字典确实携带每个非 ready 状态的文案。

## Decision

把映射静态拼写。`ConversationRoot` 现在持有一个导出的 `CONNECTION_GATE_KEYS` 对象——每个非 ready `ConnectionState` 成员对应一条字面量 `connection.gate.<state>` 键——由 `satisfies Record<Exclude<ConnectionState, 'ready'>, \`connection.gate.${…}\`>` 校验，联合成员缺条目即类型检查失败；渲染方改读 `CONNECTION_GATE_KEYS[state]` 而非插值。车道测试遍历 `Object.keys(CONNECTION_GATE_KEYS)`，断言两本字典对每个键都携带非空字符串，把 en/zh 矩阵在运行时钉死。

## Alternatives considered

仅从测试里的 `ConnectionState` 联合派生键集（spec 文件里复写一份穷尽清单）会复制成员列表并静默漂移；以导出映射为运行时遍历的锚点保持单一真值源。让 locale seam 的 `t` 重载拒绝模板键的方案被否——为单一消费方改动整条 seam 不成比例。

## Consequences

门矩阵被双重闭合：编译期由 `satisfies` 记录、测试期由双语键集断言。新增连接状态现在必须在同一变更里补齐字典行，否则构建与车道同败。审计的 client 全量清单随新 spec 增至 86 文件；跨真实发布版本的多版本互通矩阵仍是 §18 开放项。

## Open follow-ups

跨发布版本连接互通（§18 剩余的多版本矩阵）与设备侧矩阵类照记录保持开放。
