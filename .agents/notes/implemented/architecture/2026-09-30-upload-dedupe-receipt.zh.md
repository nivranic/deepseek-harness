# Agent Note: 上传去重：按摘要重新暂存已存储文件而不再接收字节

状态：implemented

[English](2026-09-30-upload-dedupe-receipt.md) | 中文

- **日期：**2026-09-30
- **范围：**§35 File/Artifact（上传路径上的中断传输 / 大文件）、§21 设备权限、§28 附件流程
- **领域：**`dsh-attachment`、`dsh-attachment-local`、`dsh-client-file-upload`、Android companion core

## 问题

Host 进程被 SIGKILL 重启（或收据丢失后 companion 的任何重连）会使全部暂存上传回执失效（`FILE_NOT_STAGED`），而已上传字节仍持久保存在 `<DSH_HOME>/attachments/v1` 下且内容寻址 `attachmentId` 不变。既有恢复路径必须重发完整文件体：Host 没有能把摘要换回引用的查询，Android companion 也没有可用的请求方式。

## 决策

新增按摘要寻址的暂存操作，而不是扩宽既有上传：

- `AttachmentStore.ensureFileByDigest(digest, name?)` 加入能力 seam。摘要只负责定位对象；本地实现对存储对象重新哈希（`digestFile`），摘要不匹配按未命中处理，再经既有 `publishImmutableAlias` 发布净化后的显示名别名。seam 默认实现返回 `undefined`，非本地后端不受影响，调用方回退完整上传。
- `FileUploads.uploadDedupe({ digest, name? })` 是能力 `file-upload.dedupe.v1` 下的新 Remote 操作，要求 `prompt.send` 权限。它在 wire 边界校验摘要为小写 hex SHA-256（`FILE_DIGEST_INVALID`），在任何存储查询之前拒绝子代理会话，未命中以 `FILE_DIGEST_NOT_KNOWN` 应答，命中时通过与完整上传相同的 `commit()` 暂存已验证引用——回执绑定、退休与 prompt 准入语义完全一致。
- Android companion 对每个准备好的 FILE 上传计算 SHA-256，并在本进程内存（模型锁保护）中记住成功上传过的摘要。重上传已记忆字节时先探测 `uploadDedupe`；`FILE_DIGEST_NOT_KNOWN` 与 `file-upload.dedupe.v1` 的 `host/capability-unavailable` 精确回退一次完整上传，其余拒绝保持致命。首次上传从不探测，常规路径不付额外往返。
- `uploadImage` 保持完整上传：规范化会改变字节，客户端无法预知存储摘要。

## 备选方案

- **单请求同时携带摘要与字节、由服务端回退：**把 wire 耦合到启发式（Host 没有对象时字节仍然要传），能力检查也没有干净的广告点。
- **每次上传无条件探测去重：**每个首次上传浪费一次被拒往返，新文件的网关噪声翻倍。
- **让回执跨 Host 重启持久化：**与 Host 重启验收确立的「暂存是进程本地」不变量矛盾；持久权威是存储对象，不是回执。

## 结果

- 存活的 companion 重上传 Host 已存储的字节时只发一个小的摘要专用 RPC，不再发送整个 base64 文件体；Host 重启 e2e 现在断言重上传前后存储对象的 mtime 与大小不变。
- Host 的信任从不延伸到客户端声明：摘要只决定去哪里找，只有重新校验过的对象才会产生回执。损坏对象表现为未命中，随后在完整上传碰撞时以 `ATTACHMENT_CORRUPT` 大声失败。
- Android 能力允许清单（`NativeObservedCapability`）与其诊断 fixture 新增 `file-upload.dedupe.v1`，目录生成器把 `EncodedFileDedupeRequest` 归入其他上传类型旁边。
- 修复该 e2e 的同时修复了 Host 重启增量的潜在缺陷：profile 以裸名 insert `@deepseek-ai/dsh-api-native-remote`，在干净检出里 `plugin-package-inventory-deepseek` 无法把它解析为包身份（首个模型请求 REQUEST_EXTENSION）。insert 现在与其他 fixture 一致使用绝对条目，身份解析沿路径上行到工作区 manifest。

## 未竟工作

- 浏览器流式载体（`uploadStream`）没有去重路径；它需要对流做预哈希。
- 跨进程摘要记忆（companion 自身重启后的冷启动）仍会完整上传一次后才重新学到摘要。
