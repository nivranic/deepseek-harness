---
description: "浏览器本地 Host 书签，提供已确认的当前身份、本地名称和手动排序。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-hosts

[English](README.md) | 中文

## 概述

**主机**分区保存向当前浏览器 origin 提供过描述的 Host 书签。它保留本地名称和手动排序，仅在发现成功后标记当前 Host，并在独立页面打开其他 Host。书签不授予访问权限。

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

在设置中打开**主机**。**重命名**保存去除首尾空白后的非空本地名称；**恢复原名**恢复 Host 的显示名称。**上移**和**下移**持久化显示顺序。**忘记**删除书签，但不断开当前 Host。

其他 HTTP origin 提供**打开主机页面**，在独立标签页打开。如果需要授权，请使用该 Host 当前的启动链接。本页始终使用自身的 Host 连接，不提供页内传输切换。

每个连接代际都会刷新发现结果。失败或过期的响应不能将 Host 标记为当前主机，已有书签仍可使用。忘记当前书签会隐藏该行，直到后续一次成功发现重新记录它。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

本包拥有书签存储，并通过插槽绑定的钩子提供观察值。Connection 提供连接代际通知；生成的 `host.describe()` 提供身份事实。只有最新发现响应可以更新存储；卸载会使待处理响应失效。

存储沿用现有的 `dsh-saved-hosts.v1` 浏览器存储格式。刷新身份事实时保留自定义名称和显式排序，校验持久化行并丢弃无效 origin。不读取或修改旧的已选 Host 键。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Connection](../connection/README.zh.md) — 本页的传输与连接代际。
- [Host 描述](../../api/host-description/README.zh.md) — 身份与支持的操作。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包管理浏览器本地书签，不注册面向模型的行为。

#### KV 缓存影响

无；本包既不组装也不发送模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 名册保留八个书签，显式位置排序优先于连接时间排序。
- 浏览器存储属于各自 origin，可能不可用或已满；此时更改仅保留在内存中，刷新后可能丢失。
- 发现流程不探测已保存的其他 Host。打开其他 Host 需要其自身授权。

<a id="dev-note"></a>
### 开发备注

无。
