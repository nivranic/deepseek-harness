# Agent Note: Desktop 模型上下文由本地 Host 负责

Status: implemented

[English](2026-09-15-desktop-model-context.md) | 中文

## 问题

Desktop 组合禁用浏览器运行时，而 Web 应用的模型可见场景说明由该运行时负责。标准 Desktop Session 保留工作目录和工具指导，却没有标识承载对话的应用。恢复已退役的 Desktop bundle 还会恢复过时的组合及进程内执行假设。

## 决策

私有 [Desktop Host](../../../../apps/desktop-host/src/index.ts)通过现有 SystemPrompt 服务注册[应用上下文](../../../../apps/desktop-host/src/desktop-context.ts)。此节标识 Desktop 窗口和托管 Session 的本地机器，保留 Host 与各工具声明的执行环境之间的区别，不授予隐含的 DOM、路由或屏幕截图访问能力。

注册复用现有应用场景说明的位置，位于可复用工具指导之后、persona 后缀之前。标准 preset 的 persona 不会遮蔽这个独立节；完整 persona 通过注册表的常规规则抑制它。依赖订阅在提示词服务重载后恢复此节，并在拥有者销毁时移除它。agent loop（智能体循环）通过现有 `system/message` 事件记录最终提示词；不新增 Session 事件类型或传输消息。

## 考虑过的替代方案

**恢复旧 Desktop bundle。** 官方私有 Host 已负责 Desktop 组合。第二个 bundle 会重复其职责，并携带过时的前端执行说明。

**将应用事实放入全局 persona。** 标准 preset 会替换部署 persona，导致普通 Desktop Session 丢失这些事实。修改所有 preset 则会将应用身份与可复用的 agent 配置混在一起。

**将所有工具描述为本地执行。** Session 的 Host 位置不能决定每个提供方的执行环境。远端和容器提供方保留各自的工具语义。

## 影响

Desktop 请求增加一个靠后的提示词节，可复用指令前缀保持稳定。注册仅影响本地 Desktop Session；[环境后缀决策](../bug-fix/2026-09-06-environment-prompt-suffix.zh.md)仍负责提示词排序，[Desktop 打包决策](2026-08-25-electron-desktop-packaging-and-updates.zh.md)仍负责运行时和传输归属。两项决策均未被替代。

必要证据包括注册清理、服务重载、完整 persona 抑制、包含精确提示词的无密钥记录 Session，以及包含同一节的实际 Desktop 模型请求。记录会话 fixture（测试前置数据）通过随附的 headless profile 提供私有注册，并禁用平台特定的 shell 工具；它证明日志中的提示词内容，Desktop 运行则证明应用接线。
