/** Index every source line while keeping unreviewed requirements explicitly unaccepted. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { specificationSections, validateTraceability, sha256 } from './specification-traceability.mjs';
const path = 'artifacts/upstream-first/original-specification.md';
const source = fs.readFileSync(path);
const expected = JSON.parse(fs.readFileSync('UPSTREAM_DELTA.json')).specification.sha256;
const extracted = specificationSections(source.toString('utf8'));
const families = [
  { ids: [0,2,4,5,9,11,27,48,72,75,78,80], owner: '官方架构、Host 权威和薄平台壳', evidence: ['docs/architecture.md', 'ARCHITECTURE_DECISIONS.md'], remaining: '继续按各 owner 核验唯一运行时、Session、RPC 和共享 Client；实验项不等同正式产品验收。' },
  { ids: [1], owner: 'Upstream 基线与差异审计', evidence: ['UPSTREAM_DELTA.json', 'artifacts/upstream-first/component-reviews.json', '.artifacts/upload-home-replay-gate0.log'], remaining: 'Gate 0 已有来源审计证据；仍需将本章每项记录义务与具体字段逐项对应，不能把 Gate 0 推广为产品完成。' },
  { ids: [3,56,68], owner: '官方 Desktop 与 updater', evidence: ['artifacts/upstream-first/desktop-package-source.json', 'PLATFORM_VERIFICATION.md', 'RELEASE_STATUS.md'], remaining: 'Windows 安装、插件安装、升级、系统登录和 macOS 实测、签名、公证仍待完成。' },
  { ids: [6,7,8,10,36,52,53,64,65,66], owner: '共享 Client 响应式与原生输入', evidence: ['PLATFORM_VERIFICATION.md', 'docs/plans/2026-09-14-upstream-first.zh.md'], remaining: '尚无规格要求的完整尺寸/主题/状态/访问性矩阵，以及 iOS/Android 真机输入、后台与原生附件验收。' },
  { ids: [12,13,14,17,18,19,30,45,47,55], owner: 'Typert、Connection 与业务操作 owner', evidence: ['COMPATIBILITY_MATRIX.md', 'artifacts/upstream-first/upload-home-replay-source.json', 'artifacts/upstream-first/dynamic-cordis-runtime-source.json'], remaining: '发现、独立能力与部分协议已有证据；仍需完整多版本/多语言矩阵、设备撤销状态、闭合错误语义和变更身份确认。' },
  { ids: [15,16,38,67], owner: 'Interaction、Session 与恢复', evidence: ['IMPLEMENTATION_STATUS.md', 'docs/defensive-patterns.md'], remaining: '已有回答竞争、断线和重启证据；权限执行、完整审批信息、后台/休眠、持久化确认和跨端恢复仍待逐项实现及验证。' },
  { ids: [20,21,22,24,39,40,69,70,71], owner: 'Device Trust、凭据与本地认证', evidence: ['SECURITY_STATUS.md', 'ARCHITECTURE_DECISIONS.md'], remaining: 'Pair/Role/Revoke、安全存储、重放/降级威胁审查和远端执行授权未完成；保留既有 local Host/Origin 防线。' },
  { ids: [23,25,26,28,29], owner: 'Remote Carrier、Session 查看位置与 Host 选择', evidence: ['ARCHITECTURE_DECISIONS.md', 'COMPATIBILITY_MATRIX.md'], remaining: '需在共享 Contract/Trust 上完成 follow cursor、查看位置 handoff、多 Host 和明确执行位置，不迁移运行时语义。' },
  { ids: [31], owner: '受限 Lite profile 与工具目录', evidence: ['apps/android/core/src/main/kotlin/ai/deepseek/dsh/companion/LiteToolPermissionPolicy.kt', 'apps/android/core/src/main/kotlin/ai/deepseek/dsh/companion/LiteToolRegistry.kt', 'apps/android/core/src/main/kotlin/ai/deepseek/dsh/companion/LiteLoop.kt', 'apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/LiteToolPermissionPolicyTest.kt'], remaining: '§31 权限策略已落地（四件套之三齐）：LiteToolPermissionPolicy 决策点在 LiteLoop 的 ToolCall 分支逐调用咨询，三分决策 AllowLocal/Handoff/Unknown——HOST_DECLARED 走声明门梯（not-lite → 无 bundled 执行面 → risk∈{high,critical} → permissions 非空 → 放行，与 LiteToolCatalog 语义对齐不猜），BUNDLED_FALLBACK 无宿主风险事实故只走 bundled capability 判定（§37 风险只读 Host 输出）；词汇复用 ToolRisk 与 ToolDescriptor.permissions 零平行模型（§72）；未知名从静默悬挂改为显式失败 tool/result 收口（fold/journal 词汇零改动）。runtimeMode=lite 公开、审批交互（ask 档与 Approval UI 对齐）、tool-call 结果回喂模型（规格附录明言内置执行延后 P2）、app 层运行时接线与 Full Mobile Host 保持实验范围。' },
  { ids: [33], owner: '受限 Lite profile 与工具目录', evidence: ['packages/preset/agent-presets/lite-preset-descriptors.json', 'scripts/gen-lite-preset-catalog.ts', 'packages/preset/agent-presets/src/types.ts', 'apps/android/contract/src/main/kotlin/ai/deepseek/dsh/contract/LitePresetDescriptor.kt', 'apps/android/core/src/main/kotlin/ai/deepseek/dsh/companion/LitePresetCatalog.kt'], remaining: '§33 复用通道已落地：gen-lite-preset-catalog 真 boot 每个 shipped preset、经官方 ctx.systemPrompt.assemble() 收割实文投影 lite-preset-descriptors.json（persona 行+assembledSystemPrompt；doc-sync 挂 verify-lite-preset-catalog；运行时变量预设入 excluded 清单不伪造、!!js 延迟布尔 fail-loud）；Android :contract 镜像解析 fail-loud、LitePresetCatalog 双源（HOST_PROJECTED/BARE），LiteProviding 接缝扩展可选 system、LiteHTTPProvider 请求体首位条件插入，BARE/空投影与现状逐字节一致，Kotlin 源零自有 prompt 文本。Lite 经 profile/preset 之外的上下文组合、preset 选择 UI、app 层运行时接线与 Lite 工具权限策略仍待实施。' },
  { ids: [32], owner: '受限 Lite profile 与工具目录', evidence: ['packages/core/tools/tool-descriptors.json', 'packages/core/tools/lite-tool-schemas.json', 'scripts/gen-tool-catalog.ts', 'packages/core/tools/src/capabilities.ts', 'packages/core/tools/src/index.ts', 'apps/android/contract/src/main/kotlin/ai/deepseek/dsh/contract/ToolDescriptor.kt', 'apps/android/contract/src/main/kotlin/ai/deepseek/dsh/contract/LiteToolSchema.kt', 'apps/android/core/src/main/kotlin/ai/deepseek/dsh/companion/LiteToolRegistry.kt', 'apps/android/core/src/main/kotlin/ai/deepseek/dsh/companion/LiteToolSchemaCatalog.kt'], remaining: '§32 声明面与模型面已落地：ToolDefinition 必填 version/risk/permissions/supportsLite/supportsRemote（注册边界 fail-loud；模型投影与 SessionEventMap 零变化），descriptors() 投影经 Remote tools 命名空间（tool.catalog.v1 + tools/list）按 §37 先例广播，gen-tool-catalog 产出机器可读 tool-descriptors.json 与模型面投影 lite-tool-schemas.json（supportsLite 过滤 + schemas() 收割 join、同名冲突仅 Lite 域 fail-loud、跨包同名非 Lite 变体不参与）；Android 侧 :contract 镜像解析 fail-loud 并对拍两份投影（schemas 名集 ⊆ supportsLite id 集），LiteToolCatalog 双源（HOST_DECLARED/BUNDLED_FALLBACK 显式标记）替换 LiteLoop 按名猜测，未声明名交回 full runtime 不猜，网关按 capability 协商拉取；LiteToolSchemaCatalog（HOST_PROJECTED/BARE）经 LiteHTTPProvider 构造态参数把 OpenAI function 形 tools 数组条件注入请求体（空表省键、BARE 与现状逐字节一致，system/tools 同为 request-face 不入 journal）。Android 本地名与宿主工具名对齐（url_fetch 等 vs web_fetch 等）、app 层运行时接线（assets 打包）、Lite 工具权限策略与 tool-call 循环处理仍待实施。' },
  { ids: [34,35], owner: '共享 Diff、文件与 Artifact', evidence: ['artifacts/upstream-first/file-upload-capability-source.json', 'artifacts/upstream-first/upload-home-replay-source.json'], remaining: '上传/读取回放只证明局部路径；大文件、Range、中断、二进制、MIME 和共享 Diff 矩阵未完成。' },
  { ids: [37], owner: 'Host Command/Tool 风险事实', evidence: ['SECURITY_STATUS.md', 'packages/interaction/commands/README.md'], remaining: '需要 Host 输出和执行策略一致的风险等级，不能从已有 capability 准入推断风险分级完成。' },
  { ids: [41,42,43,44], owner: 'Health、Readiness、Diagnostics 与 Support', evidence: ['SECURITY_STATUS.md', 'RELEASE_STATUS.md'], remaining: '共享诊断、可接受请求的 readiness、分类型默认关闭 telemetry、脱敏和同候选 support collector 验证仍待完成。' },
  { ids: [46], owner: '持久化与显式转换', evidence: ['ARCHITECTURE_DECISIONS.md', 'artifacts/upstream-first/storage-owner-report-validation.json'], remaining: 'Storage 生命周期证据不替代旧 Session/设置的完整 adjacent/atomic/recoverable 转换；禁止直接覆盖用户唯一副本。' },
  { ids: [49,50], owner: '旧能力处置与新增可靠性边界', evidence: ['CUSTOM_CAPABILITY_INVENTORY.json', 'UPSTREAM_DELTA.md'], remaining: '逐项核对 15 项旧能力及新增网络、时钟、重装、通知、工作区移动事项；历史实现和产物不自动成为新候选证据。' },
  { ids: [51,54,58,59,60,73,74,77], owner: '验收矩阵、Gate 与证据规则', evidence: ['RELEASE_STATUS.md', 'PLATFORM_VERIFICATION.md', 'COMPATIBILITY_MATRIX.md', 'SECURITY_STATUS.md'], remaining: 'Gate 0 之外仍有目标平台、网络、兼容、安全与同候选证据缺口；产物存在或窄测试通过不证明 RC。' },
  { ids: [61,62,63,76,79], owner: '阶段顺序、文档与交付记录', evidence: ['IMPLEMENTATION_STATUS.md', 'artifacts/upstream-first/evidence.json', 'docs/plans/2026-09-14-upstream-first.zh.md'], remaining: '维持 Phase 0–12 完整范围和七份阶段报告；当前未提交，未来提交需按独立变更拆分并说明来源、影响与验证。' },
  { ids: [57], owner: '原生移动发布', evidence: ['RELEASE_STATUS.md', 'PLATFORM_VERIFICATION.md'], remaining: 'Native Companion 前置完成后，仍需签名、实际安装/升级、安全存储、深链和后台/进程死亡验证。' },
];
const ownership = new Map();
for (const family of families) for (const id of family.ids) { assert.ok(!ownership.has(id)); ownership.set(id, family) }
assert.equal(ownership.size, 81);
for (const family of families) for (const evidence of family.evidence) assert.ok(fs.existsSync(evidence), evidence);
const record = {
  schemaVersion: 1, status: 'IN_PROGRESS', capturedAt: new Date().toISOString(), fullGoalComplete: false,
  specification: { path, sha256: sha256(source), recovery: 'artifacts/upstream-first/original-specification-recovery.json' },
  scope: '原方案逐项核验入口；源文完整覆盖不代表需求验收通过。建议、示例、实验和硬性要求保持原文语境。',
  coverage: { status: 'PASS', numberedSections: 81, nonEmptySourceLines: extracted.preamble.length + extracted.sections.reduce((n, s) => n + s.sourceUnits.length, 0) },
  preamble: extracted.preamble,
  sections: extracted.sections.map(section => {
    const family = ownership.get(section.number);
    return { ...section, verificationStatus: 'NOT_STARTED', acceptanceProven: false, owner: family.owner,
      candidateEvidence: family.evidence, remaining: family.remaining,
      evidenceLimit: '这些路径是已定位的候选证据；尚未逐条证明本节每一项要求，不授予整节 PASS。' };
  }),
  nextExecution: [
    '先核对 Phase 2 剩余 Desktop 安装/插件/恢复约束；已有 Windows 窄证据不覆盖 macOS 或签名。',
    '沿现有 Typert 和领域 owner 完成 Phase 3 Error/Idempotency，补齐 N-2 diagnostics-only 与未知 Client UX。',
    '随后按 Phase 4–12 推进，不以现有能力准入和 Windows 浏览器测试替代原生、网络与发布矩阵。',
  ],
};
const validated = validateTraceability(record, source, expected);
fs.writeFileSync('artifacts/upstream-first/specification-traceability.json', JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(validated));
