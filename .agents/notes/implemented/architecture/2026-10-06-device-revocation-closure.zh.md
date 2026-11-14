# Agent Note: 设备撤销状态在五节台账中闭合共尾短语

Status: implemented

[English](2026-10-06-device-revocation-closure.md) | 中文

## Problem

五节台账（§12 HostDescriptor、§13 Capability negotiation、§19 Offline、§47 Feature Flag、§55 Contract Compatibility Matrix）携带逐字相同的共尾短语「仍需完整多版本/多语言矩阵、设备撤销状态、闭合错误语义和变更身份确认」——而全量测绘证明三个点名项已由 §18 增量族跨节闭合：device-revoked 是一等 ConnectionState 且有分类器映射、网关以 device/already-revoked 中止在途业务流与事件流并拒绝准入、设备设置页已撤销行无动作呈现、Kotlin/Swift 契约镜像钉死错误码、真机 e2e 走完整撤销生命周期。§12/§13 的规格原文根本没有设备撤销要求句——该短语是跨节克隆。唯一真缺口：已撤销行只显示 Tag，DeviceView.revokedAt（epoch ms）从未呈现。

## Decision

两件交付。其一，可见事实：DevicesSettingsSection 在已撤销行渲染撤销时间——行 meta 区 lastSeenAt 之后的条件 span，走该页既有的注入式 formatTime 钩子（Intl.DateTimeFormat(active locale, { dateStyle: 'medium', timeStyle: 'short' })），标签 locale-owned 为 revokedAt（"Revoked {time}"/「撤销于 {time}」）；revokedAt 缺失渲染空，活跃行绝不渲染撤销时间（有断言）。其二，台账改写：五节的共尾短语改为三个点名项已由 §18 增量族跨节闭合的叙述（证据文件内联引用），仅保留「跨真实发布版本的多版本/多语言矩阵」开放——它需要 N/N-1/N-2 互通，本车道不可达。五节 candidateEvidence 各增三个闭合证据路径（连接状态、gateway-stream 撤销 spec、设备管理节）。

## Alternatives considered

- **补一条「已撤销设备 describe 仍答而流拒绝」的 interlock 测试**：拒绝——两半各自在 gateway 套件已有直接测试，缝合测试不新增事实。
- **把 devices spec 加入 client 审计清单**：拒绝——审计清单是历史世系而非 client 全集；本包由车道定向验证（14 过）+CI 全矩阵承载，与 gen-36 的 host spec 同待遇。
- **留待整节 PASS 一并处理**：不可能——台账模型禁无逐项验收的节 PASS，且诚实状态恰是「由他节增量族闭合、矩阵仍开放」。

## Consequences

五节 remaining 如实反映已闭与仍开；本族唯一存活开放项是跨发布版本矩阵（真机/Swift 外壳验收车道另列开放）；后续代际读 §12/§13 不再重推已闭项。撤销时间呈现让管理面获得与存储层一致的持久可见事实。

## Open follow-ups

- 跨真实发布版本（N/N-1/N-2）互通矩阵——需已发布版本，本车道不可达。
- Swift 外壳撤销状态 UX（§18 remaining 已记载）。
- 真机/物理验收车道（常设开放通道）。
