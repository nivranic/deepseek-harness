# Agent Note：Lite 工具声明终止 Mobile 对工具能力的猜测

Status: implemented

[English](2026-10-12-lite-tool-declarations.md) | 中文

## Problem

第 32 节要求每个工具声明 `id`、`version`、`risk`、`permissions`、`supportsLite`、`supportsRemote`，禁止 Mobile 猜测工具能否运行。该表面此前完全不存在：`ToolDefinition` 没有声明字段，Remote 面没有 tools 命名空间，Android Lite 循环靠硬编码本地名表判定移交——未知名被静默丢弃。

## Decision

`ToolDefinition` 注册时必填 `version`（自 1 起的正整数）、`risk`（第 37 节四档词表）、`permissions`（既有 Remote 权限词汇，空即无主张）、`supportsLite`、`supportsRemote`；`ToolRuntime.register()` 对词表外或类型错误的取值 fail-loud，形态照第 37 节 `normalizeDefinition`。26 个包的 63 处生产 `defineTool`、两个 preset fixture、`run_code` transport 与动态生产者均显式声明（逐工具理由见本代判定表）。包装不可信来源的生产者在桥自身定值：MCP 桥对每个 server 工具声明 `high` 与 `supportsLite: false`、不读 server 声明，沙箱 guard 覆盖不可信字段。字段仅限 Host 侧——`schemas()` allowlist 未动，模型请求与会话日志零新面，SDK 零变化。

`ToolRuntime` 继承 `TypertRemoteService`，在新 `tools` 命名空间下以 `tool.catalog.v1` 暴露 `list()`，照第 37 节 `commands` 链接入 `dsh-api-remotes` 准入表与 `host/describe` 聚合。描述符不含 `parameters` 与 `description`，二者留在模型面。`gen-tool-catalog` 另写出入库的机器可读 `packages/core/tools/tool-descriptors.json`。

Android 消费声明而非猜测。`:contract` 模块以手写 `JsonElement` 解析镜像 `ToolDescriptor`：词表外 risk、非正或小数 version、缺字段、重复 id 全部 fail-loud，未知未来字段容忍。`LiteToolRegistry` 新增 `LiteToolCatalog`，来源为显式枚举——描述符到达即 `HOST_DECLARED`，离线或缺能力即 `BUNDLED_FALLBACK`，fallback 行为与旧表逐字节一致。声明模式下 `supportsLite: false` 即使与旧表相反也交回 full runtime，未声明名交回而非丢弃。`NativeGatewayClient` 仅在能力已广告时拉取 `tools/list`；能力缺失是协商子集的正常路径，已声明却坏负载按 `BadWire` 失败。镜像测试钉住共享 id 的 `supportsLite` 一致性并冻结本地名单——未来 Host 目录出现与本地名同名的工具即重新裁定。

随手的基线红修绿：`admitHostOperation` 此前要求每个声明能力的都已广告，自第 30 节起由 `session.control.v1` 与 `model.steer.v1` 双重声明的 `session/prompt` 在单一广告声明者下准入失败。准入现接受任一已广告声明者，镜像网关首个匹配派发，拒绝时命名首个声明者保持确定性。

## Alternatives considered

只走生成投影、无实时命名空间的方案被否：MCP 桥与沙箱工具是动态的，只有 Host 能服务其声明，且旧 Host 的协商子集规则本来就需要能力门。把五字段烤进 `ToolSchema` 被否：模型可见输入必须可从会话日志重建，这些字段不属于模型请求。保留 bundled 表作为声明源被否——那正是第 32 节禁止的猜测。

## Consequences

工具作者每次注册须声明五字段，注册边界立即拒绝缺失或非法值。Remote 客户端无需调用即可发现工具能力，Lite 循环的移交判定由声明驱动、fallback 模式显式。本代 `:contract`、`:core` 与能力详情屏变更，`app-debug.apk` 字节漂移，封存记录成为下一基线。早于本代、自第 30 节时代起游离于审计清单外的单能力准入测试红就此关闭。

## Open follow-ups

Android 本地名与 Host 工具名（`url_fetch` 与 `web_fetch` 等六个）的命名对齐在后续增量完成后再逐个翻 `supportsLite`；app 层从网关拉取到 `LiteChatViewModel` 的运行时接线、Lite 工具权限策略与第 33 节 prompt composition 仍待实施。
