---
description: "面向用户与维护者的匿名按 harness home 身份说明，用于追踪遥测、反馈确认与 DeepSeek 提供方请求如何关联记录。"
kind: "package-library"
---

# @deepseek-ai/dsh-anonymous-user-id

[English](README.md) | 中文

## 概述

每个 harness home 都会获得一个匿名 id，遥测、反馈与 DeepSeek 请求会把它附加到各自的记录上，让接收系统无需了解用户身份即可判断记录来自同一套安装。`$DSH_HOME/.anonymous-user-id`（默认 `~/.dsh`）中的私有随机根种子会派生该公开 UUID 与独立的 Session 遥测假名密钥；根种子绝不会离开 identity 包。该身份会在这些功能之一首次运行时自动出现，跨重启保持稳定，删除文件后会重新生成。独立初始化的 harness home 会派生互不关联的身份，除非运维方复制或共享私有根种子；身份不包含任何机器或账户信息。

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

当你希望本机安装外发的记录能被识别为来自同一个 harness home——遥测、反馈与 DeepSeek 请求都携带同一个共享 id——本包就是提供它的地方。无需安装或配置任何东西：id 会自动出现，已随附的反馈、遥测与 DeepSeek 功能已经在使用它。不要用它来识别用户，也不要用它关联独立初始化的 home；不同 home 相互独立的前提是其私有根种子文件未被复制或共享。

### 该 id 能为你做什么

你的安装外发的三类内容携带同一个 id，因此记录在它们之间可以相互对应：

- **会话遥测**——你的遥测导出会以 `user.id` Resource 属性携带该 id，采集器因此可以按安装分组记录。
- **反馈**——每条反馈确认都会指名记录该反馈的匿名安装。
- **DeepSeek 请求**——每次提供方请求都会携带 `x-deepseek-harness-user-id` 标头，因此可以按安装归因用量。

### 查看与重置身份

私有根种子存放在 `$DSH_HOME/.anonymous-user-id`（默认 `~/.dsh`）中，文件包含一行 `v1:<64 个十六进制字符>`。请把该文件视为本机 secret 状态，不要把内容复制到诊断或支持消息中。删除文件会在下次启动时获得全新的公开 id 与 Session 假名密钥；正在运行的进程在退出前会一直保留当前派生身份。包含裸 UUID 的旧文件会在首次使用时轮换，因为已经导出的值不能充当 secret 密钥材料。

在 POSIX 上，本包只接受当前用户拥有且 group／other 均无权限的普通文件。首次创建会先完整写入同目录的随机 `0600` 文件，再以禁止替换的方式发布。每次轮换都会以禁止替换的方式发布或采用一个完整私有的 `.anonymous-user-id.rotate` claim，确认当前目标仍是先前检查过的文件，再以原子方式把该共享 claim 移至其路径；相互配合的进程因此采用同一种子，被中断进程留下的完整 claim 也可由后续启动完成。超限的私有普通根种子文件会被视为损坏，并在不读取内容的情况下轮换。发布前检测到符号链接、非普通路径、检查失败、无效 claim 或不可读路径时不会替换目标，本进程会改用共享 claim 或仅存于内存的根种子。在 Windows 上，Node.js 的 mode bit 无法验证文件 DACL：本包仍拒绝符号链接形态与非普通最终路径，但新文件会继承 harness home 的 DACL。使用自定义 `DSH_HOME` 前必须先保护该目录。

### 在自己的包中使用

当你构建的功能需要共享该安装的匿名 id 时，导入该值并复用一次即可——遥测、反馈与 DeepSeek 已经在使用同一个 id，因此你的记录能与它们相互对应：

```ts
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'

const userId = getOrCreateAnonymousUserId() // stable for the process lifetime
```

该值在进程内保持稳定，并与内置功能使用的值一致；只有根种子轮换或后续启动生成替代值时才会改变。需要 Session 关联的基础设施使用 `getOrCreateAnonymousIdentity().pseudonymizeSessionId(id)`：构造后的函数是纯函数，绝不会暴露根种子或派生密钥。即使 home 目录不可写，该身份在本次运行中依然可用，记录因此不会中断。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释本包背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **一个随机根种子，按域派生输出。** 256-bit `crypto.randomBytes()` 根种子通过不同 HMAC 标签派生公开 UUID 与私有 Session 假名密钥。两者都不来自 hostname、网络地址、git remote 或其他可识别来源，且已导出的 UUID 无法推导 Session 假名。
- **落盘与 API 均保持私有。** POSIX 读取要求当前用户所有且 group／other 均无权限；首次创建与共享轮换 claim 只发布完整的私有 inode。API 只返回公开 UUID 与用途限定的假名函数。
- **同步且记忆化。** 每个进程只解析一次已存储身份：读写都是同步的，结果按解析后的文件路径记忆化。
- **Best-effort 持久化。** 写入失败仍会为本次运行返回可用 id，遥测与反馈因此不会因 home 不可写而阻塞。
- **库而非插件。** 没有 Cordis 插件入口或配置；不变式伴生插件安装空安装器，因为本包不拥有任何事件流或公开可变关系，无法在不产生创建 id 这一副作用的情况下比较。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 库入口：私有根种子持久化、按域派生、`getOrCreateAnonymousIdentity` 与公开 id wrapper |
| [`src/invariant.ts`](src/invariant.ts) | 带空安装器的不变式伴生插件（无运行时不变式；唯一的关系是私有的且带副作用） |
| [`tests/anonymous-user-id.spec.ts`](tests/anonymous-user-id.spec.ts) | 已演练行为：确定性向量、旧格式轮换、持久化、权限、并发与记忆化 |
| [`tests/invariant.spec.ts`](tests/invariant.spec.ts) | 通过 invariants 服务注册伴生插件 |

