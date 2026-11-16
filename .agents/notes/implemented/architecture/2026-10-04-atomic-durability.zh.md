# Agent Note: 原子替换与保留旧代的平铺迁移

Status: implemented

[English](2026-10-04-atomic-durability.md) | 中文

## 问题

第 46 节要求持久化写入相邻、原子、可恢复且崩溃安全，并在启动迁移期间保留源文件。文件替换与迁移保留各有拥有方。共享原子写入器暂存并重命名完整内容。凭据迁移还必须在替换前保留预发布扁平文档。

## 决策

凭据迁移在写锁下，先以仅属主权限将扁平原文写入 `<file>.migration-v0.bak`，然后替换文档。重迁移写入相同备份字节。已迁移文档的后续启动保持备份不变。

采纳的 `writeFileAtomic` 实现使用独占临时兄弟文件、调用方指定权限及带 Windows 有限重试的原子重命名。它不对文件或目录执行 `fsync`。Storage JSON 与 JSONL 拥有各自的同步发布协议，其保证只覆盖各自的消费方。

`credentials-local/tests/migration.spec.ts` 检查逐字节保留、POSIX 仅属主权限及二次启动后备份不变。`atomic-write/tests/atomic-write.spec.ts` 覆盖完整替换、权限、符号链接处理与重命名失败。断电恢复需要独立的平台证据。

## 备选方案

常规 settings 更新使用原子替换。凭据布局迁移额外保留源文件，因为 schema 转换需要操作者可恢复的前代。存储专有的同步写入器各自负责发布与恢复。

## 后果

凭据启动迁移在转换后的文档旁留下可恢复源文件。Settings 与 credentials 继承共享写入器的原子替换。崩溃持久性与 Windows 仅属主 ACL 强制仍超出该写入器的保证。

## 开放跟进

通用写入器崩溃持久性、session-query-sqlite 的派生 schema 重置与 storage-sqlite 的版本拒绝仍各有待审事项。[JSONL 持久化](../../../../packages/session/session-persistence-jsonl/README.zh.md) 拥有撕裂尾修复及其保留的修复意图。
