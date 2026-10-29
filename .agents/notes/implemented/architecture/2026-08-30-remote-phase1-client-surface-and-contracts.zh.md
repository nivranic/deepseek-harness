# Agent Note: 远程 Phase 1 客户端界面、桌面组合与 link 契约

Status: implemented

[English](2026-08-30-remote-phase1-client-surface-and-contracts.md) | 中文

## Problem

Phase 1 的宿主侧（设置命名空间、可运行时开关的载体、`link` Remote 命名空间）没有客户端界面：方案要求的 Windows 配对 UX——启用跨设备访问、允许远程审批、设备名、配对二维码、受信设备管理器、LAN 诊断（方案第 42–43 章）——无处渲染，桌面 bundle 未挂载任何远程行，而 Phase 2 的 Swift/Kotlin 伴侣端在任何伴侣代码能被信任之前，需要先把线缆词汇表钉成生成式、受漂移门禁约束的模型（第 19 章）。

## Decision

ui-desktop 客户端插件在 General 分区拥有整个跨设备设置块，扩展现有设置行模式：两个布尔开关与设备名编辑器经共享 settings scope 绑定 `remote` 命名空间，一个设备块通过注入的 API 调用 `link` Remote 命名空间，其四个方法把生成的 `RemoteResult` 解包为值或抛出的 Error。配对对话框把一次性载荷渲染为二维码（`uqr` 渲染器，作为 devDependency 打进客户端产物）并附可选中的手动输入码；设备列表展示角色与最近连接，经同一 API 吊销；状态行携带 LAN 端点或绑定错误。组合仍是界面门禁：宿主未挂载 link 载体处各行渲染为空，桌面 bundle 现挂载全部四行——device-trust（惰性）、link-access（开关提交前不绑定）、link-settings 与 link 控制器——组合 e2e 由此端到端证明验收：命名空间默认全关、载体未绑定、`link/status` 经网关 `/api` 链本地应答、`link/createPairing` 以 `link-disabled` 拒绝、设备列表为空；远程 Allowlist 不收录任何 `link` 端点，已配对设备完全无法触达管理面。`dsh-link-contracts` 为原生伴侣端钉住同一词汇表：一张声明式类型表、满足协议类型的 zod schema、每个被测类型一个黄金 fixture、以及产出 manifest（含 fixture 校验和）、Swift `Codable` 与 Kotlin 数据模型的纯发射器；hygiene 聚合中的 `verify-link-contracts` 在表与已提交产物发生任何漂移时失败。

## Consequences

Phase 1 切片现在从设置开关一路跑到 TLS 监听器：拨动开关即绑定真实载体，其状态、配对与吊销呈现在同一设置页，由 34 项 ui-desktop 测试与扩展后的桌面组合 e2e 验证（ui-desktop 源码逐文件 100% 覆盖，顺带补上此前审计发现的覆盖欠账），以及 5 项覆盖 fixtures 与两种发射语言的契约测试。修正 ui-desktop 的依赖声明（静态客户端输入仅 dev、DSH 关系 peer+dev）后 `verify-client-packages` 在 dev 上重新变绿。延后到 Phase 2：消费生成模型的 Swift/Kotlin 伴侣应用、经载体的 SessionController 级会话 e2e、角色编辑与待配对取消列表。

## Alternatives considered

独立的 ui-remote 客户端包被否：各行共享 ui-desktop 的 scope 绑定、CSS、locale 命名空间与仅桌面的花名册席位，第二个包只会复制组合门禁而不删代码。基于转发事件的实时设备列表被延后——该块在挂载、拨动开关与每次变更后刷新，事件馈送本就属于 Phase 2 需要的会话流消费。从 Typert 生成器发射原生模型也在考虑后被延后：link 词汇表是手工钉住的契约表而非反射出的服务面，把发射器耦合到生成器会把每个 Remote 属主的类型都拖进伴侣端的 diff。
