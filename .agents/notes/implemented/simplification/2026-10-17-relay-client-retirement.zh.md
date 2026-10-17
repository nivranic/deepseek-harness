# Agent Note：休眠 RelayClient 退役；Noise 向量保留

Status: implemented

[English](2026-10-17-relay-client-retirement.md) | 中文

## Problem

`RelayClient`——2026-08-31 relay 原型的跨设备 rendezvous HTTP 消费者——在 Android core 模块中休眠，生产引用为零（唯一调用者是它自己的 JVM 测试），且携带 Android main 源集最后一个 `java.net.http` import：正是 gen-56 迁移从 `LiteHTTPProvider` 移除的同型潜伏 `NoClassDefFoundError` 雷，只因无人构造该类而未爆。它所说的协议已被能力清单安全隔离（`relay-prototype-quarantine`：旧 relay「不能作为安全 Carrier 迁入生产」——Phase 8 必须新建安全 outbound relay），现行规格的远程传输走官方 Remote/API Gateway carrier、明令禁止 `POST /relay/*` 这族平行自定义端点（§2）。自 gen-56 起每代开放清单都带着这项退役。

## Decision

浅退役：删除 `RelayClient.kt`（284 行）与六个客户端流测试及其本地服务器 harness，保留隔离裁定为 Phase 8 重建拣选的一切——`link/Noise.kt`、带五个钉测试的 `relay-noise-vectors.json` 互操作向量（现为 `NoiseVectorTest.kt`，按包内一类一文件惯例改名）、以及 `RelayRendezvous` 词汇及其测试。Android main 源集的 `java.net.http` import 降为零。

## Alternatives considered

把客户端迁 OkHttp 被否决：这是给目标协议已被安全否决、注定替换的类花传输层打磨——反正是不可达代码。深退役（连 Noise、向量、rendezvous 词汇一并删）被否决：隔离裁定明确保留钉住的互操作向量作为 Phase 8 重建的历史参照，删钉向量等于丢弃后代需要的证据。再推迟被否决：拆这颗雷零成本、且已等了四代。

## Consequences

Android main 源集任何地方不再有 JDK HttpClient 面；未来 relay 客户端将针对 Phase 8 安全设计构建、以保留向量为互操作参照。core JVM 套件减去六个客户端流测试（552→546 测试、83→82 套件——被删客户端测试类本身是一个套件）。验证期间浮出一处无关 flake（`LiteHTTPProviderTest.aStreamThatEndsBeforeDoneIsTruncation`，六跑一挂、单跑稳定过——真 socket UTF-8 多字节分块与虚拟时间的竞态），不在本改动范围、在此具名留给 flake 所有者。

## Open follow-ups

Phase 8 安全 outbound relay（新设计、保留向量为参照）；`LiteHTTPProviderTest` 流截断 flake；§23 relay 台账行保持 NOT_STARTED 待该阶段。
