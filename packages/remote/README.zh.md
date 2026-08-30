---
description: "原生远程访问的包图：配对设备信任存储、带角色门控远程 Allowlist 的 TLS link 载体，以及用于校验原生伴侣端参考客户端。"
kind: "package-group"
---

# remote/ — 原生远程访问

[English](README.md) | 中文

## 摘要

`remote/` 组拥有让原生伴侣客户端经网络安全接入单个 Harness 宿主的安全访问层，且不建立第二套业务网关。`device-trust` 持久化宿主身份、一次性配对码与设备记录（公钥、角色、吊销）。`link-access` 绑定一个 TLS 监听器：以 Ed25519 请求签名认证设备，执行带角色门控的端点 Allowlist 与独立的远程审批开关，并把请求分发到现有 Typert 网关面——单次 RPC 走 Connection 共享 `/api` 处理器，Remote 流走 `typertGateway.wireStream`，与桌面载体使用同一对适配器。`link-client` 是可执行的参考契约：配对、SPKI 钉扎、签名 RPC 与 NDJSON 流，供原生伴侣端（Swift、Kotlin）复刻实现。`link-settings` 拥有产品侧的 `remote` 设置命名空间——启用跨设备访问、允许远程审批、设备名——并把每次提交实时应用到载体。

## 包列表

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`device-trust/`](device-trust/README.zh.md) | 配对设备信任存储：宿主身份、一次性配对码、带角色与吊销的设备记录 | `ctx.deviceTrust` |
| [`link-access/`](link-access/README.zh.md) | TLS 载体：设备认证、远程端点 Allowlist、现有网关上的配对接入 | `ctx.linkAccess` |
| [`link-client/`](link-client/README.zh.md) | 载体参考客户端：SPKI 钉扎、配对、签名 RPC、NDJSON 流 | 纯库 |
| [`link-settings/`](link-settings/README.zh.md) | 设置桥接：拥有 `remote` 设置命名空间，把启用/审批/名称提交实时应用到载体 | `ctx.linkSettings` |

## 定位

该载体是现有网关之前的全新访问层，而非平行网关：Session、审批与流保持唯一所有权，在信任存储中吊销设备会在其下一个请求生效。远程访问在 `dsh-web-app` bundle 中默认关闭；部署通过 patch overlay 启用。两个服务的子系统参考见[远程链接访问](../../docs/subsystems/remote-link.zh.md)。
