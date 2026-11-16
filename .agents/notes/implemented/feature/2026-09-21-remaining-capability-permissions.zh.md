# Agent Note: 其余归属方声明设备权限

Status: implemented

[English](2026-09-21-remaining-capability-permissions.md) | 中文

- 日期：2026-09-21
- 类别：feature
- 范围：14 个包：`packages/api/settings-controller`、`packages/api/workspace-files`、`packages/client/file-upload`、`packages/client/ui-deliverables`、`packages/context/session-reference`、`packages/extensions/cordis-host-runner`、`packages/feedback/command-feedback`、`packages/feedback/message-feedback`、`packages/goal/goal`、`packages/host/plugin-inventory`、`packages/interaction/commands`、`packages/llm/llm`、`packages/preset/agent-presets`、`packages/subagent/subagent`

## 问题

session-controller 与 workspace-controller 采纳 `requiredPermission` 之后，其余所有 Remote 能力归属方对设备仍是 fail-closed——持有角色的已配对设备无法使用只读面（工作区文件、模型发现、preset 目录等），因为没有任何能力声明其端点所需的权限。

## 决策

按端点语义为其余全部能力声明第 21 节权限。每个集合本就同质，因此没有拆分任何能力，也没有消费方锁面变化。只读与操作系统面操作取 `view`：脱敏设置描述、配置文档、预设目录操作、凭据元数据、workspace-files 全部七个操作集、presented-file 的 desktop/open/reveal、session-reference 候选发现、插件清单、LLM 提供方目录与模型发现、agent-preset 目录、命令目录、message-feedback 列表、goal 读取、subagent 目录，以及 dynamic-cordis 的清单、Client 源码与 inspect 握手。驱动会话的变更取 `prompt.send`：设置与凭据写入、文件暂存、preset 选择与管理、命令执行、message-feedback 记录与删除、Session 备注记录、goal 全部变更、subagent 提示词与父级寻址中断，以及 dynamic-cordis 运行生命周期——激活、请求确认、用户运行结算、Stop、Undefine、失败报告与调用。device-trust 的配对引导（`device-pair.redeem.v1`、`device.admit.v1`）刻意不声明：这两个端点在角色存在之前以匿名方式到达。

两个测试闭环。host-preparation 规格断言二十个业务声明来源的每个能力都声明第 21 节词汇内的权限，未来的能力无法悄悄重新引入 fail-closed 漂移。device-trust 规格钉住自身拆分：管理操作为 `device.admin`，引导对不声明。jobs 不声明任何 Remote 能力（其生产者是 Host 侧），因此无需声明。

## 备选方案

- `dynamic-cordis.resolve-run.v1` 用 `approval.respond`（部分被结算的请求需要批准）：人工批准回复已走第 15 节交互接缝；该端点是页面完成自身的激活握手，属于运行生命周期，取 `prompt.send`。
- dynamic-cordis 失败报告用 `view`（"只是报告"）：两个方法都把失败写入运行并引导其结果，属于会话驱动状态。
- 凭据写入取更严档：五列表格没有配置管理列，交互列命名的是回复能力而非特权档，第一版中 `prompt.send` 是唯一站得住的变更列。

## 后果

- viewer 设备可读取全部业务面；collaborator 及以上还可变更设置、凭据、preset、goal、反馈、为 prompt 暂存的文件，以及 subagent 与 dynamic-cordis 运行。
- 三处 Windows 环境失败（workspace-files 符号链接 ×6、presented-file 符号链接、agent-presets 悬空安装链接）均已验证干净树同样失败，不在本增量范围。
