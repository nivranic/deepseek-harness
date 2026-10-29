---
description: "零依赖的 spawn 事实：把当前进程的 binary 重新当作纯 Node 运行时运行，供把内置 worker 或 runner 作为子进程重新执行的宿主插件共用。"
kind: "package-reference"
---

# dsh-node-spawn

[English](README.md) | 中文

<a id="summary"></a>
## 概述

零依赖的"以纯 Node 运行时运行脚本"spawn 事实，供需要把内置 worker 或 runner 作为子进程重新执行的宿主插件共用：原生目录选择的 Win32 对话框 worker（`dsh-host-directory-picker-native`）与 Windows ACL 沙盒 runner 链（`dsh-sandbox-local`）。

## 目录

- [概述](#summary)
- [接口面](#surface)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="surface"></a>
## 接口面

```ts
import { spawn } from 'node:child_process'
import { nodeSpawnCommand } from '@deepseek-ai/dsh-node-spawn'

declare const workerScript: string

const { command, env } = nodeSpawnCommand()
spawn(command, [workerScript], { env: { ...process.env, ...env }, stdio: 'ignore', windowsHide: true })
```

`nodeSpawnCommand()` 一次性解析两个事实，均在进程生命周期内稳定：

- **`command`** 是 `process.execPath`。纯 Node 下就是 Node 可执行文件本身；打包桌面应用下是 Electron 二进制。
- **`env`** 携带该命令在脚本参数之前要求的环境项：Electron 下是 `ELECTRON_RUN_AS_NODE=1`，没有它，同一个可执行文件会启动整个桌面应用而不是把脚本当作 Node 运行；纯 Node 下该映射为空，因为此变量在纯 Node 中无效，省略它可避免波及无关子进程。

消费方必须把 `env` 合并进子进程环境；该值始终覆盖从父进程继承的任何 Electron 模式条目。

## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

在打包的桌面应用下，Electron binary 经 `ELECTRON_RUN_AS_NODE=1` 以 Node 身份重新运行；桌面打包必须保持 RunAsNode fuse 开启。

</details>

<a id="model-experience"></a>
## 模型体验

无：本包是纯进程事实，此处没有任何内容会到达模型请求。

#### KV Cache 影响

无；此处没有任何内容会进入请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **Electron fuse 必须允许 RunAsNode**——若加固的 Electron 构建禁用了 `RunAsNode` fuse，就需要在旁边附带一个真正的 Node 可执行文件；此处的桌面打包保持该 fuse 开启。
- **仅解析一层 spawn 事实**——本助手只回答"当前进程如何以 Node 重新执行"；自身还要再派生 Node 二进制的子进程需要另行解析。

<a id="dev-note"></a>
