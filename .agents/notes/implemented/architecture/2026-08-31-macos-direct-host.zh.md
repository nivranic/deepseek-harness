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

[Mac Host 生产器](../../../../scripts/produce-mac-host.ts) 从一个干净候选提交把 runtime、rg、spawn-helper 和生命周期 helper 组装到 `Contents/Resources/Runtime`。原生二进制工具拒绝错误架构、非 macOS 切片和高于 macOS 14 的最低系统版本；复制后的字节、内嵌产品版本、签名与 ZIP 往返结果分别核验。生产器只用 ad-hoc 签名封装外层应用，保留 SEA builder 的嵌套签名与 entitlement。缺少资源的源码壳会报告不可用。Companion 归档证据不覆盖 Host bundle。

应用的显式 `DSH_HOME` 在启动前解析，且必须是 POSIX 绝对目录路径。非法值不能回退到默认 home。已安装应用通过运行时实际消费的同一配置完成隔离验证，无需测试专用启动器或第二套持久化实现。

该 helper 拥有运行时进程组，不拥有工具创建的独立 POSIX 进程组与 PTY session。[本地子进程提供方](../../../../packages/subprocess/subprocess-local/README.zh.md)明确说明：JavaScript 可观察到的关闭会终结这些资源，而运行时或 helper 突然死亡需要外部所有者。在这些生命周期得到覆盖前，Full Host 无孤儿进程验收仍未完成；只覆盖进程组的 smoke 不能关闭该项。

Apple 车道以真实进程验证原生 helper，并用可执行夹具验证 Swift 生命周期行为。独立的 Mac Host candidate 车道在临时 macOS runner 上构建并测试组装后的应用，使用生产 Web 内容和隔离 home。其已验证产物必须通过原生 UI 与 bundle 内 Web 验收；仅构建成功不能生成该产物。脱离进程组的工具清理、Developer ID 签名、公证与完整供应链验收仍是独立要求。

## 考虑过的替代方案

宿主面复用 CompanionUI 被否决，因为远程客户端状态不是运行时权威。在 Swift 中重新实现 Harness 核心或管理 API 被否决，因为这会引入第二套服务实现。仅依赖应用退出回调被否决，因为突然的应用死亡会绕过回调。在资源组装前保留独立 target 仍有价值，因为依赖图已经可以阻止 Host 代码进入 Companion 应用。
