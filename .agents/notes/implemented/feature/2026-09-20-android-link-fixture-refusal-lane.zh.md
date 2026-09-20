# Agent Note: Android Link 夹具端到端驱动一次分类拒绝

Status: implemented

[English](2026-09-20-android-link-fixture-refusal-lane.md) | 中文

## 问题

gateway-consumption 增量把模拟器 lane 留在“仅启动冒烟”：从未驱动过活的 Host↔设备交换，且记录把 Host 侧配对夹具列为缺失前置。迁入外壳的 Link 栈（pinning TLS 配对、Ed25519 请求签名、拒绝信封）此前只对 JVM 进程内 HTTP 服务器验证过。

## 决策

提交一个最小 Host 侧 Link 夹具（`apps/android/support/link-fixture-host.mjs`），说外壳真实的线上协议：`/link/pair` 接受一次性二维码码值、对每个签名请求做签名校验（`timestamp\nPOST\npath\nsha256hex(body)` 经配对时注册的 Ed25519 公钥）、返回兼容的 `/link/describe` 文档、`workspace/follow` NDJSON 流，并以分类的 `gateway/permission-denied` 信封拒绝 `workspaceFiles/read`。HTTPS 走随库提交的自签夹具证书，配对载荷 pin 它的 SPKI 指纹——真实协议的 TLS+pinning 路径因此被真实执行，而不是绕开它走明文。驱动脚本在 AVD 上（`adb reverse`）经真实 APK 的配对屏完成配对、进入文件页、打开列出的文件并捕获呈现文案——外壳渲染 `Host 拒绝了本次调用`，即 `PERMISSION` 类别的类别文案，来自 `GatewayFailurePresenter`。

驱动该交换暴露了 JVM 测试看不见的两处真实外壳缺陷，均在 app 模块修复：

- 平台 Conscrypt 不提供 Ed25519 密钥生成（`KeyPairGenerator.getInstance("Ed25519")` 抛异常；Android issue 399856239，Android 15 仍然如此），配对在设备上永远无法成功。应用现捆绑 `org.conscrypt:conscrypt-android:2.7.0`，并在没有已安装 provider 提供 `KeyPairGenerator.Ed25519` 时以位置 2 注册该 provider；按名查找仍优先平台服务，只有 Ed25519 密钥生成与签名落到捆绑 provider。
- `FilesModel.start()` 从未被调用（历史外壳带同样的缺口），`workspace/follow` 流从未打开，文件页永远为空。`FilesTab` 现在在已配对时启动该流，镜像 interactions 模型的生命周期。

## 备选方案

- **经 network security config 放行明文回环。** 否决：产品姿态是 pinning TLS；协议的 pinning 模型配自签夹具证书即可正常工作，为测试 lane 削弱它只会测到一条生产永不使用的路径。
- **预置凭据跳过配对。** 否决：应用用 Android Keystore cipher 加密凭据存储，且配对交换本身就是该 lane 要执行的内容之一。
- **生产者侧经 `classifyRemoteFailure` 分类 job 失败。** 调查后判为架构空项并放弃：所有 job 生产者（bash、pwsh、subagent）都在 Host 侧运行，那里不存在 `RemoteError`；dsh-sdk 子代理 provider 在结算前把失败归一化为固定消息的普通错误——没有可分类的码。前一份 jobs 记录把生产者列为队列项的局限表述由本笔记更正。

## 后果

模拟器 lane 现已在设备上证明完整分类拒绝链：pinning TLS 配对、服务端校验的 Ed25519 签名、follow 流、列表调用、被拒绝的读取呈现类别文案。夹具证书与密钥作为一次性本地回环夹具凭证随库提交（README 与模块文档如此注明）；重新生成它们会改变驱动载荷必须携带的 SPKI 指纹。core 与 contract 模块未动，其 JVM 套件与经 scanner 门禁的 `:app:assembleDebug` 保持全绿。仍未认定：真机、发布签名，以及该夹具之外的任何 Host——候选 harness 自身不提供 `/link/pair` 端点，哪个包拥有设备侧接入仍是 §48 审计决策。
