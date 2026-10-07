# Agent Note: 测试基线对齐附件准入与载体重试耗尽契约

Status: implemented

[English](2026-10-07-baseline-red-repair.md) | 中文

## Problem

两条测试基线已偏离其所在包的实际行为，且都在干净 HEAD 上红了足够久，被逐代报告当作开放通道携带。(1) `packages/interaction/commands/tests/commands.spec.ts` 的命令附件用例通过一个把 `validateImageBatch` 与 `saveImages` 委托给 `AttachmentStore.prototype` 的替身运行真实的基类批量准入；聚合图片上限落地时总额校验拆成了独立基类方法，替身从未获得该委托，四个准入用例全部以 `TypeError: this.validateImageTotals is not a function` 失败，而不是行使真实校验。(2) `packages/api/workspace-controller/tests/transport.client.spec.ts` 仍期望逻辑流载体重试耗尽呈现为 `gateway/internal`，而 gateway 自 carrier 合并变更起已把 `RemoteStreamCarrierError` 映射为 `gateway/transport-interrupted`（携带 `{ stream }`）且其 README 记载该契约——这正是第 45 节「所有 Client 对同一错误必须呈现相同语义」的原则。

## Decision

1. 替身补上缺失的委托：`validateImageTotals` 以与两个兄弟委托相同的原型转型惯用法加入，替身的限额配置喂给真实基类方法，四个用例重新断言真实准入行为（混合批次以 2 图×4 字节通过；第三张图触发文档记载的数量上限文案）。
2. 传输 spec 的期望与用例名改为文档化契约：载体重试耗尽发布 `gateway/transport-interrupted`。测试描述行为，此处权威是 gateway 的错误码词汇与 README；第 45 节的同语义原则覆盖 workspace 客户端基线。

## Alternatives considered

- **以 `Object.create(AttachmentStore.prototype)` 重建替身**：拒绝——为一个缺失成员重塑整个替身；委托惯用法在该文件中本就为此存在。
- **把 gateway 映射改回 `gateway/internal`**：拒绝——错误码词汇、README 契约与重试语义都把载体重试耗尽命名为 `gateway/transport-interrupted`；对齐陈旧 spec 才是第 45 节陈述的方向。

## Consequences

两个文件从五红变为 73/73 全绿，零生产代码改动：本次修复完全基线归真。第 45 节台账记录 workspace 客户端对齐（remaining 句+传输 spec 证据）。本代同时退役了近期每代报告开放通道清单中最旧的两条基线红。

## Open follow-ups

- loader-composition e2e 基线红保持自身通道（缺同意环境变量设置点+未定位的 Windows `.sessions` 行为），本代不触碰。
- file-upload `admitEncodedImages` 分类裁定与 client-domain-graph 分层基线保持开放。
