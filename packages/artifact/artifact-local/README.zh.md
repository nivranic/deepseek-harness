---
description: "把工件内容字节存放在 DSH_HOME 之下的本地持久工件后端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-artifact-local

[English](README.md) | 中文

## 概述

本包把工件的内容字节存储在本机：`<DSH_HOME>/artifacts` 下每引用一个原子的 `<id>.artifact` 文件，属主私有权限，按需创建。它实现 `dsh-artifact` 的 `artifact_create` 工具写入的 `ctx.artifacts` 资源通道；会话日志只保留引用与状态，字节就住在这里。出厂 `dsh` 组合零配置挂载并永久保留每件工件；需要约束磁盘增长的部署启用可选的 `retentionDays` 清扫。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

默认组合下工件持久存储。自建组合时，把本后端与工具包一同挂载：

```yaml
- name: '@deepseek-ai/dsh-artifact'
- name: '@deepseek-ai/dsh-artifact-local'
```

`dshHome` 可选：省略时存储跟随 `DSH_HOME`，再退到 `~/.dsh`。

`retentionDays` 约束已存字节的存活：一个正整数天数，工件老化超过它即被清扫删除；省略则永久保留每件工件（默认——工件是用户保留的文件）。显式配置例如：

```yaml
- name: '@deepseek-ai/dsh-artifact-local'
  retentionDays: 30
```

<a id="understand-the-implementation"></a>
## 理解实现

`LocalArtifactStore` 扩展 `ArtifactStore` 服务：`put` 经 `writeFileAtomic` 写入（独占创建的临时同胞改名覆盖目标，读者只看到旧文件或完整新文件），`get` 读回字节、缺席 id 读为 null，`remove` 静默删除。重复 put 同一 id 会整体替换内容。配置 `retentionDays` 时，构造器把它校验为正整数（坏值让插件加载失败）并注册一次 boot 清扫加每日周期：`sweep(retentionDays)` 列出 `artifacts/`、stat 每个 `<id>.artifact` 文件、删除字节老化越过窗口的文件并返回被删的 id。年龄是字节写入以来的时间——读取从不刷新它。清扫逐文件尽力而为：一个读不了的条目记日志跳过，从未物化的目录里没有可清的东西。

<a id="further-exploration"></a>
## 进一步探索

- [工件缝与工具](../artifact/README.zh.md)——词汇、服务缝与 `artifact_create`。
- [原子写工具](../../util/atomic-write/README.zh.md)——本后端骑的替换原语。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 保留只看写入以来的年龄：日志引用比被清字节活得更久是已建模的 `ARTIFACT_CONTENT_MISSING` / 响亮工具失败，但清扫从不查询哪些会话仍引用某工件。
- 清扫节奏（boot 加每日）固定；只有窗口可配置。
- 内容只按引用 id 寻址，非内容寻址；相同内容提交两次会存两份。

<a id="dev-note"></a>
## 开发备注

无。
