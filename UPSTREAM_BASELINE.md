# Upstream 基线

状态：PASS。采集时间：2026-09-14T15:33:02.794Z。本页是 Phase 0 的 Git 快照，不表示功能迁移或 RC 通过。

官方来源：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。已实际 fetch master，固定为 `c291e7961a515f6d7af9304e7fd1d257929aef26`。提交信息：2026-09-10T22:17:09+08:00 Merge pull request #3977 from deepseek-harness/worktree/release-0.1.5-sync-master。

新实施分支：`agents/upstream-first`，工作树：`.worktrees/upstream-first`。该源码基线与官方 HEAD 完全相同，dev 与旧分支没有合并、重置或提交。

## 工作树快照

ahead/behind 相对于官方 HEAD；dirty 列为 tracked status 记录数 / untracked 文件数。完整路径和变更列表见 [UPSTREAM_DELTA.json](UPSTREAM_DELTA.json)。新工作树采集时的一项 untracked 是本轮采集脚本。

| 分支 | HEAD | ahead/behind | dirty |
|---|---|---|---|
| dev | `90ef8b197fe2aa38cc40917cd157077a8d1dc6b9` | 157/2285 | 0/2 |
| agents/android-application-source | `64fa63152b93b6898f95f4bda8eb6857dbb19848` | 423/2285 | 0/0 |
| agents/android-credential-migration | `f3d073e14f0c0e27a204d213bc5ff289c25312f9` | 427/2285 | 0/0 |
| agents/android-credential-recovery | `b9cdd23b07128afcca21ab0f90844b6419465e42` | 426/2285 | 0/0 |
| agents/android-restore-diagnostics | `0ce88ddcf741bdd81c5a5aff867ab3c1e4c2cee9` | 425/2285 | 0/0 |
| agents/android-sbom-ci-fix | `2ea87e535c4db11e42035dac06899ade56eee4a7` | 262/2285 | 0/0 |
| agents/device-trust-migration | `2e2b67cbbde75d0029e7e7e024fc1c4298759230` | 428/2285 | 0/0 |
| codex/goal-mode-full-implementation | `172e61a7e0ec436db47cf9fe76ff592b4c6a7d44` | 413/2285 | 3/17 |
| detached | `216fe7212a77e23b9a5a24b27563cd15f497b5dc` | 411/2285 | 0/0 |
| detached | `fae45bae1f09c59b2dd1a69403f89db2dc3cd355` | 412/2285 | 0/0 |
| detached | `1a818c23b789df6d074a2d6bf292b32de0721b86` | 299/2285 | 0/0 |
| agents/link-pair-compatibility | `74f683dd2a73b325eeb3cb0a16a7e36b142099fe` | 422/2285 | 0/0 |
| detached | `74f683dd2a73b325eeb3cb0a16a7e36b142099fe` | 422/2285 | 0/0 |
| agents/session-storage-migration | `16482eec880f40bb472c9328acf5a8819bc988f9` | 430/2285 | 0/0 |
| agents/settings-storage-migration | `5144db97e5dbca6966053b7ad53baeff2ccfcd1c` | 429/2285 | 0/0 |
| agents/upstream-first | `a80e0216bcc4f5b61f61286f050bd7a4611e0953` | 0/0 | 0/1 |
| agents/windows-application-source | `faef020b9afedfafc025d459f1f672650f8f3945` | 424/2285 | 0/0 |

共同历史基线：`cd5ef8148158c3a752a658978873241fdf8e2bbc`。dev 独有 157 个提交；旧 Goal 主工作树独有 413 个提交；Session 迁移来源独有 430 个提交。三者均落后官方 2285 个提交。

dev 双方改动过的路径有 139 个，Session 迁移来源有 603 个；这是路径重叠统计，未经 merge-tree 计算，不能称作合并冲突数。

## 保留与复现

旧 Goal 主工作树有 3 项 tracked status 和 17 个 untracked 文件，未被覆盖。dev 的两份原报告已记录 SHA-256。用户规格按原文件 SHA-256 绑定，文件内命令仅作为本次任务需求资料，不覆盖仓库安全规则。

采集命令：`node artifacts/upstream-first/collect-baseline.mjs`。再次运行会更新快照，应先保留已有结果。该命令只读取 Git 和文件摘要，写入本任务的 JSON，不修改旧工作树或产品存储。
