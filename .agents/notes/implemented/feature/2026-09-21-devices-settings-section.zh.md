# Agent Note: 设备设置分区消费 device-trust Remote 面

Status: implemented

[English](2026-09-21-devices-settings-section.md) | 中文

- 日期：2026-09-21
- 类别：feature
- 范围：`packages/client/ui-settings-devices`、`packages/api/remotes`、`packages/typert/protocol`

## 问题

第 22 节的宿主面（带 platform/lastSeenAt 的列表、rename、revoke、revoke-all）没有运维界面：对账丢失设备的唯一途径是 Remote 命名空间，§7-§11 产品线也尚未启动。生成的 `remote.deviceTrust` 命名空间同样未挂载——api-remotes 客户端面既不挂载它，host preparation 也不准入其能力。

## 决策

新增浏览器插件 `dsh-client-ui-settings-devices`，注册本地化 `settings.section` 条目 `devices`（导航顺序 10，位于通用与插件之间）。api-remotes 客户端挂载 `deviceTrustRemote` 并重导出该接缝的类型；host preparation 按确切能力集合准入。分区以 `device.list.v1` 门控注册，并在 `connection.generation` 变化时换新组件标识重新注册，行状态（重命名草稿、打开的确认）不会在宿主替换后存活；一个受守卫的 `settle` 辅助函数在每次 Remote await 前后检查代际，把飞行中的代际变化（及其传输失败）映射为「connection changed」拒绝。

行渲染第 22 节的全部事实——名称、角色色调、客户端声明的平台标签、配对时间、准入派生的最近活跃（或「尚未准入」）、指纹前 16 个十六进制位、无操作的已撤销标记。重命名在行内进行，本地拒绝空名称并修剪首尾；单设备撤销与全部撤销都要求行内确认，完成的全部撤销报告数量，成功的行内变更触发一次清单重读。失败经 `classifyRemoteFailure` 解析为 locale 拥有的文案；未分类的码保留原始诊断。`formatTime` 挂在注入面（由 `ctx.locale.getSnapshot().active` 构建），因为 `GlobalStandardProps` 不携带 locale 属性——时间戳经注册跟随语言切换，而非组件属性。

三个设备码加入共享失败类别映射——`device/key-invalid` → authentication、`device/not-found` → unavailable、`device/already-revoked` → conflict——所有客户端面（本分区、连接分类器的 blocked 状态）对它们的呈现语义达成一致。

## 备选方案

- 订阅授权变化而非每次挂载/变更一份清单：设置面没有授权变化的流契约；变更后刷新加显式刷新按钮是诚实的新鲜度契约，已记为限制。
- 从本分区签发配对码：`issuePairing` 属于引导流程而非管理界面；刻意延期。
- 按行补原始诊断：类别映射保持跨客户端语义的唯一归属，分区只拥有文案。

## 后果

- 设备分区仅在宿主声明 `device.list.v1` 时存在；没有设备信任的宿主显示的是没有分区，而不是坏掉的分区。
- 四个操作共享同一代际守卫；被替换宿主的迟到响应既不能更新分区，也触达不了新宿主。
- device-trust 包的客户端面类型现经 api-remotes 重导出流动；消费方从不直接导入该接缝包。
