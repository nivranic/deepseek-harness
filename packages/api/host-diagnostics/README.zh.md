---
description: "Host 诊断接缝：第 41 节 health/readiness 快照与第 42 节构造即脱敏的跨平台诊断载荷。"
kind: "package-reference"
---
# @deepseek-ai/dsh-api-host-diagnostics

[English](README.md) | 中文

## 概述

一个 Typert Remote owner（`ctx.hostDiagnostics`，能力 `host.diagnostics.v1`，权限 `view`）承载规格的诊断切片。`health()` 回答第 41 节的存活/就绪区分：六个组件——process、runtime、sessionStore、pluginState、connection、modelProvider——各携带状态与指名被探测服务的 detail，以及派生的 `ready` 判定（connection 被排除：无载体的 profile 同样是 Host）。`describe()` 组合第 42 节载荷——描述符事实、插件清单行、已发布迁移链、记录的 crash 与 last-error 事实、health 快照——以构造方式脱敏：字段集只枚举非秘密事实，任何 API key、bearer、配对秘密或原始凭据都无法到达它。

## 目录

- [Support Bundle](#support-bundle)
- [Model Experience](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## Support Bundle

`supportBundle()` 产出第 43 节工件：经脱敏的条目（任意深度的递归秘密形状扫描拒绝 api-key/bearer/secret/password/credential 键）、按规范化键序序列化的逐条 SHA-256 manifest、对有序 manifest 行的链式校验和，以及重算每个摘要并对篡改大声失败的 collector 校验——输入顺序绝不外泄，四个平台运行同一候选产出字节一致的 bundle。 工件的内容条目：第 42 节诊断快照；`session-headers.json`——当会话存储已组合且持有至少一个会话时——每个存储会话一行（头部事实与存储计数，绝不含事件内容），按 id 排序；以及 `settings-export.json`——当 settings 接缝已组合且注册命名空间时——每个命名空间一行，携带接缝脱敏后的解析值（`redactSecrets`），按命名空间排序。

## Model Experience

None（无）——本包只应答 health 与诊断读取，不注册 prompt、工具或会话事件。

#### KV Cache effect

None；health 与诊断读取不会改变任何模型请求。


## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **Health 基于存在性**——`down` 指名缺失的 owner 服务；能看到部分故障的组件探测（`degraded`）保持开放。
- **Crash 与 last-error 记录常开**——`$DSH_HOME` 下 pid 安全的启动标记把上一次未干净关闭识别为持久且有上限的 crash 日志，agent 错误 relay 填充进程本地且有上限的环形记录；事实只携带身份与文本。
- **尚无客户端表面**——载荷的消费方（设置、支持收集）随各自增量落地；本接缝与其 wire 即契约。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

探测是对可选组合服务的 `ctx.get()` 查找：`sessionPersistence`、`loader`、`llm`、`webServer`、`pluginInventory`（§42 行）与 `hostDescription`（描述符事实；缺失 owner 时 `describe` 以 `gateway/service-unavailable` 大声失败）。迁移表是从 session-format 包静态导入的已发布链——不做构建期内省，无需保持同步。

</details>

**Runtime invariant:** 不发布 companion。插件 apply 时 Remote owner 自行注册。
