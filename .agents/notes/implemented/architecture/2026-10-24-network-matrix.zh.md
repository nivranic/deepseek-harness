# Agent Note: §54 网络矩阵——生产 Lite 传输上的仓内与设备侧验证轮

Status: implemented

[English](2026-10-24-network-matrix.md) | 中文

- 日期：2026-10-24
- 分类：architecture
- 范围：`apps/android/core` 测试（`LiteNetworkMatrixTest.kt`）、`apps/android/app` androidTest（`LiteNetworkMatrixNativeTest.kt`）、debug 覆盖层（`app/src/debug/`）

## 问题

Upstream-First 规格的 §54 列出十三行网络矩阵（同局域网、跨局域网、Wi-Fi→蜂窝、蜂窝→Wi-Fi、VPN 开关、宿主 IP 变更、宿主休眠、宿主重启、客户端后台、客户端进程死亡、Relay 重连、丢包、延迟）。Lite 伴生的传输层（`LiteHTTPProvider`）已有纯分类测试、拒连轮、截断轮与环级 stub 提供方错误面钉住其失败分类学——但生产传输本身从未在恶劣网络条件下被驱动过，JVM 与 Android 网络栈两侧皆无。

## 决策

按每行在各仓内能诚实证明的内容切分矩阵，且仓内每一轮都对生产传输验证——零替身。JVM 侧（`LiteNetworkMatrixTest`）三真套接字轮：延迟 1.5 秒的首字节在禁用的读超时下存活并完成回合（延迟行）；带 `SO_LINGER(0)` 的流中套接字复位读作 dropped 传输（丢包行）；真实拒连驱动生产提供方穿过环驱动器、折叠态携带 `network/unreachable`——stub 轮钉形状、此轮在真套接字上证明接缝。设备侧（`LiteNetworkMatrixNativeTest`）同一三轮跑在 Android 进程自身的网络栈上，对插桩进程内的回环监听器；明文仅经 debug 源集 manifest 覆盖层（`network_matrix_loopback.xml`）抵达回环、release 面绝不携带——Android 无 JDK HTTP 服务器，设备轮驱动裸 `ServerSocket` 监听器并按 Content-Length 显式读体（读到 EOF 会死锁：客户端在等响应期间保持写侧开放）。物理台架行——局域网变更、蜂窝切换、VPN 开关、宿主 IP 变更/休眠/重启、客户端后台/进程死亡、Relay 重连——照 §64/§36 设备验收行的先例留在外部验收台账。

## 备选方案

为每行接入完整 OkHttp mockwebserver 被否：§54 的要旨是生产传输的行为，mock 服务器恰好替换了被测层。以「网络韧性」之名加重试/退避机制被否：§54 要求验证既有行为在网络条件下的表现，而非新增运行时机制——环既有的 `network/error` 呈现即契约。设备轮改打局域网主机被否：插桩轮触达外部主机使测试依赖环境，回环确定性地走同一条 Android 网络栈路径。

## 后果

core 聚合随三轮 JVM 测试 613→616；androidTest 三设备轮在 scanner-env 验收调用下装配绿。debug 覆盖层新增 `app/src/debug/AndroidManifest.xml` 与 `res/xml/network_matrix_loopback.xml`；双 APK 面重定基（androidTest 携新类、debug 携覆盖层——对 riding 世系比较为 ff8d2d46 / 3bc0b9cc）。外部台账行照既有外部设备行的先例记为开放验收项。
