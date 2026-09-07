# Agent Note: macOS 直连宿主 target

Status: implemented

[English](2026-08-31-macos-direct-host.md) | 中文

## 问题

Mac Host 运行 Harness 运行时，而 Companion 消费另一个 Host。共享应用 composition 会混淆运行时权威、进程所有权与远程客户端状态。原生 Host 还需要外部生命周期管理者：应用被强制终止后，Swift 退出回调无法执行。

## 决策

`DirectHostMac` 把原生控制保留在 `Hosts/` 中，并依赖独立的 `DirectHostRuntime` 产品。Companion target 均不依赖该产品。原生管理器只通过 `dsh --profile web --no-open --host 127.0.0.1 --port 0` 启动打包运行时；临时 WebView 消费这一单一本地载体。会话与管理语义仍由现有 Node 服务和 Web UI 拥有。

管理器只接受带认证的回环根地址公告，在发布 ready 前验证 HTTP 健康状态，限制启动等待，并拒绝过时 activation 的回调。管道读取器每次 DispatchSource 事件消费一块可用数据，不等待指定字节数或 EOF；拥有的描述符只在其处理器结束后关闭。重新启动等待关闭完成后才创建新的 activation，并保留应用 home。固定的失败枚举拥有原生诊断；运行时输出、cookie、响应正文和启动 URL 从不作为状态文本或持久日志。

原生 `HostRuntimeSupervisor` helper 观察由 Swift 应用持有的管道，并在新的 POSIX 进程组中启动固定运行时调用。管道关闭或停止信号会请求终止进程组；宽限期到期会强制终止并返回失败状态。运行时自行失败会保留其退出状态。该 helper 是进程基础设施，不挂载 Harness 服务或第二套 Gateway。

## 后果

必须把所选架构的运行时与 helper 可执行程序组装到应用的 `Contents/Resources/Runtime` 目录。缺少这些资源的源码壳会报告不可用。Companion 的归档生成不证明 Full Host bundle 或已安装 WebView 的行为。

该 helper 拥有运行时进程组，不拥有工具创建的独立 POSIX 进程组与 PTY session。[本地子进程提供方](../../../../packages/subprocess/subprocess-local/README.zh.md)明确说明：JavaScript 可观察到的关闭会终结这些资源，而运行时或 helper 突然死亡需要外部所有者。在这些生命周期得到覆盖前，Full Host 无孤儿进程验收仍未完成；只覆盖进程组的 smoke 不能关闭该项。

Apple 车道以真实进程验证原生 helper，并用可执行夹具验证 Swift 生命周期行为，包括启动取消、健康检查失败、重新启动与意外死亡。真实已安装运行时与 WebView 执行、脱离进程组的工具清理、签名和 bundle 生产仍需要各自的证据。

## 考虑过的替代方案

宿主面复用 CompanionUI 被否决，因为远程客户端状态不是运行时权威。在 Swift 中重新实现 Harness 核心或管理 API 被否决，因为这会引入第二套服务实现。仅依赖应用退出回调被否决，因为突然的应用死亡会绕过回调。在资源组装前保留独立 target 仍有价值，因为依赖图已经可以阻止 Host 代码进入 Companion 应用。
