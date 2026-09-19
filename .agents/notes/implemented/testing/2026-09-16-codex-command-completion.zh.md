# Agent Note: Codex fixture 在命令退出后完成

Status: implemented

[English](2026-09-16-codex-command-completion.md) | 中文

## 问题

Codex 仍持有 yielded 命令时，脚本模型就可能宣布完成。文件存在断言随后会与命令竞争，提前写入也可能掩盖命令最终失败。重复使用 function call id，还会使多次请求的 fixture 无法将结果归属到产生它的命令或轮询。

## 决策

[Responses fixture](../../../../packages/subagent/subagent-codex/tests/responses-fixture.ts)为每次发出的 function call 分配独立 id。命令完成行为只接受最新发出 id 对应的唯一结果。运行中的 session 会触发已声明的 `write_stdin` 调用，参数使用返回的 session id；每次轮询获得新的 call id。只有命令元数据在输出区域之前明确给出退出码零，才允许完成。缺失、重复、无关、失败或矛盾的结果使 fixture 失败；命令打印的文本不能提供退出状态。

[真实 Codex 命令测试](../../../../packages/subagent/subagent-codex/tests/real-product.spec.ts)保留固定版本 CLI 和本地 Responses 服务器。yielded 用例通过私有工作区文件阻止命令继续。测试只有在观察到轮询结果后才释放该文件，随后核对最终文件内容和受管进程退出。这种方式观察实际 yielding，无须假设固定等待长于启动时间。[既有清理决策](2026-09-07-subagent-teardown-test-budgets.zh.md)继续负责清理顺序和执行 lane 的预算。

## 考虑过的替代方案

**请求命令后立即发送完成。** 这只能证明脚本模型已回答，即使进程仍在运行或随后以失败状态退出。

**在任意工具输出中搜索退出码零。** 先前命令、无关 call id 或命令自身打印的文本都可能满足搜索。元数据和结果归属必须同时一致。

**增大命令后的等待。** 更长的暂停仍不能证明命令已结束。文件屏障和返回的进程状态提供所需观察。

## 影响

fixture 元数据解析明确遵循固定版本 Codex 的工具格式，格式变化时直接失败。HTTP 测试覆盖重复轮询、唯一 id 和拒绝场景；实际 CLI 在隔离工作区验证命令执行与清理。变更仅影响测试基础设施：provider 代码、CLI 版本、权限模式、生产超时和 Session 输出保持不变。本地 Responses fixture 不能替代真实模型 provider 或其他操作系统验收。
