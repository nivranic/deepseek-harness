# Agent Note: 宿主产物生产方

Status: implemented

[English](2026-08-31-host-artifact-producer.md) | 中文

## 问题

产物词汇先行落地时没有生产方：宿主没有代码创建产物或记录事件，面板仍只是"原则上可消费"，`LinkSessionEventKind` 也仍列旧标签而无活事件可观察。第 56 章钉死了生产方必须遵守的切分——日志携带引用、元数据与状态；内容字节活在资源通道里。

## 决策

`dsh-artifact` 从纯词汇长为缝主：`ctx.artifacts`（`ArtifactStore`：按引用 id 的 `put`/`get`/`remove`——与 Lite 存储暴露的形状相同）加模型可见的 `artifact_create` 工具。一次调用创作一件完整产物：工具要求有归属的 agent 会话，修剪并校验 `kind` 与 `title`，铸造 `art-<uuid>`，记录 `artifact/created`，经通道写入 UTF-8 字节，再记录 `artifact/status`——成功 `ready`，否则记录 `failed` 并透出通道错误。跨模型、wire、持久日志或文件系统输入的产物 id 遵循唯一可移植语法：`art-` 后接仅含 ASCII 字母、数字或连字符且以字母或数字首尾的主体，总长至多 128 个字符。`artifact_read` 在查询通道前校验，Session Remote 控制器在分发前校验，事件不变量在持久化前校验，每个本地后端操作在生成文件名之前再次校验；保留清扫忽略外来的 `.artifact` 名称。`dsh-artifact-local` 是出厂通道：`<DSH_HOME>/artifacts` 下每引用一个原子 `<id>.artifact` 文件（属主私有权限，独占创建的临时文件改名覆盖目标——`writeFileAtomic` 为此获得 `Uint8Array` 内容支持），缺席读为 null，删除静默。持久不变量伴随还强制非空且已修剪的类别与标题、封闭状态集与开回合关系，对孤儿状态有意沉默——每个折叠里的合法 no-op。`LinkSessionEventKind` 增长两个产物标签（现 15 个），经既有漂移门禁再生进 Swift 与 Kotlin 模型；原生折叠零改动——它们已消费原始事件记录。出厂 base bundle 为不使用名单的应用同时挂载工具与后端。Web 与桌面 overlay 均禁用进程级 `dsh-artifact` 行，把 `dsh-artifact-local` 留在宿主面，并在 `standard`、`ptc` 与 `cordis` agent preset 中挂载 `dsh-artifact`；`minimal` preset 有意省略该行。工具 schema 目录在抛弃式 home 上引导真实配对并文档化生成的 schema，Web 回合快照与桌面组合测试则钉住作用域内目录。

## 后果

模型能端到端产出并读取一等产物：日志可回放、伴侣可渲染，字节在宿主上持久。远程产物面板在配对设备跟随一个调用该工具的会话时即为可用。[二进制输入](2026-08-31-artifact-binary-input.zh.md)、[分页读取](2026-08-31-artifact-paged-reads.zh.md)与[保留策略](2026-09-01-artifact-retention.zh.md)规定了这个生产方的当前扩展。

## 考虑过的替代方案

内容寻址存储（attachment 族的模型）被延后——产物按调用在铸造的引用 id 下创作，保留策略存在前去重无收益；id 键控的通道转而镜像 Lite 存储，保持缝跨运行时对称。把内容内联进日志（或事件里 base64）被直接否决——第 56 章禁止内容上日志。为中继的离线设备排队状态事件不在范围——产物的存在性随日志回放传播，不随推送。
