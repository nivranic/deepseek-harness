---
description: "面向 securing 原生远程访问的宿主与维护者的配对设备信任存储：宿主身份、一次性配对码、带角色与吊销的设备记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-device-trust

[English](README.md) | 中文

## 概述

`dsh-device-trust` 是宿主用于原生远程访问的持久信任存储：一个 SQLite 数据库拥有稳定的宿主身份、一次性配对码（仅以 SHA-256 摘要存储），以及 [link 载体](../link-access/README.zh.md)据以授权请求的设备记录。每条记录携带设备的 Ed25519 公钥——宿主从不存储设备密钥——以及角色、时间戳与吊销状态。设备凭据绝不进入 LLM 供应商凭据存储。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 link 载体运行的组合中挂载本包；它注册 `ctx.deviceTrust`，在有人配对设备之前保持惰性。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | `<dshHome>/device-trust.sqlite` | SQLite 数据库文件，或 `:memory:`（测试） |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | `path` 缺省时使用的 harness home |

```yaml
- name: '@deepseek-ai/dsh-device-trust'
  config:
    path: /var/lib/dsh/device-trust.sqlite
```

### 可观察行为

`createPairing(ttlSeconds)` 签发 256 位一次性配对码；`consumePairing` 先删除配对码行再注册设备，因此无论两次调用并发还是先后，第二个消费者都会失败，过期配对码首次使用即作废。`revoke` 保留记录以备审计，`touch` 只为受信设备记录 `lastSeenAt`。盖有其他布局版本戳的数据库直接拒绝——不做迁移，预发布立场。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

- **配对码只存摘要。** 数据库存储 `sha256(code)`；读取数据库无法铸造凭据，且对 256 位随机值的查表无需时序安全比较。
- **同步原子消费。** `node:sqlite` 调用在宿主唯一连接上同步执行，select-then-delete 的配对消费在单进程内不可能交错。
- **密钥在边界校验。** 配对拒绝任何不可解析为 DER SubjectPublicKeyInfo 的公钥，因此每条存储的密钥都可用于请求验证。
- **宿主身份存于 meta。** 稳定的 `host_id` 位于 `meta` 表，首次读取时惰性创建，跨重启与重挂载存活。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务、配置、配对/设备/身份原语 |
| [`src/schema.ts`](src/schema.ts) | 打开序列、布局版本、信任表 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生（无运行时不变式：版本与配对原子性属于打开期与单元检查） |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [远程链接访问子系统](../../../docs/subsystems/remote-link.zh.md) — 信任模型的权威契约。
- [link-access 载体](../link-access/README.zh.md) — 依据这些记录做认证的消费者。
- [remote/ 包图](../README.zh.md) — 本组包及其仓库位置。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **单连接数据库** — 本存储假设宿主进程是唯一写者；第二个进程写同一文件不在本阶段范围。
- **尚无配对码取消界面** — 列出并取消待定配对码的 Windows 配对 UI 随 Phase 1 宿主 UI 到来；存储侧的原子作废已经就位。
- **`administrator` 尚无授权内容** — 该角色在存储中原样往返，为未来宿主管理预留；配对时只能授予 `observer` 与 `controller`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
