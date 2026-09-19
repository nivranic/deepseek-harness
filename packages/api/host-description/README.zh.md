---
description: "通过认证后的发现接口读取稳定 Host 身份、独立的产品/API/Session 版本以及活跃 Remote 能力集合。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-host-description

[English](README.md) | 中文

## 概述

使用 `host.describe` 识别已连接的 Harness Host，并读取其发布版本、API 代际、Session 写入格式代际和支持的操作集合。共享同一配置身份文件的启动会保留同一个随机 Host 身份。Web 与 Desktop 通过各自现有的认证载体暴露同一个 Remote 方法。发现操作不修改 Session 数据，也不授予调用其他操作的权限。

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

Web bundle 挂载此插件；Desktop 使用同一组合并配置其管道载体。Client 代码导入 API Remotes 外观并调用 `ctx.remote.host.describe()`，获得标准的 `RemoteResult<HostDescriptor>`。

### 配置

```yaml
- name: '@deepseek-ai/dsh-api-host-description'
  config:
    identityFile: !!js ctx.dshHomePath('.host-id')
    displayName: DeepSeek Harness
    transports: [http, websocket]
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `identityFile` | 必填 | 持久化 UUID 文件的绝对路径 |
| `displayName` | `DeepSeek Harness` | 面向操作者的标签，独立于身份 |
| `transports` | 必填 | 非空载体列表：`http`、`websocket` 或 `desktop-pipe` |
| `identityLockWaitMs` | `2000` | 等待并发身份写入者的最长时间，单位为毫秒 |

[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-api-host-description)拥有接受的配置字段。Desktop 只配置 `desktop-pipe`；应用必须声明实际挂载的载体。

`host.describe` 返回协议 1 的发现表示，并公布 `supportedApiProtocolVersions`。`host.negotiate` 从互不重复的正整数版本提议中选择最高共同版本，返回包含已选 `apiProtocolVersion` 的描述。空列表、重复或格式错误的提议会失败；无共同版本返回 `gateway/protocol-unsupported`。Client 必须确认两次响应的 `hostId` 相同。协商不改变 Host 状态，也不将权限绑定到协议编号。

### 身份与失败

身份文件包含一个小写 UUID v4，末尾为换行。并发首次启动共享持久化后的身份。无效或不可读的文件会让启动被拒绝，并保持原样；启动 Host 前应恢复保存的原始内容。写入失败绝不回退到临时身份。该 id 以此文件为范围，不代表机器、用户账户或遥测身份，也不是认证凭据。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

插件先加载身份与已安装的发布元数据，再发布 `host` Remote namespace。身份创建复用共享的跨进程文件锁与原子写入器。每次描述都从活跃 Gateway 绑定读取显式能力声明，因此服务销毁与严格定义撤回会改变后续结果，无需另一套 registry。

`productVersion` 来自已安装包的发布版本，`apiProtocolVersion` 来自已选的 Gateway 请求编解码器，`sessionFormatVersion` 来自 Session 写入器。这些值分别由不同位置拥有。平台与架构来自 Host 的 Node 进程，`serverTime` 是其 UTC 毫秒时钟。完整的[描述与能力类型](../../../docs/subsystems/typert.zh.md#host-discovery)会与源码进行一致性检查。

本包不发布运行时 invariant companion：服务直接读取权威绑定与文件事实，没有可与之交叉核对的独立事件投影。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [API Remotes](../remotes/README.zh.md) — 共享的 Client 外观。
- [API Gateway](../gateway/README.zh.md) — 调用与能力可用性。
- [Host 发现决策](../../../.agents/notes/implemented/architecture/2026-09-16-host-description-and-capabilities.zh.md) — 身份、声明与验证范围。

<a id="model-experience"></a>
## 模型体验

无，因为本包向 Client 返回 Host 元数据，不添加模型输入。

#### KV Cache 影响

发现操作不添加或修改模型请求 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 发现与协商报告协议可用性，两者都不授予逐设备权限。
- [Client 组合](../remotes/README.zh.md)在业务调用前协商协议 2 或 1。基于能力的 UI 准入以及专用升级界面仍未完成。
- 本包描述完整 Harness 运行时，不提供 Lite 运行时，也不迁移历史 Host 身份。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
