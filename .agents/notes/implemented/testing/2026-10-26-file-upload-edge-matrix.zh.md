# Agent Note: 文件上传边缘矩阵跑在真实本地附件仓上

Status: implemented

[English](2026-10-26-file-upload-edge-matrix.md) | 中文

## Problem

原规格第 35 节列出九项文件边缘——large file、binary、image、unknown MIME、partial download、range、interrupted transfer、filename encoding、zero-byte file——而既有证据只有快乐路径的上传回放。没有任何一条边缘的测试触达持久存储：中途失败是否留下已发布 digest、重启后同字节是否经内容寻址布局去重、含 NUL 的字节是否会渲染成文本预览卡，这些都未被钉住。

## Decision

在三层补齐边缘矩阵。`packages/client/file-upload/tests/file-upload-edge.host.spec.ts` 组装真实服务栈——SessionStore、AgentRegistry、CommandRuntime、以及跑在临时 `DSH_HOME` 上的 `LocalAttachmentStore`——直接实例化 `FileUploads`，用真实 `POST` 请求驱动它注册的流式路由。六个用例钉住存储边缘：含 NUL 与高位字节的字节经路由、暂存回执、别名路径与磁盘逐字节往返；零字节 body 配缺省名存为空对象落在默认叶子名下；CJK 与 emoji 显示名经 URL 编码链路原样存活，而带保留字符的 Windows 路径茎被消毒为安全叶子名；96 MiB 图案流一次上传，公共 `readFileStream` 读回的字节数、digest 与抽查偏移全部精确；中途出错的 body 返回 `session/attachment-invalid`（`ATTACHMENT_WRITE_FAILED`），不留对象、别名或 staging 残留，且该 Session 仍接受后续上传；同根上的第二个服务实例把前实例的回执视为外来，同字节重新暂存得到同一 attachment id，`uploadDedupe` 与 `ensureFileByDigest` 在唯一存储对象旁追加名字别名。两个入口边缘同代闭合：documentpreview 签名嗅探对任何含 NUL 的字节返回二进制卡（两条过去期待文本的截断图像断言改为期待二进制卡，因为其前缀含 NUL）；空 MIME 与未知 MIME 值分类为逐字文件草稿。客户端 `digestBody` 分块哈希被端到端钉住：2.5 MiB Blob 跨三个 1 MiB 分块边界，经载体上传一次，第二次上传的去重探针携带的恰是字节的 Node `sha256`。

## Alternatives considered

拒绝桩附件仓（session-controller harness 形态）——受测缝是存储事实：staging 清理、内容寻址发布、别名布局、digest 校验，桩只能复述断言。拒绝合并为单个巨型测试——每条边缘保持一个可读用例与独立失败信息。拒绝伸进存储内部取临时路径——断言停留在已发布布局与公共 `readFileStream` 上，后者自行校验字节数与 digest。

## Consequences

第 35 节九项边缘现拆为已证明的存储边缘（binary、zero-byte、filename encoding、large file、interrupted transfer）与仍开放的呈现边缘：三个 diff 消费面（documentpreview 解析器、ui-primitives DiffBlock、trajectory structuredPatch）的共享 Diff 矩阵与 partial-download 恢复语义留在 gen-80 台账，该矩阵出现前 §34 保持 NOT_STARTED。本矩阵经流式路由证明本地仓；不覆盖真实网关 HTTP 服务器、跨进程并发写者或图像规范化边缘，后者保持既有车道。`pdf-license-bundle` 在本 Windows 宿主上因 GNU tar 把 `C:` 当远程主机而失败——已记录的宿主怪癖，与本次改动无关，由 CI 的 Linux 车道拥有。
