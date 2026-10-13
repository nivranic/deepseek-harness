# Agent Note：Lite persona 经投影的 preset 目录复用官方系统提示

Status: implemented

[English](2026-10-12-lite-preset-projection.md) | 中文

## Problem

第 33 节禁止 Lite 维护平行 Prompt 系统，要求复用官方 System Prompt assembly、只经 profile/preset 组合上下文。Lite 运行时此前完全没有提示组装：provider 接缝只收裸用户串、请求体只带一条 user 消息、Kotlin 侧不存在任何 persona 概念——因此迈向提示的第一步就有手搓出被禁止的平行系统的风险。

## Decision

复用通道是生成投影，而非 Kotlin 侧组装。`scripts/gen-lite-preset-catalog.ts` 对每个 shipped preset 真正引导 roster、组装其 standing scope，把官方 `ctx.systemPrompt.assemble()` 的输出连同该 preset 声明的 persona 行记出入库的 `packages/preset/agent-presets/lite-preset-descriptors.json`（包内 `src/types.ts` 的 `LitePresetProjection`）；`verify-lite-preset-catalog` 随 `doc-sync` 运行，`--check` 报告首个差异行。组装结果仍引用运行时变量的 preset——shipped `standard` 与 `ptc` 在 `{{model}}`、`{{cwd}}` 上的模板——连同变量名记入文件的 `excluded` 清单，而不是伪造为静态行；声明延迟（`!!js`）布尔的 persona 行让收割失败：静态投影只渲染字面值。官方组装面本身零改动——不动段落顺序、不动 persona 插件。

Android 侧消费投影而不持有任何 prompt 文本。`:contract` 以手写 `JsonElement` 解析镜像 `LitePresetDescriptor`（缺字段、类型错、重复 id、空 assembled prompt 一律抛错；未知未来字段容忍），经 `copyLitePresets` 任务拷入测试资源。`:core` 的 `LitePresetCatalog` 与工具目录同构双源：投影解析成功即 `HOST_PROJECTED`，离线或缺失即 `BARE`，`BARE` 得 null system prompt。`LiteProviding.stream(prompt, system = null)` 以接口默认参数扩展接缝，只有 provider 实现类变化；`LiteHTTPProvider` 在 system 非空时于 `messages` 头部插入一条 `{role: "system"}`，否则产出与之前逐字节一致的请求体。`LiteChatViewModel` 以投影中 `order` 最小的 preset 为默认并提交其组装提示。fold 与 journal 零改动：system prompt 是请求面上下文，不是会话事件。

## Alternatives considered

活 Host 广播（persona 版 tools/list）在该面被否：preset 是静态 shipped 配置、没有动态生产者——工具目录需要活命名空间的理由在此不成立——而 Lite 循环设计上无 Host 运行。为 `{{model}}`/`{{cwd}}` 代入文档化占位值被否：对它渲染的运行时说谎的 Lite 提示比排除更糟。在设备上单独渲染 persona 前缀被否：那会把组装语义（identity 段、完成性）分叉进 Kotlin，重建平行系统。

## Consequences

每个 shipped preset 的 Lite 可见提示现在只有一个权威：生成时收割的官方组装，由 `doc-sync` 复核。依赖变量的 preset 可见地排除而非静默出错。Kotlin 源携带零 prompt 文本——本增量的强制不变量——请求体变更是加性的，`BARE` 客户端与之前逐字节一致（HTTP 测试钉死三种形态）。persona 行的延迟表达式布尔现在 fail-loud，不再静默读作 `false`。

## Open follow-ups

Lite 的 preset 选择面（在投影 preset 间选择，而非默认 `order` 最小）、与工具目录共用的 app 层运行时接线、第 31 节的 Lite 工具权限策略，以及向模型通告设备端工具（请求体仍无 `tools` 数组）保持开放。
