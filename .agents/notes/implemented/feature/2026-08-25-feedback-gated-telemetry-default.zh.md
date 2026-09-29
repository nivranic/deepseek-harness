# Agent Note: 反馈门控的会话遥测模式

Status: implemented

[English](2026-08-25-feedback-gated-telemetry-default.md) | 中文

## 问题

诊断一条 `/feedback` 报告需要报告所描述的会话数据。共享基础配置把未设置的 `DSH_TELEMETRY_MODE` 解析为 `DISABLED`，因此默认安装发出的反馈到达接收方时不带任何会话数据，报告者在求助的那一刻也没有授权共享的途径；只有事先导出了 `DSH_TELEMETRY_MODE` 的部署才能交付可诊断的报告。

## 决定

`FEEDBACK_ONLY` 是显式 `DSH_TELEMETRY_MODE`：用户记录 `/feedback` 之前不上传任何数据，每条已记录反馈会释放截至该事件尚未共享的隐私安全诊断前缀。恢复的会话只共享当前生命周期。[隐私安全遥测决定](../architecture/2026-09-02-privacy-safe-session-telemetry.zh.md)取代按反馈触发的随附默认值；共享 base 与省略插件模式都解析为 `DISABLED`，任何非空 `DSH_TELEMETRY_DISABLED` 仍是加载前的强制退出开关。

[默认挂载决定](2026-07-31-web-telemetry-default-mount.zh.md)继续拥有端点、批处理节奏与退出排空设置。只有部署方显式选择本模式后，反馈动作才是触发器；反馈动作本身不足以授权传输。

## 考虑过的替代方案

**保持 `DISABLED`，让报告者带着 `DSH_TELEMETRY_MODE=FEEDBACK_ONLY` 重跑。** 否决：值得上传的正是出现问题的那个会话，重跑会丢掉它。

**默认 `FULL`。** 否决：没有任何用户动作的持续导出正是默认关闭决定所禁止的，全新安装中没有任何东西授权它。

**改为在反馈时门控官方 DeepSeek `dsh_session_log` 请求贡献，而不是恢复 OTel 默认值。** 此处未采用：该贡献通过后续 LLM 请求上传，而不是在反馈边界上传，会话的最后一条反馈永远不会被交付；在那条路径上做反馈触发的冲刷是比翻转默认值更大的设计。

## 后果

- 全新安装不上传任何内容；显式 `FEEDBACK_ONLY` 部署只释放以权威反馈记录结尾的前缀。
- 释放的记录包含强制隐私投影，不包含 Session 载荷或 workspace 路径；反馈文本本身留在本地。
- `/feedback` 确认文本披露已选择的策略，但绝不声称投递。
