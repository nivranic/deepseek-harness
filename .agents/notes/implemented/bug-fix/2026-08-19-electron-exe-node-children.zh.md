# Agent Note: 打包 Electron exe 下的 Node 子进程以 Node 模式重新运行

Status: implemented

[English](2026-08-19-electron-exe-node-children.md) | 中文

## Problem

两个宿主插件通过 `process.execPath` 把内置脚本作为 Node 子进程 spawn：Win32 目录对话框 worker（`dsh-host-directory-picker-native`）与 Windows ACL 沙盒 runner（`dsh-sandbox-local` → `dsh-sandbox-windows-acl`）。打包桌面 exe 下整个 profile 在 Electron 主进程内启动，因此 `process.execPath` 是 Electron 二进制而不是 `node`。带着脚本参数 spawn 它会重新启动整个桌面应用：对话框 worker 永不回报，`host.pickDirectory` 无限挂起，打包 GUI 里的工作区选择/添加按钮表现为点击无响应。ACL runner 的 argv 有同样的缺陷——每次受限 pwsh 执行（agent preset 下的 shell 工具）都会重启应用而不是限制命令。纯 Node 下（webserver 与 CLI 面）两条路径都正常，所以只有打包 exe 暴露出问题。

## Decision

一个共享事实，一个包：[`dsh-node-spawn`](../../../../packages/util/node-spawn/README.zh.md) 解析当前进程如何以纯 Node 重新运行自身——`process.execPath`，加上 `process.versions.electron` 存在时的 `ELECTRON_RUN_AS_NODE=1`，否则不加任何条目。对话框 worker 直接以这些事实 spawn。沙盒 seam 的 `ConfinedArgv` 增加可选的 `env` 片段（纯可执行 runner 时缺省），因为 runner 的调用就是 argv 加环境；`dsh-sandbox-local` 把 windows-acl 档的 spawn 事实环境挂到每次包装上，pwsh/bash 沙盒执行器把它合并进 spawn 环境、置于所有 spec 自有环境内容之上（这是 spawn 前置条件，不是命令内容），runner 在受限子进程继承环境块（`lpEnvironment` 为 NULL）之前从自身环境中删除 `ELECTRON_RUN_AS_NODE`，因此用户从受限 shell 运行的 Electron 程序仍能正常启动。桌面打包保持 Electron 的 `RunAsNode` fuse 开启；若未来加固构建禁用它，必须随应用附带真正的 Node 可执行文件。

## Alternatives considered

**在应用自身环境上设置 `ELECTRON_RUN_AS_NODE` 让子进程继承。** 拒绝：所有子进程都会继承，包括用户 shell 与命令——从 agent shell 启动的 Electron 程序（例如 VS Code）会静默地以纯 Node 运行。

**用 `cmd /c set …` 包装 runner argv，借 argv 携带该条目。** 拒绝：它把 shell 引入沙盒刻意保持免 shell 的调用链，而且为了不建一等 env 片段而把条目经 argv 引号往返十分脆弱。

**为这些 spawn 在应用旁附带 Node 可执行文件。** 暂缓：Electron 二进制已内嵌同一 Node 运行时；RunAsNode 是其受支持的 CLI 模式。只有打包将来禁用 fuse 时再重新评估。

## Consequences

打包 exe 的工作区选择/添加按钮与受限 shell 执行恢复正常；纯 Node 下相同代码路径保持不变。`ConfinedArgv` 的消费方现在必须合并可选的 env 片段——随仓库发布的执行器已经做到，seam 目录记录了该义务。对话框 worker 无需 seam 变更（它自建 spawn）；它在单测通道之外的覆盖是打包应用验证，因为该修复的可观察行为需要 Electron 宿主才会显现。
