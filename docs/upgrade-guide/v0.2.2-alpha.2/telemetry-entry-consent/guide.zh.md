---
kind: upgrade-guide
description: "遥测同意设置从独立设置文档迁入后端 Loader 条目，直接遥测 emit 不再导出记录。"
---

# 在遥测后端条目上配置同意设置

[English](guide.md) | 中文

## 变更

遥测设置分区读写 `session-telemetry-otel` Loader 条目的 `consent` 字段，不再使用独立的 `telemetry-consent` 设置文档。变更遵循 Loader 配置生命周期。

OTel 后端仅在明确反馈后且启用 `consent.sessionTelemetry` 时导出 Session 记录。同意变更对新采集实时生效；撤回前已授权的批次仍可能完成发送。直接调用 `sessionTelemetry.emit()` 不会导出记录。其余同意字段不会启用额外的导出通道。

## 迁移

1. 在 profile 配置中，将 `@deepseek-ai/dsh-session-telemetry-otel` 条目的 id 设为 `session-telemetry-otel`，以显示其遥测设置分区。将选定的同意值复制到该条目的 `config.consent`；旧设置文档中的值不会自动导入。省略的字段默认为 `false`。
2. 将后端的 `mode` 和 exporter 配置与 `consent` 保留在同一配置中。参见[后端配置](../../../../packages/session/session-telemetry-otel/README.zh.md#use-this-package)。即使启用同意设置，`DISABLED` 仍会阻止导出。TypeScript 直接构造接收 `Config(rawOptions)`；`ctx.plugin()` 仍接收原始选项。
3. 打开设置 → 遥测，确认五个开关与 Host 配置一致。保存一项变更后重新打开分区，确认已接受的值。如果条目使用其他 id，请通过其自身的编辑器修改配置。
4. 移除对直接运维遥测导出的依赖。Session 日志导出由反馈授权控制；启用其他同意字段不会恢复直接导出通道。
