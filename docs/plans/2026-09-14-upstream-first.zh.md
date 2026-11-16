# Upstream-First 实施计划

[English](2026-09-14-upstream-first.md) | 中文

**目标：** 将下游能力收敛到已固定的官方 Host、Desktop、Typert API 和共享 Client。

**架构：** 在隔离工作树中从官方提交起步。通过当前 owner 迁入已审查能力；保留历史分支和产品数据。

**技术栈：** Git、Node.js、pnpm、Cordis、Typert、Electron、React、Swift、Kotlin。

## 摘要

Phase 0、1 已完成：处置记录覆盖全部采集组件与旧工作树未提交报告。Gate 0 已准入迁移计划；Phase 2 将选定行为迁入官方应用。[实施状态](../../IMPLEMENTATION_STATUS.md)维护进度；[能力清单](../../CUSTOM_CAPABILITY_INVENTORY.json)维护分类。

## 目录

- [任务 1：完成审计](#task-1-complete-the-audit)
- [任务 2：收敛 Desktop](#task-2-converge-desktop)
- [任务 3：稳定共享 API](#task-3-stabilize-shared-apis)
- [任务 4：按依赖顺序推进](#task-4-continue-in-dependency-order)
- [开发备注](#dev-note)

<a id="task-1-complete-the-audit"></a>
## 任务 1：完成审计

文件：[基线](../../UPSTREAM_DELTA.json)、[能力清单](../../CUSTOM_CAPABILITY_INVENTORY.json)、[审计](../../UPSTREAM_DELTA.md)和[决定](../../.agents/notes/proposed/architecture/2026-09-14-upstream-first-convergence.zh.md)。

1. 对比每个归属已记录的来源提交、已固定的官方提交及 merge-base。旧 Goal 的未提交路径单独核对，不将其等同于来源提交。
2. 先审 Desktop 定制设置、原生集成、诊断和恢复，再审 Gateway、Session Controller、Connection、持久化、设置和凭据。
3. 为每个尚无能力映射的归属补充 Adopt、Adapt、Keep、Migrate、Delete 或 Experimental，并记录确切来源、目标、依赖和验证需求。
4. 所有必要补丁审查和迁移决定记录完整前，Gate 0 保持未通过。检查报告一致性，证明未完成审计不能宣称 Gate 0 PASS。

<a id="task-2-converge-desktop"></a>
## 任务 2：收敛 Desktop

文件：[Desktop 源码](../../apps/desktop/src/main.ts)、[Host 进程](../../apps/desktop/src/host-process.ts)、[打包配置](../../apps/desktop/electron-builder.config.mjs)，以及 `apps/desktop/tests/` 下的归属测试。

1. 保留官方 runtime 生命周期、精确版本绑定、自定义 scheme、framed pipes、插件管理和 updater。
2. 托盘偏好和登录注册保留在 [Shell owner](../../.agents/notes/implemented/architecture/2026-09-15-desktop-shell-preferences.zh.md)。旧版 Host 拥有的 Desktop 设置只通过经过审查的显式迁移转换，不复制系统登录状态。诊断和 health 通过共享 owner 迁入。UI 改动同时更新语言字典和相关快照。
3. 运行 Host 生命周期、协议、单实例和更新的定向测试，再使用隔离 Harness home 运行受支持的 Desktop 开发启动器。分别记录源码测试与应用运行。
4. Windows/macOS 打包、签名、安装和恢复属于后续平台证据，不能从源码测试推断通过。

<a id="task-3-stabilize-shared-apis"></a>
## 任务 3：稳定共享 API

文件：[Gateway](../../packages/api/gateway/src/index.ts)、[Remote 组装](../../packages/api/remotes/src/index.ts)、[Connection](../../packages/client/connection/src/client/connection.ts)、[Session Client](../../packages/api/session-controller/src/client/sessions/manager.ts)，以及当前持久化 owner。

1. 通过现有 Remote 贡献机制设计 HostDescriptor 和能力，分离产品、API 与 Session 格式版本。
2. 在领域 owner 定义错误结果与 mutation identity。验证重复 prompt、answer、cancel 和 rename 请求后再确认重试安全。
3. 复用 Gateway pending waterfall 投递和重放。先定义第二次回答的关闭结果与 Host 重启行为，再改协议。
4. 通过显式、可恢复的转换设计处理旧 SQLite Session 和版本化设置文档。禁止用候选启动器打开用户历史 Harness home。
5. 在各 owner 增加有意义的单元/集成用例、无需密钥的产品快照和 TS/Swift/Kotlin 兼容 fixture；Session 事件改动同时更新两套 SDK 投影。

<a id="task-4-continue-in-dependency-order"></a>
## 任务 4：按依赖顺序推进

依次完成 Interaction 可靠性、共享 Client 响应式、诊断、Device Trust、Remote 传输、follow/attach/查看位置 handoff/multi-host、薄 Native Companion、Lite 和发布验证。[兼容](../../COMPATIBILITY_MATRIX.md)、[安全](../../SECURITY_STATUS.md)、[平台](../../PLATFORM_VERIFICATION.md)及[发布](../../RELEASE_STATUS.md)报告维护各自证据缺口。

<a id="dev-note"></a>
## 开发备注

源码提交是候选基线，不表示产品迁移或 RC 完成。本任务尚未执行 commit、push、产品数据迁移、签名或发布。
