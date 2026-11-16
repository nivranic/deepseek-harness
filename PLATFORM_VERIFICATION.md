# 平台验证状态

状态：IN_PROGRESS。Windows 官方 Desktop 开发模式的[初始回执](artifacts/upstream-first/desktop-smoke.json)与本轮[打包应用记录](artifacts/upstream-first/desktop-package-source.json)分别绑定来源；后者已完成 unsigned 构建、实际设置/主题/托盘/第二实例恢复及退出，安装和其他平台仍待验收。新增[托盘验证](artifacts/upstream-first/desktop-tray-smoke.json)证明开发模式下的真实托盘、关闭隐藏、第二实例恢复和退出清理；系统自启动注册未执行。

| 平台 | 安装/启动/运行/恢复 | 真机/签名证据 |
|---|---|---|
| Windows official Desktop | 开发模式原生功能及本轮打包应用启动/设置/主题/托盘/恢复/退出 PASS；安装、更新、系统登录待验证 | unsigned NSIS 已构建；未安装或签名 |
| Windows packaged runtime | CLI 参数版产物的仓库外认证、Web 设置/主题、Session RPC、fixture 退出 PASS；已安装 SDK/runtime 11/12，插件安装失败；未包含后续 HTML 修复 | exe/两个 wheel 已构建；已安装 wheel 11/12；签名未验证 |
| macOS official Desktop | NOT_STARTED | NOT_STARTED |
| Linux CLI/Web | NOT_STARTED | NOT_STARTED |
| Web/PWA Chromium/WebKit | CLI 参数版 Windows 打包 Web 的 Chrome 设置/主题 smoke PASS；后续源码及其余矩阵待验证 | 分别绑定各次源码回执 |
| iPhone/iPad Companion | NOT_STARTED | NOT_STARTED |
| Android Phone/Tablet | NOT_STARTED | NOT_STARTED |

UI 矩阵：320×568、393×852、768×1024、1024×768、1440×900；明暗主题、idle/streaming/tool/approval/question/offline/reconnecting/error/empty/loading/diff/artifact，以及 safe area、IME、旋转、字体缩放和键盘可达性均待执行。旧产物没有被导入本候选回执。

规格依据：[按初始 SHA 恢复的原文](artifacts/upstream-first/original-specification.md)与[完整追踪记录](artifacts/upstream-first/specification-traceability.json)。追踪覆盖不替代逐项验收，未完成范围不因局部测试通过而缩减。
