# Agent Note: 宿主工件词汇

Status: implemented

[English](2026-08-31-host-artifact-vocabulary.md) | 中文

## 问题

第 56 章把工件立为日志一等对象，但宿主会话流没有工件词汇：每个插件域事件都有归宿（`todo/write`、`plan/mode`、`goal/change`），工件却只存在于 Lite 运行时的 spec 里。三个伴侣折叠早已消费 Lite 形状——工件面板以诚实空态交付，conformance fixture 钉住的是"叫不出任何真实宿主事件"的空（场景构建器类型于 `SessionEventMap`，而成员不存在）。

## 决策

新的纯词汇包 `@deepseek-ai/dsh-artifact`（`packages/artifact/artifact`）以声明合并交付宿主面：`artifact/created {id: ArtifactId, kind, title}` 与 `artifact/status {id, status}`——只携带引用、元数据与状态；内容字节永不随日志走（第 56 章），它们属于未来宿主生产方自有的资源通道。形状匹配折叠已在消费的 Lite 词汇，一组折叠分支同时服务两个事件源。`ArtifactId` 品牌化（来自 `dsh-brand` 的 `Branded<'ArtifactId'>`），构造器在本包。新增成员是词汇而非结构：`SESSION_FORMAT_VERSION` 不动，再生的已知事件守卫让旧构建拒绝携带新类型的日志而不是误读。黄金场景集新增 `artifacts`（created→ready、第二工件、重复 created 重推 pending、failed 末位生效、孤儿 no-op），经 `gen-link-contracts` 再生进三处 conformance 位置；TypeScript spec 钉住派生面板，原生车道经既有折叠回放 fixture。持久化目录与生成的已知事件集再生；model-experience 门禁把本包审记为纯词汇。尚无宿主生产方发出这些事件——那个工具（及其需要的宿主资源通道）是下一增量；在此之前录制会话不含工件事件，这也是录制会话快照不变的原因。

## 后果

伴侣工件面板在生产方追加真实事件的当下即可消费；线词汇由 TypeScript、Swift、Kotlin 的 fixture 对称钉住。远程线的 `LinkSessionEventKind` 枚举仍列其 13 个标签——折叠消费原始事件记录，清单枚举的增长不是消费的前提，随生产方一并跟进。

## 考虑过的替代方案

把成员声明进 `dsh-session` 核心图被否决——核心图为循环所有；每个插件域（todo、plan、goal）都在自己包里持有自己的词汇。复用 Lite spec 模块做宿主声明点被否决——Lite spec 是 `dsh-link-contracts` 里的客户端镜像；宿主所有权会倒置依赖。同场增长 `LinkSessionEventKind` 被否决——消费走原始折叠，清单枚举增长属于让标签在远程线上可观察的生产方。
