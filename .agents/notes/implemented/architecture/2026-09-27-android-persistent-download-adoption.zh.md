# Agent Note: Android 在所选 Host 模型内接入持久下载

Status: implemented

[English](2026-09-27-android-persistent-download-adoption.md) | 中文

## 问题

完整文件可能超出预览的内存预算。仅有加密传输进度，不能确定哪个应用模型可继续下载、如何限制磁盘占用，以及待处理系统选择器结果是否可以比资源活得更久。应用需要显式传输控件和完整文件导出，同时保留所选 Host 授权与取消规则。

## 决定

`CompanionRuntime` 使用当前已验证的 `CompanionInputPrincipal` 和独立的 `AndroidKeystoreCipher("dsh-native-downloads")` 构造 `NativeDownloadFiles`。应用私有的 `native-downloads` 目录按绑定的 Host 标识、固定指纹、设备授权、Session 及资源路径保留下载。不同授权不能采纳这些字节。[检查点决定](2026-09-27-android-download-checkpoints.zh.md)继续作为加密分段、原子检查点、版本校验与崩溃恢复的权威。

`CompanionModelSet` 与资源观察一起持有 `NativeDownloadsModel`。选择资源只恢复已有本地缓存；缓存不存在时不创建下载文件或密钥。恢复不发送下载请求。显式下载或继续通过该模型的 wire 获取描述符，只接受版本匹配的窗口。替换资源或退役 Host 时，先取消并等待网络读取、磁盘工作与文档导出，再释放存储独占锁。存储采纳期间发生取消时，所有权保留到清理完成。

应用使用 64 KiB 窗口和每文件 1 GiB 内容限制。`NativeDownloadQuota` 将跨主体共享缓存限制为 2 GiB 已存储加密文件和 128 个保留下载。准入预留检查点空间：新传输预留 128 KiB，追加时在每个加密分段之外再预留 64 KiB。配额失败保留已提交进度，释放容量后才能重试；应用不自动淘汰另一个下载。

文件与 Artifact 预览通过中文 Android 字符串资源呈现下载、暂停、继续、保存完整下载及确认本地移除。返回资源时只恢复本地进度，不恢复网络工作。Host 版本变化后不能向保留前缀追加。确认移除先取消活跃工作，再仅删除该主体所选资源的缓存字节、进度和临时检查点；无需解密即可移除不可读存储。Host 文件及已导出文档保持不变。

## 完整文件导出

`NativeResourceSaver` 接受以有界分段复制的完整内容源。既有预览入口仍在打开选择器前复制完整的内存观察。`NativeDownloadController.prepareSave` 则捕获完整磁盘检查点，逐窗口复制经过认证的内容，不再次读取 Host，也不分配整文件内存。磁盘导出使用 `application/octet-stream`；系统选择器收到经过清理的基本文件名，由用户选择目标。

选择器授权仅保存在内存，结果只消费一次。资源替换、Host 退役或下载移除使授权失效。取消、过期结果及写入失败仅清理新建目标；清理失败保留独立结果。退役等待输出 I/O 与清理完成后才关闭源文件独占锁。[快照保存决定](2026-09-27-android-complete-resource-save.zh.md)继续拥有选择器生命周期与清理规则，[资源读取决定](2026-09-27-android-current-resource-reading.zh.md)继续拥有预览校验与限制，[保存 Host 决定](2026-09-26-android-saved-host-catalog.zh.md)继续拥有主体采纳。这些独立决定保持有效。

## 考虑过的替代方案

**扩大内存预览以保留完整大文件。** 文件大小会决定保留堆内存，进程丢失也会丢失进度。既有有界预览仍可独立于持久下载使用。

**自动恢复并继续所有已保存传输。** 已保存进度不等于网络授权。打开资源只恢复其本地状态；下载与继续需要显式用户操作。

**为每个界面或 Host 切换创建独立下载器。** 并行所有者可能保留陈旧请求权限，或争用同一加密存储。Host 模型串行处理资源选择，等待退役后才转移所有权。

**使用 DownloadManager 或固定公共目标。** 通用 URL 下载无法保留带签名的 Native Gateway 准入与描述符校验。系统选择器为完整且经过认证的内容提供显式目标。

## 后果

核心覆盖约束仅本地恢复、主体隔离、有界磁盘导出、陈旧选择器结果拒绝、等待传输与导出退役、取消选择和移除、损坏缓存移除，以及字节与条目配额。快照保存覆盖继续适用于内存入口。

[已安装下载场景](../../../../apps/web/tests/android-download-adoption.e2e.ts)在 Android 模拟器上连接真实 Host 通过。它在 9 MiB 下载期间终止进程，准确恢复 256 KiB 已暂停进度，并验证显式继续从首个缺失字节开始。经系统选择器保存的大文件与空文件，其目标 SHA-256 经独立计算后与 Host 字节一致。版本变化不能追加，确认本地移除保留 Host 文件及已导出文档。

[双 Host 场景](../../../../apps/web/tests/android-download-host-isolation.e2e.ts)使用相同 Session id 和相对路径下不同的 9 MiB 内容通过。Host B 从字节零开始，不继承 Host A 的进度。返回 Host A 时以 PAUSED 状态恢复其 128 KiB 前缀；打开任一资源只读取它的 256 字节预览，继续下载仍需显式操作。场景核对预览内容、已提交进度及每个请求字节范围，包括另一 Host 不再收到字节读取。它没有独立导出并计算两个 Host 完整内容的哈希。

[快照保存场景](../../../../apps/web/tests/android-resource-save.e2e.ts)在模拟器已安装应用上通过。三个[安装态选择器测试](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeResourceSavePickerTest.kt)也通过，覆盖选择器 intent 与回调所有权。这些结果仅验收所测模拟器及系统文档提供方，不代表物理设备或第三方提供方验收。

[验收驱动](../../../../apps/web/tests/android-companion-ui-driver.ts)要求显式安装应用 APK 与插桩 APK。启动插桩前，它比较每个已安装 APK 与当前构建产物的 SHA-256，不一致时拒绝执行。通过的 Host 场景均已显式安装两个 APK 并匹配哈希。此前一次真实 Host 运行使用了陈旧的已安装 APK，不能验收当前构建；显式安装、匹配哈希并成功重跑后修正了该证据。两个 [APK 准入拒绝测试](../../../../apps/web/tests/android-apk-admission.e2e.ts)确认应用或插桩 APK 不匹配时阻止启动并释放驱动独占锁。

本集成不增加后台调度器或自动缓存淘汰。断电持久性、防回滚、硬件密钥故障、物理设备、第三方文档提供方及全平台 File/Artifact 描述符验收仍未取得资格。
