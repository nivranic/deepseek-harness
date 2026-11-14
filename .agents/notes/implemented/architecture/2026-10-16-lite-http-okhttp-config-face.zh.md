# Agent Note: Lite 在设备上改说 OkHttp，入口完成服务端配置

状态：已实现

[English](2026-10-16-lite-http-okhttp-config-face.md) | 中文

## 问题

两个缺口让独立 Lite 运行时在设备上不可用。其一，`LiteHTTPProvider` 的流式路径仍走 `java.net.http`——Android 运行时没有这个包：上一代的惰性获取修复只保住了构造期安全，而 `classifyTransportFailure` 仍引用 `HttpTimeoutException` 类字面量，provider 在设备上首次使用就会以 `NoClassDefFoundError` 失败。其二，app 壳注入的 endpoint、API key、model 恒为空串，`LiteEntry` 的空态永远不清除——已配置的端点从未到达 provider。在这些阻塞之外，请求面还有三处落后于宿主 provider：缺少 `accept: text/event-stream` 头；流在 `[DONE]` 之前结束没有截断判定（宿主 SSE 读取器抛 `STREAM_CLOSED`）；超时分类键在 JDK 独有的异常类型上。

## 决策

`LiteHTTPProvider` 改用 OkHttp——`:core` 已发布且已在用的栈（`LinkClient`、`NativeGatewayClient`）。client 沿用 Link 流式传输的超时形态（连接 10 秒、写 30 秒、读与整体调用禁用，让空闲长活流不受任何固定上限约束），请求在 Bearer 与 JSON content type 之外补上 SSE accept 头，读取循环照 Link 行循环骨架。失败分类保留三分词汇、删掉全部 JDK 独有类型：OkHttp 的各种超时统一抛 `SocketTimeoutException` 读作 `timeout`，域名解析与连接拒绝读作 `unreachable`，其余读作 `dropped`。流在未见到 `[DONE]` 时到达 EOF 则抛 `LiteTransportError.Provider("STREAM_CLOSED")`——与宿主代码字面一致——并且该路径上 tool-call 组装器绝不冲刷：截断流中组装到一半的调用不会被派发。

配置面关闭第二个缺口。`LiteConfig`（endpoint、API key、model）经 `LiteFileConfigStore` 持久化：整文件经 `link.CredentialsCipher` seam 密封（app 注入 `AndroidKeystoreCipher("dsh-lite-config")`，JVM 测试注入明文 cipher——`LinkCredentials` 的构造形态），写入走原子临时文件加改名。文件不存在读作未配置——合法的首次运行状态；文件畸形或不可解密则大声失败，绝不静默返回 null。`validateLiteEndpoint` 强制 HTTPS、主机名非空、不带 userinfo，同时放行完整路径——配对 origin 规则去掉其仅限 origin 的限制。在 `LiteEntry` 中，注入的 store 驱动界面：未配置显示被挡的空态加三字段表单，保存按钮以三字段全部非空且端点校验通过为门（PairingScreen 的门控形态）；已配置显示聊天面与「修改配置」入口，后者换入预填表单；每次保存递增 revision 从磁盘重读并进入新装配。读取失败获得自己的错误行——绝不读作未配置。

## 备选方案

DataStore 与 SharedPreferences 被否：app 全部以文件持久化，原子文件写是既有先例。仅对 API key 做字段级加密被否：文件存储先例密封整文件（`native-hosts.enc`），注入 cipher 的形态两种做法完全相同。用反射护栏保住 JDK client 被否：类字面量毒化的是类加载本身，反射只会隐藏毒化而不会移除。归因头（`x-deepseek-harness-*`）保持不加：它们标识的是宿主 harness 自身，与 companion 是不同产品面；最小对齐就是 Bearer、content type 与 accept。以 network security config 放行明文端点被否：仅 HTTPS 与配对 origin 规则一致，JVM 测试桩也不经过 Android 网络栈。同代迁移 `RelayClient` 被否：它共享 JDK client 缺陷但今天没有生产调用点，留作具名后续而不是未经测试的顺手漂移。

## 结果

Lite 运行时在设备上端到端闭环：配置、在 Keystore 密封下持久化、重启进入装配好的聊天、经 Android 携带的栈流式传输。截断语义与宿主一致——在 `[DONE]` 之前被切断的流是错误，其部分 tool call 保持未冲刷——每一路失败分类都落在两个平台都存在的异常类型上。`:core` 的生产路径不再触碰 `java.net.http`（休眠的 `RelayClient` 是具名残余）。emulator-5554 上的 connected 链三例通过，其中包括经真 Keystore cipher 的保存-密封-重读-装配走查。一处可见行为变化：保存按钮的禁用态就是校验反馈，没有单独的错误行——与 PairingScreen 表单一致。

## 开放后续

迁移或退役仍走 `java.net.http` 的休眠 `RelayClient`；归因头决策；preset 选择面；为 Host 声明名域打包工具声明；装配会话的 journal 续读；在禁含秘密规则下把会话事实投影进 support export；审批 ask 档；以及第 54 节网络矩阵下的设备端验证。
