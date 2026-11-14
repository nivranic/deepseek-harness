# Agent Note: Client 包把共享面走 contract 层路由

Status: implemented

[English](2026-10-07-client-domain-graph.md) | 中文

## Problem

`verify-client-domain-graph` 按三层模型（contract/ 共享 API、域实现、apply/index 组装）执法时存在 37 处存量违规，分布在两个包：ui-sidebar-documentpreview 33 处（八个格式域 import document 域的 contract/registry、diff 域 import code 域的语言表、四个顶层非组装文件 face/store/rpc/TextPreview import 域实现）与 ui-conversation 4 处（skeleton 域的 InputBar import input 域的编辑器组件与提交策略）。违规早于门禁模型存在，两包均作为卫生基线挂账。

## Decision

1. **ui-sidebar-documentpreview**：新建 `src/client/contract/` 层逐字承载共享面——document/contract、document/registry、document/sniff、bytes/transfer、code/languages、text/lines 迁入；三个 body-id 常量收进新 `contract/body-ids.ts`，text/image/binary 域 index re-export。十七处域间 import 与十六处顶层→域 import 全部改指 `contract/*`；顶层四件保持顶层（移入任一域会立即从今天合法引用它们的域产生九处新违规）。document 域只留 `admission.ts`；bytes 域消失。
2. **ui-conversation**：`resolveSubmitMode` 移入既有 `contract/composer-submission.ts`（其类型契约本就在此），`input/submission-policy.ts` 留一行 re-export 使两个 spec 零改动；唯一生产消费者是 skeleton InputBar 的三个编辑器文件（`ComposerContentEditable`、`DecoratorPortals`、`keymap`）移入 skeleton 域。任何 contract 层不进 React 组件——九包先例保持 contract/ 仅为 .ts 共享 API。
3. SlotMap 声明的目录段变化触发 client slot catalog 再生成。

## Alternatives considered

- **contract/ 里建 re-export 桶**：拒绝——contract/ import 域本身就是新违规；检查器对 contract→域的边不豁免。
- **把四个顶层机制文件移入域或 index.ts**：拒绝——face/store/rpc 是 owner 侧机制，域今天合法地引用它们（域→顶层允许）；搬走会立即产生九处新违规并撑爆组装壳。
- **编辑器组件放 contract/**：拒绝——contract 层承载类型、slot 与纯函数；组件住在消费它的域里。

## Consequences

门禁输出 `client domain layering clean`（37→0），两包套件全绿（documentpreview 380 过+下述既有本地 pdf-license-bundle npm-pack 超时钉死；ui-conversation 465 过），两包叶 tsc 干净。约二十个 documentpreview 测试文件机械改 import 路径；`lines.client.spec.ts` 因 TextPreview 保留 re-export 而零改动。审计世系中一个测试（`keymap-routing.client.spec.tsx`）只改了 import 路径，87 文件/1073 测试的审计计数保持稳定。

## Open follow-ups

- pdf-license-bundle spec 在干净 HEAD 上本地同样失败（spawnSync 约 5s 预算对上 lib/ 存在后的 17.2s 本地 `npm pack`）；它不在审计世系内且 CI 绿——记为宿主时序基线，本代不修。
- file-upload `admitEncodedImages` 分类裁定保持开放（依赖策略文件明令禁止自动化代理添加例外）。
- loader-composition e2e 基线（同意设置点+未定位的 Windows `.sessions` 行为）保持开放。
