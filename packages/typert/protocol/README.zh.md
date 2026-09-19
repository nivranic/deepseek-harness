---
description: "共享的 Typert Remote 协议：业务包、生成产物、Host Gateway 与 Client API 使用的装饰器、wire 描述符、编解码器与提供方约定。"
kind: "package-library"
---

# @deepseek-ai/dsh-typert-protocol

[English](README.md) | 中文

## 概述

借助 `dsh-typert-protocol`，业务包可以向 Remote 客户端暴露 Host 方法：用 `@Remote`（作用域接收者用 `@RemoteScope`）标记方法，把服务绑定到 wire 命名空间，并通过可合并扩展的协议映射把 Host 对象与作用域 Context 关联到 wire identity。生成产物、Host Gateway 与 Client API 消费同一套调用描述符、编解码器与提供方约定，因此一套声明在每个 face 上保持一致。本包不注册任何 Cordis 服务，也不运行 TypeScript 分析；它只声明类型与装饰器标记。

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

本包供向 Remote 客户端暴露 Host 能力的业务包与装配维护者使用。它是一个声明库：标记方法、绑定服务，其余交给生成的流水线与 Gateway。

### 暴露 Host 方法

业务包用 `@Remote`（当接收者来自作用域 Context 时用 `@RemoteScope(key)`）标记一个公开实例方法，所属服务要么继承 `TypertRemoteService`，要么通过 `bindTypertRemote()` 声明 `typertRemote` 绑定：

```text
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export class GoalService extends TypertRemoteService {
  @Remote
  async create(agentId: string, objective: string): Promise<GoalResult> {
    ...
  }
}
```

生成会把方法变为服务命名空间下的 wire 端点；Client 通过 `ctx.remote` 以类型化方法调用它（见 [API Gateway 参考](../../../docs/api-gateway.zh.md)）。方法把 `signal: AbortSignal` 声明为最后一个参数即可选择协作式取消——该信号是注入的，绝不会成为 JSON 参数或查找字段。

`bindTypertRemote` 与 `TypertRemoteService` 在 `namespace` 之外接受显式的 `capabilities` 声明。每个带版本的 id 都列出该 owner 必须导出的方法。[Gateway](../../api/gateway/README.zh.md)读取其当前可用性；声明不授予调用方权限，也不从名称推断能力。

### 把 Host 对象与 Context 关联到 wire identity

复杂的 Host 对象不能直接跨 wire 传输。业务包通过可合并扩展的 `TypertLookupMap` 与 `TypertContextMap` 声明关联。Host Context 适配器拥有稳定 wire 声明，并把 wire identity 解析为活跃 Context。Client Context 适配器需要双向映射，因为作用域调用从 Client Context 发起，而转发的 Host 事件要在 Client 侧解析其显式 wire identity。Host 组合可以覆盖其同步或异步解析器。因策略原因拒绝解析的解析器会抛出带有自身错误码的 `RemoteError`，该码原样到达调用方。

### 报告与读取 Remote 失败

所有 Remote 失败都由一个类承载：`RemoteError`，携带稳定的 `<domain>/<reason>` 码，以及按该码定型的 details。本包声明通用载体码（`gateway/bad-request`、`gateway/cancelled`、`gateway/internal`），并拥有 `RemoteErrorDetailsMap`——可合并扩展的码表，其他每个包都在自己的抛出点旁扩展它：

```text
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested Goal is unavailable. */
    'goal/not-found': { readonly goalId: string }
  }
}
throw new RemoteError('goal/not-found', `goal "${id}" does not exist`, { goalId: id })
```

拥有方在失败点直接抛出；没有任何包再写错误类家族或出口映射函数。调用方按 `code` 判别——绝不用 `instanceof`——且 `code` 分支无需 cast 即收窄 `details`，因为 `RemoteFailure` 就是 `RemoteError` 实例按码判别的 union。需要识别跨模块或跨 realm 类副本传来的失败时，基础设施调用 `remoteErrorOf(value)`，它读结构标记而不是原型链。

导出的[已知错误码 JSON Schema](remote-error-codes.schema.json) 列出本包构建对应的有限仓库词汇，保留各拥有方的 JSDoc 语义和源声明。使用 `pnpm run gen-remote-error-codes` 再生成；`verify-remote-error-codes`、`test:docs` 和 `doc-sync` 拒绝过期产物、重复拥有方、缺少说明的码与无界声明。它只识别错误码字符串：TypeScript details 注解不是用于 payload 验证的 JSON Schema。来自新版 Host 或外部插件的未知码仍是不透明诊断；保留 code、message 和 details，不据此推断恢复策略或权限。码属于该 schema 不表示对应能力已经挂载。

