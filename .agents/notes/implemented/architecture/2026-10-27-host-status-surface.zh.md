# Agent Note：Web 设置的宿主状态分区呈现 §41 就绪判定

状态：已实现

[English](2026-10-27-host-status-surface.md) | 中文

## 问题

§41-44 家族行把「宿主侧就绪判定面」留在开放清单上。判定的宿主侧早已完备——`hostDiagnostics/health` 应答 §41 六组件加派生的 `ready` 字段，Android 伴生端也在上一代学会了收集它——但没有任何宿主操作者呈现面消费它：全仓检索发现 `hostDiagnostics` 的消费者只有伴生端、api-catalog 投影和包内 spec。官方 Web 客户端什么都不渲染：一个模型提供方没有注册任何 provider 的宿主（按宿主自己的派生无法接受 Agent 请求）的用户，在产品 UI 里看不到这个判定及其原因。

## 决策

新增 Web 设置分区 `ui-settings-host-status` 渲染该判定。它无条件注册一个 `settings.section` 贡献（`id: 'host-status'`、order 16，位于 Hosts 与 Telemetry 之间）——hostDiagnostics 是每个设置面宿主都组合的唯一 Remote 命名空间，没有能力可观察，无法应答 `health` 的宿主通过分区自己的错误行加重试呈现，而不是让导航项消失。数据面是一个注入函数 `health(): Promise<HealthSnapshot>`，注册侧适配器解包生成客户端的 `RemoteResult`（`ok: false` 即拒绝，使全部拒绝形态都落进组件唯一的错误态）。判定行显示快照里宿主自行派生的 `ready` 字段——分区绝不在客户端重推导就绪，行与判定因此永不分歧——连接行被明确记录为刻意排除在该推导之外（没有网络载体的宿主是合法部署形态）。六个组件行各携带组件名、映射为 `up → done`、`degraded → warning`、`down → error` 的状态点（`ongoing` 保持保留给进行中的过渡；§41 的 `degraded` 是已稳定的部分失败），以及该组件自己的非敏感 `detail` 原文。显示列表与字典键都派生自 `keyof HealthSnapshot` 去掉 `ready`，因此宿主侧重命名组件会使本包构建失败，直到行与文案跟随。`hostDiagnostics` 命名空间本身现在经 `dsh-api-remotes` 聚合抵达客户端：聚合既 `$mount` 该贡献、又再导出其声明合并（`export type {} from '@deepseek-ai/dsh-api-host-diagnostics/remote'`），消费程序里 `ctx.remote.hostDiagnostics.health()` 能通过类型检查正依赖于此。

## 考虑过的备选方案

仅当宿主通告能力时才注册分区（telemetry 分区的模式）被否决——hostDiagnostics 对设置面宿主不是可选件，消失的导航行恰恰藏起了分区存在要展示的失败。从六行数据在客户端重推导判定被否决——两份推导会漂移；宿主的 `ready` 是权威，分区只陈述它。经转发事件流实时刷新被延后而非采纳——今天不存在 `hostDiagnostics/health` 变更事件，分区进入时读取一次、经重试重读，无实时刷新的限制已记入 README。把呈现面挂成 plugins 分区内的标签页被否决——就绪是宿主整体事实，不是插件域细节。

## 后果

Web 设置获得宿主状态分区：判定行加六组件行，两种发行语言齐备，并携带 `data-host-ready` 与逐行 `data-component`/`data-component-state` 测试钩子。client slot catalog 再生成收录新占位行并通过新鲜度校验；remotes 聚合多携带一个命名空间与一条类型再导出；client typecheck 聚合引用新包。包内 spec 覆盖全绿快照、modelProvider degraded 与 sessionStore down 的判定翻转、读失败后经重试恢复、忙碌加载形态与两份字典的完整性。本代之后 §41-44 家族仍开放：sanitizer 审计与同候选 support-collector 验证。
