# Agent Note: 普通 Windows 子进程始终由内核 Job 持有

Status: implemented

[English](2026-09-07-windows-subprocess-job-ownership.md) | 中文

## Problem

Windows 程序可能创建 detached 后代，并在消费者请求终止前退出。以 PID 为根的进程表遍历无法在根进程消失后可靠恢复该后代。把根进程退出当作整树完全停稳，会在仍有工作可执行时释放所有权，而 `taskkill /T` 无法恢复丢失的关系。

将已运行的目标分配到 Job 还存在第二个间隙：目标代码可以在分配前创建进程。本地提供方也需要兼容 Node 的管道、任意可执行文件参数、Electron 支持，以及 Python SDK 打包产物的固定 `dsh` 入口。

## Decision

本地提供方为每个普通 Windows 子进程持有一个不可继承、不允许 breakaway、关闭即终止的 Job。可信 bootstrap 启动时不带目标的启动环境。父进程先将 bootstrap 分配到 Job，再通过 IPC 发送可执行文件、argv 和显式环境。bootstrap 继承调用方的三条标准流，并以 detached 方式启动目标，避免加入 libuv 额外的随 bootstrap 退出而终止的 Job；目标及后代仍继承提供方的 Job。

bootstrap 通过 IPC 单独报告目标退出事实，与自身退出分开。目标可以退出而后代仍活跃。`done` 保留该结果；`waitForExit()` 要求内核查询成功并确认 Job 活跃成员归零。正常终止请求 `TerminateJobObject`，随后观察成员。即使宿主退出时未执行 JavaScript，关闭所有者句柄也会终止剩余成员，但句柄关闭本身不是退出观察。

Job 设置与目标 spawn 失败会拒绝启动。bootstrap 未提供目标结果就意外退出时，会终止 Job 并拒绝 `done`；显式取消可用已终止 bootstrap 的事实结算。迟到的 IPC 失败不能替换已由取消接管的结算。Job 查询或终止失败会保留句柄供最终清理，而不发布成功停稳。成功和失败路径都关闭 harness 收集用管道及 spill 文件描述符；pipe 模式流仍由调用方拥有。

bootstrap 启动先排除继承的 `NODE_*`、`ELECTRON_*` 和 `TSX_*` 钩子，再应用运行时必需的启动标志。原目标环境仅通过分配后的消息传递。源码运行选择 TypeScript helper；已构建的 Node 和 Electron 运行选择 JavaScript 入口。Windows SEA 以私有标记和父进程 IPC 重入固定 `dsh` bin，然后仅加载此 helper。普通 Node、缺失 IPC 或无效标记值都会拒绝该选择。helper 不是第二个应用启动器，也不是安全沙箱。

[共享 Win32 库](2026-08-19-shared-win32-process-primitives.zh.md) 拥有 Job 句柄、分配、统计和原生错误。其匿名 Koffi 结构体由模块拥有，因此独立加载的模块代际不会在原生类型名注册表中碰撞。提供方拥有 IPC、流结算、取消和生命周期观察。POSIX 进程组与终端会话机制保持已有所有者。

## Existing decisions and supersession

此决策取代[子进程 seam](2026-07-26-subprocess-seam.zh.md) 和[同步宿主退出清理](../bug-fix/2026-08-11-synchronous-subprocess-exit-cleanup.zh.md) 中普通 Windows PID 进程树的实现。这些记录因能力分离、消费者所有权、POSIX 行为与终端最终清理而继续有效。共享 Win32 决策因策略与资源分离而继续有效；此处满足了其要求存在真实普通进程消费者的条件。[Python profile 运行时](2026-08-23-python-sdk-dsh-profile-runtime.zh.md) 仍拥有打包与模块回退。没有任何活动记录被完全取代。

## Alternatives considered

**保留 PID 进程树终止。** 拒绝，因为根进程退出会在清理执行前消除可发现的关系；重复进程表扫描无法恢复内核所有权。

**普通 spawn 后再分配请求程序。** 拒绝，因为目标代码可在分配前执行。对可信 helper 延迟放行，既保留 Node 的 stdio 实现，又在成员关系建立前不执行目标代码。

**再实现一个原生管道进程启动器。** 拒绝，因为当前消费者需要 Job 所有权，而不需要复制 Node 的可执行文件引号处理、流管道和运行时启动行为。共享库仅暴露此路径所需的额外原生操作。

**让 SEA 执行任意脚本 argv。** 拒绝，因为打包 CLI（命令行界面）只有一个固定入口，受支持应用使用 profile。通过父进程 IPC 选择固定私有 helper，可以保留该应用模型。

## Consequences

每次普通 Windows 启动增加一个 bootstrap 进程和一个 Job 句柄。外层 Job 的限制可能拒绝分配，提供方会失败，而不回退到仅按 PID 清理。分配前的间隔只包含可信 bootstrap 启动；父进程 IPC 断开会结束未分配的 helper。Job 成员可能在单独持有的进程句柄变为 signaled 前归零，因此这两种观察保持区分。

此改动仅改变普通 Windows 进程所有权。它不加强终端后代发现、不限制目标文件系统访问、不保证 POSIX 在宿主原生失败后的清理，也不恢复断电后的工作。

## Verification

原生 Windows 回归覆盖目标结果、显式环境和启动钩子隔离、目标退出后保留的后代、分配前取消、设置失败、helper 意外退出，以及成员查询失败后的最终清理。可移植协议测试覆盖 IPC 验证、顺序、迟到的取消回调及 spill 文件描述符关闭。Linux 回归保留 POSIX 升级、输出、终端和宿主退出行为；Koffi 重载与原生分配测试覆盖独立模块代际。

头文件探针将 Job 统计结构尺寸与活跃成员偏移绑定到 Windows SDK。已构建的 Node、Electron 和完整 SEA profile smoke 通过各自真实运行时入口执行 helper；源码覆盖率无法观察自执行子进程入口。这些进程检查不代表 Windows 安装器验收或完整跨平台发布资格。
