# Agent Note: Link composition 中的可选 WebServer 绑定

Status: implemented

[English](2026-09-02-optional-webserver-link-composition.md) | 中文

## Problem

`dsh-client-connection` 同时服务于带 `ctx.webServer` 的 Web composition，以及通过其他 transport 承载 `/api` 的无 WebServer composition。它的可选绑定通过 `ctx.get('webServer')` 检查服务，但通过 `ctx.webServer` 注册 route；由于该插件特意没有把可选服务声明为必需 injection，Cordis 会拒绝这种访问。因此，服务已经存在时 Gateway transport 测试仍会失败；与此同时，base patch 中的一行说明文字不是 YAML 注释，导致已交付的 Link composition 在激活前失败。carrier-level 测试把 settings、sessions、storage 与 Device Trust 隔离到临时 Harness home，却把 credentials 留在用户默认位置，所以 clean sandbox 会尝试锁定用户的凭证文件。

## Decision

base patch 将 Artifact 说明保留为有效 YAML 注释。Connection 通过 `ctx.get('webServer')` 解析一次可选 WebServer，并捕获该服务用于 route 注册，同时保留 `inject = ['credentials']`；没有 WebServer 时它仍提供 `ctx.connection`，现有 `ctx.inject(['webServer'], ...)` watcher 会在服务稍后出现时绑定 `/api`。已交付的 Link 测试把本地 credential provider 映射到与其他持久化存储相同的临时 Harness home，并禁用文件监听，因此真实 desktop composition 不会读取或写入开发者凭证。

## Alternatives considered

**把 `webServer` 声明为必需 injection。** 否决，因为 desktop 和其他无 WebServer carrier 需要在没有 HTTP server 时使用 Connection 服务。

**通过 `ctx.get` 检查后再使用 `ctx.webServer`。** 否决，因为存在性检查不会授权插件在已声明 injection 之外访问 Cordis 属性。

**在 carrier 测试中禁用 Connection、Electron IPC 或 credentials。** 否决，因为该测试必须启动已交付的 desktop composition，并在不触碰用户状态的前提下证明真实 browser/Gateway 链路。

## Consequences

Gateway transport 覆盖会执行真实的可选 route 绑定，不再在 setup 期间失败；已交付的 Link 切片能够到达 pairing、Session list、Remote event stream 和独立 approval switch。该测试要求先有已构建的 Host 与 Web 产物，因为已交付的 Loader 会解析包 exports，Electron IPC 也会验证 frontend distribution；这些构建产物仍是 artifact plane 前置条件，而不是 source fallback。
