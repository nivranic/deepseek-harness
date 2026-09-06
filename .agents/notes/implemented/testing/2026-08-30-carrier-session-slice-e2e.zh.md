# Agent Note: 载体级会话切片 e2e

Status: implemented

[English](2026-08-30-carrier-session-slice-e2e.md) | 中文

## Problem

Phase 1 的两份笔记延后了一个验收项：证明真实会话栈——随产品发布的 SessionController 与 Remote 流面——可以经真实 TLS 载体触达，而不是经由绑定在载体测试工装上的探针服务。在它跑通之前，"Native Access + Existing Gateway" 只在载体套件内对测试自有 Remote、在组合 e2e 内对不带载体的桌面网关分别证明过。

网关与 Link 包套件分别钉住首结果协调和授权，但没有随产品发布的组合测试把两个控制者和一个观察者接到一次真实宿主审批上。因此，多设备结算、失败方收敛以及持久单决策审计还没有贯穿完整 Loader、TLS、网关、Remote Event 与 Approval 路径得到证明。

## Decision

`apps/cli/tests/link-session-slice.e2e.ts` 启动随产品发布的 base + desktop 组合，并把 `DSH_HOME` 与所有 Link 后备文件钉入同一个临时 home。第一个场景保留与 LLM 无关的线缆核心：`remote` 设置开关绑定真实 TLS 载体；一个 Ed25519 控制者经 `/link/pair` 配对；该控制者经共享 `/api` 链触达 `session/list` 的真实归属方；`$events` NDJSON 流打开；独立开关关闭时，`$events/result` 被以 `forbidden`/`approval-disabled` 拒绝。

多设备场景开启该开关，让控制者 A 和控制者 B 经同一真实入口配对；由于产品配对配置只授予一个固定角色，观察者经随产品发布的 Device Trust 归属方注册；随后打开三条设备认证的 `$events` 流。一次真实 `ApprovalService.request` 驱动两轮测试。每轮临时包装宿主网关的 dispatch 方法：两条带签名的控制者应答都必须先通过 Link 交互校验、认领各自的客户端 generation，并到达包装层，任一请求才能进入网关结算。包装层随后按 A 先于 B、B 先于 A 的顺序放行。胜者与结算前已准入的失败方都收到 HTTP 200 和无值成功结果；失败方恰好收到一个 `cancel`；结算后发送的第三次应答被以 `forbidden`/`interaction` 拒绝。两个客户端投递都从网关待决集合中清除，会话只记录一对 id 匹配的 `approval/asked` 与 `approval/decided`，并携带胜者结果。

每轮失败都会把 dispatch 屏障永久切换为直通状态，使清理开始后才到达的应答也不会停车；随后释放已有闸门并恢复网关 spy，先关闭新的包装入口，再中止并等待两条 HTTP 请求。最后只等待已进入包装层的 dispatch 归零。套件清理等待流关闭和 Cordis dispose（资源释放）后才递归删除已知临时 home，在每条启动与清理路径恢复 `DSH_HOME` 的精确原状态，并聚合相互独立的清理失败。

## Consequences

随产品发布的宿主路径证明两种控制者获胜顺序、观察者拒绝、结算前已准入失败方的幂等成功、真正迟到应答的拒绝、失败方显式取消，以及持久审批恰好结算一次，而且没有新增第二个交互注册表或改变产品调度。网关仍是待决交互的唯一归属方；Link 负责认证、授权，并为每个已投递的客户端 generation 认领一条在途应答。这项验收不能替代 Host-to-Swift 或 Host-to-Kotlin 执行：它钉住这些原生客户端必须满足的载体行为。`prompt` 与模型取消仍不属于这个无 LLM 组合测试，并继续由各自的快照与跨语言验收归属方负责。

## Alternatives considered

仅依赖网关或 Link 包测试被否，因为两者都不启动用户实际发布的组合。仅在客户端排队应答 Promise 被否，因为它控制的是请求创建，而不是宿主准入：指定胜者可能在失败方越过 Link 待决交互检查之前就完成结算。让两个真实请求在没有宿主 dispatch 屏障的情况下竞争被否，因为调度次序会让断言的胜者不稳定。仅为测试增加运行时配对角色修改被否，因为配对角色属于部署配置；观察者经既有 Device Trust 归属方注册，而其看到的每个事件与尝试的每次应答仍经过真实 TLS 载体。扩展 `desktop-composition.e2e.ts` 被否，因为其冷启花名册断言不应拥有监听器、并发屏障与配对生命周期。