### API

`getOrCreateAnonymousUserId()` 只返回派生的公开 UUID。`getOrCreateAnonymousIdentity()` 返回该 UUID 与 Session 专用假名函数；两个 API 都不会返回根种子或派生密钥。确切签名、测试 seam 与默认值见 `src/index.ts`。

### 存储约定

名为 `ANONYMOUS_USER_ID_FILE_NAME` 的文件包含一行带版本的 256-bit 根种子。首次创建会写入并 flush 一个同目录的随机 owner-only 文件，通过禁止替换的硬链接操作发布其 inode，移除临时名称，再安全重读发布结果。轮换会写入同类临时文件，并通过相同的禁止替换操作将其发布到确定性的 `.anonymous-user-id.rotate` claim 或采用已有 claim。每个相互配合的轮换进程都会在以原子方式把单一 claim 移到目标路径前立即检查目标；落败进程会安全重读胜者，进程终止后留下的完整 claim 则可由后续启动使用。POSIX 会在读取内容前拒绝暴露的 owner 或 mode；所有平台都会在不读取内容的情况下轮换超限普通文件。检查检测到被拒绝的目标或无效 claim 时不会修改目标；进程会在安全时使用共享 claim，否则回退到未持久化材料。记忆化按解析后的文件路径为键，因此每个 home 都会独立解析，热路径假名函数也不执行 I/O；有意共享或复制同一私有根种子的 home 会派生相同身份。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从 identity 组映射逐步进入本包所依赖的 home 路径解析，以及使用该 id 的功能。

- [identity 组映射](../README.zh.md)——兄弟包与组范围。
- [dsh-home-paths](../../util/home-paths/README.zh.md)——负责 `$DSH_HOME` 与 `~/.dsh` 的解析。
- [dsh-session-telemetry-otel](../../session/session-telemetry-otel/README.zh.md)——将该 id 作为 OTel Resource `user.id` 上报。
- [dsh-command-feedback](../../feedback/command-feedback/README.zh.md)——将 id 嵌入反馈确认。
- [dsh-llm-deepseek](../../llm/llm-deepseek/README.zh.md)——在提供方请求中发送 `x-deepseek-harness-user-id`。
- [会话遥测子系统](../../../docs/subsystems/session-telemetry.zh.md)——遥测 seam 及其后端约定。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该共享标识符只会作为模型不可见的 HTTP 元数据发送给 DeepSeek，且不注册任何面向模型的内容。

#### KV Cache 影响

无；该传输标头既不会改变 token，也不会改变模型可见前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明该 id 何时不合适或需要特别注意。它们是当前包约束，不是匿名性方案的通用对比，也不是任务积压。

- **删除后无法恢复**——文件丢失后会按设计生成新的匿名身份；恢复需要稳定的派生材料，这会削弱匿名性。
- **不安全的初始路径无法持久化**——最初被拒绝的目标、无效轮换 claim 或 claim 发布失败会让该进程使用未落盘根种子，并保持该目标不变。有效 claim 存在后，检测到目标检查或 rename 失败时会保留并使用该共享 claim。
- **能写 home 的进程仍受信任**——Node 没有按文件 device 与 inode 执行的跨平台 compare-and-replace 操作。能修改 harness home 的进程可以在最终检查与 rename 之间替换 identity 或 claim 目录项；rename 不会跟随符号链接或写入其目标，但可以替换该目录项。必须保护 home 目录，禁止其他用户与不受信任进程写入。
- **被中断的暂存可能留下私有残留**——清理前终止进程可能留下 owner-only 的随机 `.tmp` 同目录文件。identity 解析会忽略该名称；确认没有 harness 进程正在启动后，运维方可以将其删除。
- **Windows 隐私依赖 home DACL**——Node.js 文件 mode bit 不能证明 Windows ACL；新文件继承 harness home 的保护，因此运维方必须保护自定义 `DSH_HOME`。
- **不自动跨 home 关联**——独立初始化的 `$DSH_HOME` 值之间无法关联；复制或共享私有根种子会有意赋予它们相同身份。
- **已配置的 DeepSeek gateway 会收到该 id**——`dsh-llm-deepseek` 会把稳定标头发送至解析后的 `baseURL`（包括部署覆盖），且不受遥测共享模式影响。
- **删除文件不会重置当前进程**——记忆化会让本次运行的 id 一直保留到下次启动。
- **旧身份轮换一次**——无版本裸 UUID 已经公开，因此首次读取会创建新的私有根种子，同时产生新的公开 id。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
