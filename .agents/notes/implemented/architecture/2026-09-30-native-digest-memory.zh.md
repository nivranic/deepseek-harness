# Agent Note: companion 跨自身进程重启持久化已上传文件摘要

状态：implemented

[English](2026-09-30-native-digest-memory.md) | 中文

## 问题

Android companion 只在进程内存里记忆已上传摘要。系统杀死并重启应用后，重传 Host 已存储的正文在记忆重新学到摘要之前又要付一次全额传输——这正是去重路径要防止的损失。

## 决策

给摘要记忆一个持久的、提示性的独立归宿：

- `NativeUploadDigestMemory` 是 core 层接口（`load()` 旧者在前，`remember(digest)` 记为最近）。`FileNativeUploadDigestMemory` 存储有界明文 JSON 文档（version 1、容量 256、仅接受小写 hex SHA-256），以同目录原子替换写入。文档缺失或损坏按空读取——代价是一次完整上传，绝不是一次被阻塞的上传。
- `NativeFileAttachmentsModel` 接受可选记忆，用 `load()` 播种进程内集合，并在每次完整上传成功后持久化摘要。去重命中不刷新磁盘：该摘要已被记忆。
- `CompanionModelSet` 透传记忆；应用装配为每个已恢复安装一个（`CompanionRuntime.uploadDigests`，restore 目录下的单个 `upload-digests.json` 惰性单例），注入两处 model-set 构造点。未配对状态读取为无记忆。

## 备选方案

- **扩展加密输入快照（v3 文档）：**该文档是固定字段集的用户输入，且对旧格式执行拒绝策略；把提示性缓存挂在上面会让缓存更迭耦合用户数据兼容性。
- **按 principal 分文件记忆：**内容寻址使摘要对任何存储该对象的 Host 都有意义；探测错 Host 只是一次经既有回退的被拒往返。留作开放项。
- **每次去重命中都 remember：**每次命中写盘只买到容量窗口内的近度排序。

## 结果

- 重启后的 companion 对此前已存储正文的首次重传实现零全额传输去重。
- 记忆是尽力而为：删除、损坏或清空应用数据都退回既有行为。
- 验收 APK 已随改动重建，真实 Host 重启 e2e 保持绿，持久路径与已封存的上传去重语义可组合。

## 未竟工作

- 按 principal（按 Host 身份）的记忆作用域；按真实使用调优的容量与逐出策略。
- 浏览器 Client 仍只有页面作用域记忆；存储级浏览器记忆未探索。
