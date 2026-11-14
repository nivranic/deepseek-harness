# Agent Note: Lite 经投影 schema 目录向模型广告工具

Status: implemented

[English](2026-10-14-lite-tool-schemas-request-projection.md) | 中文

## Problem

§32 落地了 Lite 声明面——五个必填字段、Remote tools 命名空间与 `tool-descriptors.json`——但模型面没有跟上：声明文件刻意只载 host-only 字段（"never reach the model wire"），Lite 请求体因此一个工具都不广告。响应侧早已能从流中组装 `tool_calls`，意味着 Lite 模型可能对着一个从未点名任何工具的请求发起调用。`name`/`description`/`parameters` 在静态侧的唯一载体是 `docs/tool-catalog.md`——一页给人看的文档；Lite 车道缺少其 provider 所需 OpenAI function-tool 形态的机器可读来源。

## Decision

模型面是既有目录生成器的第三输出，不是新权威。`scripts/gen-tool-catalog.ts` 本就真 boot 每个工具包以同时收割 `descriptors()` 与 `schemas()`；现在它把声明过滤到 `supportsLite === true`，按 name 与收割到的 schema join（Lite 声明名缺 schema 即抛错），写出 `packages/core/tools/lite-tool-schemas.json`，每条恰 `{name, description, parameters}`、按 name 排序。既有 `--check` 在同一 `verify-tool-catalog` 叶下逐字节校验三工件，`doc-sync` 不新增门即覆盖新文件。同名冲突只在 Lite 域内判死：`bash` 由两个包以不同 description 注册，非 Lite 的同名变体不参与——Lite 面每个名字恰挂一份 schema。

Android 侧以构造态请求注入消费投影。`:contract` 以手写 fail-loud 的 `JsonElement` 解析器镜像 `LiteToolSchema`（缺字段/类型错/空白 name 或 description/parameters 非 object/重复 name 一律抛错；未知未来字段容忍），并有跨文件对拍测试断言投影的 name 集合 ⊆ `tool-descriptors.json` 中 `supportsLite` 的 id 集合——两份文件经 `copyLiteToolSchemas` 同乘测试 classpath。`:core` 新增 `LiteToolSchemaCatalog`，与同族对称双源（`HOST_PROJECTED`=解析投影、`BARE`=空表）。`LiteHTTPProvider` 取 `toolSchemas: List<LiteToolSchema> = emptyList()`，列表非空时在 `messages` 之后 put OpenAI 形态的 `tools` 数组（`{type: "function", function: {name, description, parameters}}`）；空表省略整个键，与宿主 DeepSeek 序列化器自己的空数组规则一致。工具是 provider 构造输入而非每调用状态：`LiteProviding`、`LiteChat`、`LiteLoop`、fold 与 journal 零改动；HTTP 测试钉死 `BARE` 请求仍恰含原有三个顶层键，而 system 与 tools 并存时 system 消息仍在 `messages[0]`。

## Alternatives considered

扩展 `tool-descriptors.json` 加 `description` 与 `parameters` 被否决：该文件是 §32 声明契约，其文档把字段钉在永不触及模型线上，混装受众会把 58 份参数 schema 拖进一个只需要六字段的解析器。在 `LiteToolRegistry` 的 bundled 描述旁硬编码 schema 被否决：那会为参数 schema 建立 Kotlin 侧权威，正是投影模式要防止的平行系统。带独立 boot 的第二个生成器被否决：收割机制完全相同，一个生成器挂第三输出保持单次真 boot 与单个校验门。

## Consequences

Lite 模型面现在有单一权威链——注册的 `ToolDefinition`、按 `supportsLite` 过滤的 `schemas()` 收割、入库投影、带跨文件对拍的 contract 镜像、请求注入——而 `web_search`（当今唯一 `supportsLite` 声明）是 Lite 模型能看见的第一件工具。`BARE` 请求与本增量之前的行为逐字节一致。生成器的冲突规则保持在 Lite 名字域内，跨包持久 shell 变体不会阻塞投影。

## Open follow-ups

Lite 循环仍无 tool-call 处理：收到的 `ToolCall` 分片止步于 fold 的内存态，治理执行的 §31 权限策略未实施。app 层运行时接线（两份投影的 assets 打包、构造真实 provider）与 preset 选择面保持开放，本地名对齐（`url_fetch` 对 `web_fetch`）与 `runtimeMode = lite` 公开亦然。
