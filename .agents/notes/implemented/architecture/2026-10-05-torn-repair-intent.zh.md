# Agent Note：崩溃持久的 repair intent 关闭撕裂尾重写窗口

Status: implemented

[English](2026-10-05-torn-repair-intent.md) | 中文

## Problem

JSONL 会话日志的撕裂最终 Zstandard 帧携带完整解码出的记录，却无法在物理上保留：帧字节本身结构不完整，写路径必须整帧截断并在第一次新批次之前持久重写这些恢复出的记录。该修复原本是两步序列——截断（fsync）→重写（fsync）——两步之间有崩溃窗口：截断提交后崩溃会抹掉恢复记录仅存的物理痕迹，下一次 open 看到的是更短的干净日志、无从恢复，静默丢弃了上一次运行已经提供给读方的事件。原始（未压缩）路径没有这个窗口：其截断点就是最后完整行边界，不携带任何可恢复内容。这是崩溃持久化一代落地后记录在案的 §46 截断窗口遗留项。

## Decision

用日志旁的两阶段 repair intent 关闭窗口。写句柄消费非空恢复的撕裂尾时，`truncateTornTail` 先把恢复事件记录到 `<log>.repair-intent`——经 `dsh-atomic-write` 的 `writeFileAtomic`（全新属主权限 inode，文件与 POSIX 目录均 fsync）——然后才截断；句柄的修改序列持久重写恢复记录，之后丢弃 intent（unlink+POSIX 目录 fsync）。open 时 zstd 解码把物理日志与幸存 intent 对账：撕裂帧仍在磁盘则以帧为准（intent 是同一次运行的重复记录）；日志干净则取 intent 中日志尚不包含的记录——按 seq 对比，重写自身又半途崩溃时只补缺失尾部——intent 中会话 id 不匹配以损坏拒绝。`fsyncDirectory` 为丢弃步骤从 `dsh-atomic-write` 导出。intent 名挂在日志路径后缀上，generation 发现、稳定读取循环与按 revision 键控的 memo（每次截断/丢弃失效，跨进程由日志 revision 探测兜底）都不会把它当作会话状态。

## Alternatives considered

把整份日志重写为一个原子世代替换同样能关闭窗口，但每次修复都要重写无界前缀；旁挂 intent 以 O(恢复量) 的代价原地修复。截断到撕裂帧内最后完整记录在构造上不可能：帧是一个压缩单元，其内部字节边界在磁盘上不存在。接受并记录该窗口是被本注记取代的现状——§46 禁止 silent drop。

## Consequences

修复序列的每个崩溃点现在都收敛：intent 写入后、截断后、重写后、丢弃后，下一次 open 恢复出同一份完整事件集（六个布局测试钉住这一点，含重复 intent、陈旧 intent、部分重写与异属 id 拒绝各例）。窗口期内读取经 intent 观察到恢复记录，与上一次运行提供的内容一致。不再修改的会话会在日志旁留下一个无害的幂等 intent 文件。§46 其余开放项（session-query-sqlite 派生索引原地重置与 storage-sqlite 版本不匹配拒绝打开）不变，仍待各自裁定。

## Open follow-ups

session-query-sqlite 的派生索引重置与 storage-sqlite 的版本不匹配拒开仍是记录在案的 §46 开放项；两者今天都不丢失唯一副本，但其 adjacent-generation 合规仍未裁定。
