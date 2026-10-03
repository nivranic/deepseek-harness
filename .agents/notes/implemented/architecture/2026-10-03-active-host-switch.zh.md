# Agent Note: 第 28 节 Host 切换窗口证据车道

Status: implemented

[English](2026-10-03-active-host-switch.md) | 中文

## 问题

第 28 节（规格 1093–1116 行）对 Host 切换提出三点：active Host 必须始终明确显示、切换进行中 Composer 禁用、绝不允许 UI 已显示 Host B 而请求仍发往 Host A。机制本身早已存在——composer 恢复门禁对每个非就绪 `ConnectionState` 阻断、能力事实派生自唯一的当前代、`retarget` 先于一切翻转所选 origin——但没有车道把切换窗口本身端到端钉住：既有 spec 分别覆盖 target 翻转、每次调用按所选 origin 取 URL 与静态能力矩阵，三者从未在一条车道里合流。

## 决策

- 两条证据车道，按依赖合法的层各一条。`packages/client/connection/tests/host-switch.client.spec.ts` 在真实 Connection 插件上挂一个门控、按 origin 读取的 generation source（Host A 立即准入；Host B 停在门上），走完整周期：A 就绪→`retarget` 到 B→退休→放门并在 B 上重建。订阅全部三个观察源（`target`、`generation`、`state`）的记录器在每次 flush 采样，断言两个被禁止的配对从不出现：新 target 与 A 的 generation 事实同框，或 B 的 generation 在路由仍指他处时出现。车道同时钉住接缝的同步性（`retarget` 调用内部 A 代已清）、切换开始后不再有任何面向 A 的连接尝试，以及 B 建立后名册当前行与所选 origin 一致。
- `packages/client/ui-conversation/tests/host-switch.client.spec.ts` 用真实 `createComposerControlSource` 走 api-gateway `$host` getter 在一次切换中产出的确切 Host 事实序列：A 的事实（从 ready 代展开的 descriptor 与 capabilities）、无代期间的稳定无能力壳、然后 B 的事实。`prompt` 走 true → false → true，每个能力面（interrupt、文件上传）只跟随当前代的事实，A 的留存快照在代迁移那一刻起不再 `current()`。InputBar 公式面（`controlAvailable: false` 即禁用）沿用 `input-bar.client.spec.tsx` 的既有覆盖。
- 保真说明：中途壳按 gateway getter 实际产出的成员书写（`home`/`platform` 为 undefined、无 `capabilities` 键），车道以与真实装配相同的结构性理由判 false。

## 备选方案

- **单条全链车道**（真实 Connection 插件 + 真实 gateway client Service + 真实 control source 同场）：该组合只存在于应用装配根；ui-conversation 不能依赖 gateway client service，gateway 也不能依赖 ui-conversation，单车道会越过 workspace 约束禁止的包边界。两层钉住的正是应用装配消费的同一组观察量。
- **派生一个 `switching` 观察量折进 InputBar 禁用条件：** 与两个自有观察量冗余。禁用已由恢复循环状态与 `controlAvailable` 合成，而 dedup 边角（状态发射被去重导致 generation 在 `retarget` 后存活）在有代存活时不可达：已发布的 generation 蕴含 controller 最后状态为 `ready`，因此 `retarget` 的 `reconnecting` 发射必然触发。第三个标志只会复制自有状态。

## 后果

- 第 28 节切换三连在 composer 实际消费的两层都有车道级声称；traceability 条目如实记录拆分，不伪称单一端到端车道。
- 无产品代码改动；两条车道均为增量证据，审计 client 清单从 43 文件 / 618 测试增至 45 / 621。

## 开放工作

- 真机、Swift 外壳、后台/推送行为与第 28 节其余验收仍开放；跨 origin 访问仍受页面策略约束（见 Connection README 切换接缝段）。
