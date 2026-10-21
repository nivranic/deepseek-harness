# Agent Note: Lite 附件 intake 把字节留在设备上

Status: implemented

[English](2026-10-22-lite-attachment-intake.md) | 中文

## 问题

最后两枚本地名——`attachment_read` 与 `image_inspect`——在 gen-62 台账被诚实缓行为「无 intake 生产者」，gen-66 再勘察钉死了原因：配对面的附件通道（文档/图片/相机 picker 喂 base64 wire 上传）字节不留设备且属配对会话，而独立 Lite 面没有 picker、没有 store、也没有可上传的 wire。无 intake 的执行器比无 schema 的执行器在更强意义上不可达——设备上没有任何东西可供它读。

## 决策

生产者先行，恰领先其消费者一代。`LiteAttachments.kt` 落成整个 seam：`LiteAttachmentEntry`（name、mediaType、sizeBytes）、`LiteAttachmentStoring`（put/get/list/remove）、`LiteFileAttachmentStore` 镜像 artifact store 的文件布局与原子写（共享 `writeAtomically` 助手从 private 开为 internal）外加 artifact 通道从不需要的一件——附件 intake 不写 journal，故 mediaType 落在字节之后写的 `<name>.attachment.json` sidecar：两次写之间的崩溃留下的是无列表可解析的字节，绝不是有列表无字节。corrupt sidecar fail-loud（config store 的 corrupt-read 形态）；字节已失的 sidecar 读作缺席。`LiteAttachmentIntake` 是被选文档与 store 之间的类型化步骤：调用方的有界读已完成，intake 推导 store 键——`storeName` 剥 display name 在两种分隔符上的末段并 trim，空名或缺席回退生成的 `attachment-<uuid8>` 而非拒收用户文件（artifact 通道拒绝路径分隔符因其 id 是模型控制的受控参数；provider display name 带前缀不是用户的错）——默认未声明的 mediaType、强制 `CONTENT_LIMIT_BYTES = 8 MiB`（整收现代手机照片、有界因为本代任何被收内容都不进请求）、返回 `Stored` 或类型化拒绝。UI 是 preset 选择器体例旁的一个面板：添加按钮开两选项对话框（文档 picker、图片 picker）走 app 既有的 `AndroidNativeFileAttachmentSource`、十一个 locale 所属字符串、每个动作带 test tag、条目可删且跨重启列表仍在。MainActivity 的 lite-open 分支在 `filesDir/lite-attachments` 下建 store 并注入；面板在未配置空态与已装配会话面均可见。

## 备选方案

把 intake 事件写进 journal 或 fold 被拒——十六 tag journal 词汇是三方互验闭集（TS 参考、Swift、Kotlin），本代绝不单方扩，且 intake 不是回合结局。把附件字节收进 provider 请求被拒为时过早：Lite wire 的请求行今天是 role/content 字符串，附件的请求面形态是 gen-68 与两枚执行器及其 schema 同代落地的决策。相机来源缓行——配对相机链携带 NativeCameraFiles 与 SavedStateHandle 清理机械，会令本增量失重；文档与图片 picker 已覆盖 intake 面。像素尺寸元数据缓行至 gen-68 的 `image_inspect` 执行器——解码是那枚工具的职责，intake 只留 name/mediaType/sizeBytes。

## 后果

设备现在本地留存 Lite 会话附件——两枚缓行执行器在 gen-68 有了真实生产者可读，本代被收内容零触达 journal、fold 词汇或 provider 请求（LiteChat/LiteFold/LiteHTTPProvider/LiteLoop 全不动，diff 面证实）。重启保列表；corrupt sidecar 以带恢复说明的显式错误行呈现。core JVM 测试：587 -> 597（新 LiteAttachmentsTest 套件十测——双分隔符剥路径各形态、sidecar 后写崩溃形态、corrupt-read、帽边界、类型化拒绝）。connected 设备轮未执行（androidTest 面仅编译）。

## 开放跟进

gen-68 同代落两枚执行器+schema+被收附件的请求面决策（照 gen-62 配对规则）；相机 intake 源与像素尺寸元数据随行；工具行 journal 持久化仍留 chapter-64 决策。
