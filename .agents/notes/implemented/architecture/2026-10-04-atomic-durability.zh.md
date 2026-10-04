# Agent Note: 崩溃持久的原子写入与保留旧代的平铺迁移

Status: implemented

[English](2026-10-04-atomic-durability.md) | 中文

## 问题

第 46 节要求持久化写入 adjacent、atomic、recoverable 且 crash-safe，并禁止启动时覆盖用户唯一副本。对全部持久化写路径的只读测绘发现：会话日志后端已满足该子句全部要求，但共享 `dsh-atomic-write` 原语下的两个面不满足——`writeFileAtomic` 落临时文件后直接 rename、没有任何 `fsync`（其源码 TODO 自认崩溃持久性不在范围内），因此 `settings.yaml` 与 `.credentials.yaml` 的每次写入在崩溃后都可能被观察到回退；且凭据启动时对预发布扁平布局的升级会原地重写秘密文档的唯一副本，任何地方都不保留旧代。

## 决策

`writeFileAtomic` 现镜像 `dsh-storage-json` 已交付的 crash-safe 协议：独占创建的临时文件先写入、fsync、关闭，然后才 rename 提交，POSIX 上随后 fsync 父目录（Windows 拒绝 `O_RDONLY` 目录打开；该平台以原子 `MoveFileExW` 替换承载提交，目录条目交给平台——记为包的剩余限制）。凭据扁平布局迁移按子句保留旧代：扁平原文在唯一副本被替换之前先写为 `<file>.migration-v0.bak`（仅属主权限，本身也经现在持久的写入器），重迁移重写同一备份字节，已迁移文档的后续启动不动备份。

验证：`atomic-write.spec.ts` 新增记录顺序用例断言临时文件 fsync 先于 rename 提交（既有 `node:fs/promises` mock 骨架包装 `open` 并记录句柄 `sync` 与 `rename`），以及失败用例断言 rename 前 fsync 出错会移除临时兄弟文件、目标旧内容完好；`migration.spec.ts` 新增保留用例（备份逐字节一致、仅属主权限、二次启动不动）。车道：atomic-write 15（一例预存在 Windows symlink-EPERM，stash 探针实证 HEAD 基线）、credentials-local 104+1 跳过、settings-file 45+2 跳过（其 lock-race 中途失败注入点从模块级 `writeFile` 迁至新写入器的句柄 seam——行为同、接缝新）、app-boot/host-description/llm-deepseek/agent-presets 739（agent-presets 一例 dangling-install-link 为 stash 探针实证的 HEAD Windows 基线）。

## 备选方案

每次写入都备份 settings 文档被否决：例行的 settings 更新不是迁移，rename 原子替换加 fsync 已保证「完整旧文或完整新文」——保留义务属于这两个面上唯一的真迁移（凭据布局升级）。让 `fsyncDirectory` 在 Windows 上抛错被否决，改循 storage-json 先例的平台守卫：持久性收益在文件 fsync，它在所有平台都成立。把 storage-sqlite 的版本不匹配拒绝与 session-query-sqlite 的原地派生重置重建为 adjacent 迁移被推迟：前者是无可迁移对象的未发布 schema，后者是日志之上可重建的读模型（持久后端已保全日志）——两者都如实记录为 §46 开放项而非静默宣称。

## 后果

每个 `writeFileAtomic` 消费者（settings、credentials 及同乘该原语的四个包）无需任何调用点改动即获得崩溃持久性。凭据启动迁移现在在迁移文档旁留下运营者可恢复的旧代。两包 README 的持久性契约在双语中翻转，Windows 目录 fsync 缺口与 Windows ACL 权限问题记为剩余限制。

## 开放跟进

session-query-sqlite 的破坏性原地 schema 重置、storage-sqlite 的无迁移版本拒绝、JSONL 撕裂尾修复的截断窗口仍为 §46 开放项，留待后续裁定；它们今天都不丢用户数据（重置从保全的日志重建、拒绝响亮失败、修复重写恢复事件），但均未达完整的 adjacent/保留旧代标准。
