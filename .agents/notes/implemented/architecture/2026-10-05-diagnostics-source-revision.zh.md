# Agent Note：诊断快照携带其源码修订标识

Status: implemented

[English](2026-10-05-diagnostics-source-revision.md) | 中文

## Problem

第 42 节把产品 SHA 列为诊断必备事实，但 `DiagnosticsSnapshot` 只携带 `productVersion`，记录在案的遗留项也明言 SHA 字段未含、构建注入接缝未定。没有修订标识的快照无法告诉支持消费方：它眼前的 Host 究竟由哪份确切源码产出。

## Decision

`DiagnosticsSnapshot` 新增 `sourceRevision`，`describe()` 每次调用时从 `process.env.DSH_BUILD_REVISION` 读取，无发布流程盖戳的环境回退字面量 `'source-tree'`。在调用内读取环境（而非模块加载时求值）既让启动器在首次 describe 前盖戳即可生效，也使发射出的库字节不含任何内联修订值——同一 commit 的已盖戳与未盖戳构建产出相同字节，封存管线永远无需为该字段开 replaced-build-outputs 条目。注入责任归发布启动器（§56 流程）；源码启动路径如实报告 `source-tree`。§42 键集断言测试钉住新字段，新用例同时覆盖回退与已盖戳修订。

## Alternatives considered

tsdown `define` 内联常量能把修订变成构建期事实，但每个 commit 都会为未变的源码产出不同的库字节——正是封存替换集裁定所要规避的增量发射差异。运行时读取 `.git` 在源码检出里有用，但在打包桌面产物内会误报或失败。逐调用读环境以信任启动器盖戳为代价，在每种部署形态下保持该字段诚实。

## Consequences

每个 `hostDiagnostics/describe` 载荷现在都能标识产出它的修订（当由盖戳的发布流程启动时），否则自标识为 `source-tree`。tool-cordis api-catalog 已随接口扩展再生成。在桌面发布启动器中接入实际盖戳仍是 §56 开放工作；§44 的各遥测出口照旧开放。

## Open follow-ups

在桌面发布构建流程中盖戳 `DSH_BUILD_REVISION`；§43 support-bundle 与 §44 分类型 telemetry 仍是记录在案的 §42 族开放项。
