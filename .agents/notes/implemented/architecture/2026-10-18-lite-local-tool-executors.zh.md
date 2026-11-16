# Agent Note：首批 Lite 本地工具真机执行——calculator 与 artifact_create 经设备自有 schemas

Status: implemented

[English](2026-10-18-lite-local-tool-executors.md) | 中文

## Problem

gen-60 的联合目录把五个本地名声明为 `AllowLocal`，但两处缺口令每次调用落空。生产 `LiteToolExecuting` 是折 `ok=false` 空文本的 stub；且——上一代勘察发现的——五名实为模型不可达：schemas 文档恰一枚工具（`web_search`）、provider 对持有行无按名过滤，任何请求都没广播过本地工具。无 schema 的执行器只可能被幻觉中的模型调用。§49.3 将 Lite 内置工具执行定为 P2（「先稳定 Remote Contract」）——台账 lite 轨仍把执行器列为首选开放项，诚实切片是 gen-60 论题的最小端到端证明。

## Decision

交付 calculator 与 artifact_create——两枚零权限、零网络、零 intake-UX 的名字——其模型面 schemas 作为第五个 app 自有资产（`apps/android/app/lite/lite-device-tool-schemas.json`，与设备声明同一可评审源纪律；`web_search` 不入内因宿主投影已携带）。`LiteToolSchemaCatalog.fromBundledDocuments` 以跨文档同名守卫（镜像声明联合）取宿主与设备 schemas 之并。calculator 是手写递归下降求值器——`+ - * / %`、括号、一元正负号与十进制数在同一 `BigDecimal` 上下文下，零新依赖。artifact_create 执行器经聊天阅读面所读的同一 `LiteFileArtifactStore` 写入，kind 约束到阅读面的文本封闭集、id 拒绝路径分隔符（模型可控 id 落进 `File` 构造）。`LiteToolOutcome` 增可选 artifact fact，循环在携带 artifact 的成功 `tool/result` 后跟随 `artifact/created` + `artifact/status` 事件对——次序由 fold 自身配对逻辑导出（创建必先于状态；字节仅在执行器原子写后才存在）。`MainActivity` 挂真实派发：两执行器，余名具名拒答。

## Alternatives considered

一代做满五执行器被否决：`url_fetch` 拖自家端点策略（https 门、大小上限、有界超时、§54 框定），`image_inspect`/`attachment_read` 在独立 Lite 面无 intake 生产者——执行器将读取不可能存在的输入。仅 calculator 被否决为留下 artifact 写路径（唯一有可见副作用的执行器）无证明。在注册表旁硬编码 schemas 被否决（gen-52 裁定：Kotlin 侧 schema 权威是投影模式要防的平行系统）；扩宿主生成器 boot 被否决（gen-60：设备 id 不得泄入活 `tools/list` 域）。复用宿主 calculator 不可能——宿主目录没有。

## Consequences

声明的本地工具如今端到端运行：设备 schema → 模型面 → `AllowLocal` 梯 → 真执行器 → 诚实 `tool/result`，携带 artifact 的执行经 fold 呈现在 artifacts 面板。镜像测试把四文档读作一个并集；未来第三名的 schema 扩设备文档、并集交叉核对即持。余下三本地名保持已声明未执行、拒答具名（`no on-device executor mounted`）；artifact 事件对只在驱动器活体 fold——journal 持久化按第 64 章保持 turn 级保真，与既有工具行行为一致。

## Open follow-ups

`url_fetch` 端点策略与其 §54 框定；`image_inspect`/`attachment_read` 的 intake 决策；结果回喂下一模型请求（P2）；其余 §31/§67 开放项。
