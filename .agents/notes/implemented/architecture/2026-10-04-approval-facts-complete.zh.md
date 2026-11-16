# Agent Note：审批表面逐项呈现完整审批信息

状态：已实现

[English](2026-10-04-approval-facts-complete.md) | 中文

## 问题

§37 剩余子句要求审批表面逐项呈现完整审批信息：操作、目标、Host、Workspace、权限提升、命令预览。已落地的 §38 事实行覆盖操作/Host/Workspace/风险，但目标既无行也无任何层级的载荷字段，权限提升只渲染询问方的自由文本理由（沙箱档位藏在英文句子里），命令预览只对调用已流式的 shell 工具生效。数据链上还浮出两个潜在缺陷：`ApprovalService.request` 把 `risk` 从持久 `approval/asked` 事件中丢掉（wire 载荷却带着），且冻结的已发布 v0 载荷清单表在格式工件校验时对 `risk` 与任何新成员都拒绝。

## 决策

- **目标走既有 callId 关联 seam，不走载荷。** 2026-07-06 审批 seam 裁定钉死「审批请求不复制工具参数；通道适配器按 callId 关联更丰富的调用状态」——目标行来自新数据座位 `conversation.approval.target`（与 detail 座位同 owner props），由 ui-chat 实现，从关联调用的 `args.command` 或 `args.path` 派生。string 是合法 ReactNode，slot 体系无需新基建即可承载。
- **权限提升是审批自有的结构化元数据。** `ApprovalRequestEvent`/`approval/asked`/`ApprovalRequest` 增 `escalation?: { requestedMode; effectiveMode }`；沙箱升级闸门（本就持有两值）填充；权限提升行渲染本地化的请求/当前档位，非升级询问（hook ask）保留自由文本理由兜底。
- **档位词汇镜像而非导入。** user-approval/types 里的 `ApprovalSandboxMode` 重声明三个沙箱档位——把 `@deepseek-ai/dsh-sandbox` 导入 wire-safe types 模块会把 Host 运行时模块拖进浏览器类型程序并破坏 Context 合并（stash 探针实证）。结构镜像习惯法与 `EscalationOutcome` 相同，方向相反。
- **持久日志与格式校验器跟随类型。** `approval/asked` append 展开 `risk` 与 `escalation`（修复 risk 丢弃）；已发布 v0 清单表接纳 `risk`/`escalation` 为可选成员；载荷语义校验器对 risk 档位字面量与 escalation 记录的精确键和档位字面量做类型检查。腐蚀测试的变异循环覆盖新叶。

## 备选方案

- **wire 载荷携带目标/命令**：弃——违背已记录的 seam 裁定并在 wire 上复制工具参数；callId 关联已达同一数据。
- **detail 座位改为返回结构化数据**：弃——slot 渲染按构造是 ReactNode；第二个 single 基数数据座位是最小对称增补。
- **escalation 在清单表标 opaque**：弃——该事实为审批自有（非 owner-opaque 外部块），其键与档位字面量从严校验；opaque 成员会跳过钉住形状的腐蚀变异。

## 后果

- 面板渲染六项逐项行加预览标题；目标仅在关联调用带命令或路径时出现，结构化升级仅升级询问有。
- user-approval 零新包依赖（镜像联合替代导入）；`EscalationApprover` 结构请求类型增 escalation 字段。
- 冻结清单 fixture 现带 risk+escalation，格式校验器的接纳被回归钉住；不含新字段的既有日志校验不变（新成员全可选）。
- ACP 机器通道委托与 `tools/pre-execute` hook 路径不变（两者都不设 risk/escalation——对应行保持隐藏，即诚实的条件呈现）。

## 开放跟进

- hook 来源的询问仍无风险档位分级；给 `PreToolDecision` 加可选 Host 评定档位是单独的政策变更。
- 每-审批的多 Host 来源身份（§28）仍是连接级 Host facts。
- 真实多设备审批验收仍属 §38 设备矩阵。
