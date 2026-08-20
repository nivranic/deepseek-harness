# `@deepseek-ai/dsh-desktop-app`

[English](README.md) | 中文

dsh 桌面表面的 bundle。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.md) 之上：设置编码 persona，插入桌面宿主行（API 网关、workspace、投影缓存、storage、[`electron-ipc`](../../host/electron-ipc/README.md) 载体）以及 Web 表面的浏览器插件花名册外加一行桌面专属行（[ui-desktop](../../client/ui-desktop/README.md)，关闭按钮偏好），并挂载本包的 `desktop-runtime` 粘合插件（配置 `{surfaceContext}`）。该表面与 [`dsh-web-app`](../web-app/README.md) 的差异恰恰在载体：不绑定 webserver 行、不解析 `webStartup` 旗标，Connection 行以空信任清单保持挂载，提供其传输无关的注册表服务与浏览器半。electron-ipc 行提供 `desktopGateway`，由 Electron 应用壳（`apps/desktop`）挂到其特权协议上；自适应目录选择器通过 `bindHost` 声明其回环绑定事实，因为没有可读的服务器绑定。粘合插件在 `surfaceContext` 为 true 时注册 harness-source 与 `app:desktop-surface` 提示词段落：桌面窗口定向、无 URL 约定，以及不要启动 `dsh web` 替代服务器的指示。本表面没有 URL 行、shell 变量或 HTTP 席位。

## Model Experience

### Harness-source 与桌面表面上下文

#### What the model sees

`surfaceContext` 为 true 时，`harness:source` 段落指明磁盘上的 Harness 实现而不声称它是工作目录；`app:desktop-surface` 全局段落（order −98）为模型定向桌面窗口："this page" 的指代、没有隐式 DOM／路由／截图上下文、无 URL 约定（窗口在进程内加载构建后的前端，没有 HTTP 服务器供给它），以及未经要求不要启动 `dsh web` 服务器的指示。为 false 时两个段落都不注册。

#### Token effect

每个会话一行来源说明加一段提示词；进程内恒定。

#### KV Cache effect

提示词段落位于系统提示词头部附近，且在进程生命周期内稳定，不会在轮次间使缓存失效。

## Known Limitations and Deferred Work

- **前端 dist 必须已构建**——载体的 `require.resolve` 在激活时失败会带着构建提示大声报错；没有源码供给的回退。
