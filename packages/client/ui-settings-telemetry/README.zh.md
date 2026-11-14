---
description: "通过宿主后端配置提供五个独立的遥测同意开关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-telemetry

[English](README.md) | 中文

## 概述

**遥测**分区让 Web 用户编辑五个独立的同意字段：会话遥测、提供商元数据、中继元数据、设备信任元数据和崩溃诊断。没有总开关。数值来自宿主配置；写入被拒时保留宿主值，并在对应行显示提示。宿主暴露随附遥测后端的设置条目时，该分区才会出现。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在设置中打开**遥测**。宿主必须暴露 `session-telemetry-otel` Loader 条目；否则导航中不显示该分区。每个品类有一个开关，每次点击只写入该条目 `consent` 字段下的对应品类。

开关位置跟随宿主已接受的配置。界面不会预先移动开关。写入被拒或失败时，保留已接受的值并提示无法保存更改。只读文档会禁用全部开关。

### 数据品类

- **会话遥测** — 后端可在反馈授权后导出的会话记录。
- **提供商元数据** — 提供商与模型身份。
- **中继元数据** — 请求中继信息。
- **设备信任元数据** — 已配对设备的身份事实。
- **崩溃诊断** — 应用故障记录。

这些开关保存同意状态，不保证后端会导出对应品类。随附 OTel 后端目前只导出反馈授权的会话记录；其他字段不会创建额外导出通道。

### 应用更改

写入通过宿主配置编辑器更新后端的实时同意引用，无需重启。撤回同意会阻止新的反馈采集；撤回前已授权的批次仍可能完成发送。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

插件使用 `ctx.configForms` 提供的共享设置 describe 镜像与串行写入队列。`whileServed` 管理分区注册，在后端条目消失或插件卸载时移除分区。

表单读取后端可编辑的同意字段。每次手势在 `['consent', kind]` 提交一个路径操作，保留其他同意字段与后端选项。共享表单携带当前版本，将接受的应答写入镜像，并在拒绝后刷新宿主状态。

渲染器将表单绑定为 `useConsent`。组件只读取该快照；局部状态记录在途手势与失败写入，不保存已存同意值的另一份副本。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-settings](../ui-settings/README.zh.md) — 共享配置表单与设置插槽。
- [settings](../../settings/settings/README.zh.md) — 宿主配置更新与版本。
- [session-telemetry](../../session/session-telemetry/README.zh.md) — 遥测同意数据品类。
- [session-telemetry-otel](../../session/session-telemetry-otel/README.zh.md) — 随附后端的导出策略。

-----

<a id="model-experience"></a>
## 模型体验

无，本浏览器包不注册面向模型的行为。

#### KV 缓存影响

无；本包既不组装也不发送模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 分区使用随附的 `session-telemetry-otel` 条目 id。采用其他名称的后端条目需使用自身的配置编辑器。
- 同意字段不描述导出器的实际生效状态。后端组合与上传策略仍决定哪些已获同意的数据可以离开宿主。

<a id="dev-note"></a>
### 开发备注

无。