[Remote 失败 JSON Schema](remote-errors.schema.json)验证 `code`、`message` 与对象 `details`。已知码选择生成的详情 schema；未知码保留不透明的对象诊断，非法的已知码不能使用该兜底分支。输入验证接受扩展字段，不修改原始诊断。通过 `pnpm run gen-remote-error-envelope` 重新生成；`doc-sync` 中的 `verify-remote-error-envelope` 校验独立清单、解析后的详情根、跨面一致性和产物新鲜度。参见[生成器 API](../generator/README.zh.md#analyzing-a-workspace-statically)。当前转换器省略元组元素数量约束，因此元组详情会使生成失败。消费方需要支持 `not` 的完整 draft-2020-12 验证器；Zod 的 JSON Schema 反向转换不支持该关键字。

`classifyRemoteFailureCode(code)`——对已捕获的值使用 `classifyRemoteFailure(error)`——把错误码映射到全部 Client 共享的封闭 `RemoteFailureClass` 呈现语义：`authentication`、`permission`、`host-state`、`compatibility`、`carrier-invalid`、`transport`、`conflict`、`unavailable` 与 `unknown`。分类只收录已有跨 Client 一致含义的码；可合并扩展的词汇表有意把其余的码（包括所有未来码）留在 `unknown`，按不透明诊断呈现，不推断恢复动作或权限。仓库 `verify-remote-error-envelope` 门禁拒绝引用未声明码的分类。

`gateway/bad-request` 可携带 `RemoteValidationIssue` 条目，字段为 `code`、`message` 与 `path`（字符串键或数字索引）。拥有方通过 `remoteValidationIssues` 从验证器结果复制这些字段；symbol 路径键转为诊断字符串。验证器专用元数据和输入值被省略。诊断文字仍由拥有方提供，此辅助函数不对消息脱敏。

### 在 Client 侧接收转发的 Host 事件

Host 装配以转发给消费方的 Cordis 事件扩展 `TypertRemoteEventSelection`，从而收窄 `ctx.remote.$on` 的键集。`TypertForwardableEvent` 接受无作用域且返回 `void` 的通知，以及最后一个 `next()` 回调返回事件结果类型的异步作用域 waterfall（瀑布式事件）。`TypertClientEventListener` 从同一条 `Events` 成员派生 Client listener，并保留 signal、可选和只读字段、数组、回调与结果类型。`TypertClientRemote` 只公开 `$mount()` 与 `$on()`；事件传输仍由 Gateway 私有持有。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释声明如何保持与编译器无关，以及每个约定在哪里执行；编程模型已在[使用本包](#use-this-package)中说明。

### 设计理念

本包把严格反射留在编译器中：装饰器初始化器把最小标记保存在 Service 原型上的带版本描述符中。描述符使用稳定的字符串属性名，因此协议包的另一个已安装副本也能读取同一组标记。完整的参数、结果、查找与 schema 反射是 Typert 构建流水线的职责，通过 `InvocationDescriptor` 交付。

### Remote 标记

`@Remote` 与 `@RemoteScope` 调度一个初始化器，把方法名、可选导出名与调用模式追加到原型描述符；`remoteMethods(service)` 校验其版本，并返回与已存描述符分离、按声明顺序排列的快照，供 Gateway 的源码模式回退读取。标记要求名称为字符串的公开、非静态实例方法，同一方法上的冲突标记会被拒绝。

### 协议映射与描述符

可合并扩展的协议映射在类型系统中保留静态关联，运行时提供方则向 `ctx.typert` 注册解析；映射的名称与形状见 [`src/types.ts`](src/types.ts)。`InvocationDescriptor` 是注册表、Gateway 与 Client Remote 共同消费的共享运行时形式，涵盖直接与 Context 接收者、JSON 与查找参数、作用域投影、取消与结果编解码器。

### Wire 标识文法

每个命名空间、方法、查找与 Context 段都必须满足 `isTypertRemoteSegment()`，生成的名字才能原样跨共享 RPC 载体传输。严格编解码器携带生成的 schema；`src-json` 编解码器标识约束更弱的源码启动路径。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 装饰器、Gateway 绑定、`remoteMethods`、段校验 |
| [`src/remote-error.ts`](src/remote-error.ts) | `RemoteError` 与结构式识别函数 `remoteErrorOf` |
| [`src/failure-classes.ts`](src/failure-classes.ts) | `RemoteFailureClass`、`classifyRemoteFailure*` 与经清单校验的分类映射 |
| [`src/types.ts`](src/types.ts) | 协议映射、`RemoteErrorDetailsMap`、`RemoteResult`、`InvocationDescriptor`、编解码器、提供方约定、注册表接口、`TypertClientRemote` |
| — | 不发布运行时不变量伴生入口；decorator 只保留私有不可变声明，binding 也是冻结值，没有可供交叉核对的独立事件流。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面；它们从声明逐步进入运行时与调用路径。

- [API Gateway 参考](../../../docs/api-gateway.zh.md)——声明如何成为实际的 Host 到 Client 调用。
- [Typert 子系统参考](../../../docs/subsystems/typert.zh.md)——从协议与 Gateway 类型记录的字面公共约定。
- [Typert 注册表](../registry/README.zh.md)——描述符与提供方在运行时存放的位置。
- [Typert 生成器](../generator/README.zh.md)——生成消费方声明与描述符的包。
- [Remote 调用 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.zh.md)——Remote 调用背后的架构与传输决策。

-----

<a id="model-experience"></a>
## 模型体验

无，因为与编译器无关的 Remote 协议声明不注册任何面向模型的内容。

#### KV Cache 影响

无直接影响；声明的约定只有在装配将其放入请求时才会触及请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明声明能表示什么；它们是当前包约束，不是任务积压。

- **装饰器标记是最小化的**——标记只包含方法名与直接调用或 Context 调用模式；参数、结果、查找与 schema 反射需要 Typert 构建流水线。
- **Remote 签名受限**——装饰器只接受具有字符串名称的公开、非静态实例方法，源码模式执行无法表示重载、解构、默认参数或剩余参数签名。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
