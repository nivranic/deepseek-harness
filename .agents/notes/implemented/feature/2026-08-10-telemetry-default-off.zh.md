# Agent Note: 遥测必须显式启用

Status: implemented

[English](2026-08-10-telemetry-default-off.md) | 中文

## 问题

DeepSeek Harness 原设计有两路出站遥测数据流。在内测阶段，共享基础配置挂载了带内建生产 endpoint 的遥测，两路数据流默认上报以帮助诊断上报的问题：会话 OTel 后端在省略 `mode` 时可能导出完整会话内容、工具数据、提示词和工作区路径，而 dsh-sdk 启动器数据流则无条件外发。因此，全新安装无需部署方明确选择便允许向外上报。

## 决策

会话数据流使用 `DSH_TELEMETRY_MODE` 作为正向授权配置。共享 base 与直接构造都会把未设置和空值解析为 `DISABLED`；该模式不构造 OTel 提供方、处理器或导出器，并将反馈留在本地。部署方通过 `FULL` 或 `FEEDBACK_ONLY` 显式启用隐私安全诊断信息。任何非空 `DSH_TELEMETRY_DISABLED` 仍是具有最高优先级的加载前强制退出开关。[隐私安全遥测决定](../architecture/2026-09-02-privacy-safe-session-telemetry.zh.md)拥有数据最小化规则，[默认挂载决定](2026-07-31-web-telemetry-default-mount.zh.md)拥有 endpoint、批处理节奏和退出排空设置。

[CLI reference README](../../../../apps/cli/reference/README.zh.md) 记录当前部署口径：共享 base 默认 `DISABLED`，显式上传模式只发送隐私清单中 body 不携带值或内容的诊断信息，强制退出开关优先。产品不提供可以开启上传的提示；部署配置是唯一正向授权路径。

## 考虑过的替代方案

**保留默认退出机制并改进披露。** 不采用：披露不能让缺少配置构成发送有界诊断字段的明确授权。

**将会话遥测默认设为 `FEEDBACK_ONLY`。** 不采用：即使部署方没有显式启用向外上报，记录反馈仍会触发上传。默认值必须让会话及其反馈都留在本地。

**添加另一个授权标记。** 不采用：`DSH_TELEMETRY_MODE` 已经拥有 Session 遥测授权；另一个配置项会产生冲突设置。

**删除 Session 遥测。** 不采用：内部部署仍需要显式启用 `FULL` 与反馈触发的上报。

## 后果

全新 profile 不发出遥测网络请求。上传模式必须显式设置，保留 endpoint 校验、批处理与关闭行为，并且只接收强制隐私投影。现有强制退出继续生效。
