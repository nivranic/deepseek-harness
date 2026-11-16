# Agent Note: 在应用启动前检查组合后的 profile

Status: implemented

[English](2026-09-16-shipped-profile-composition-check.md) | 中文

## 问题

单独有效的 bundle patch 组合后可能插入相同的 Loader id。配置元数据和包解析检查可以通过，而 Loader 直到启动时才拒绝重复 id。id 也是跨嵌套分组的 patch 查找键，因此重复 id 会让后续覆盖产生歧义。另一类 Host/preset 重叠会重复挂载注册贡献者，或让 Session 内的 Provider 遮蔽 Host Provider。只检查 Web patch 会漏掉 Desktop patch 重新启用 preset 所属条目的情况。

## 决策

现有 [Cordis 配置检查](../../../../scripts/verify-cordis-config.ts)通过 [profile 组合分析](../../../../scripts/verify-profile-compositions.ts)检查全部已声明的 CLI profile 及 Desktop 私有 patch。TypeScript 语法提供 `PROFILE_TEMPLATES` 和 `DESKTOP_PROFILE_BUNDLES` 中有序的 bundle 名称，工作区 manifest 提供 patch 文件。缺失、空或动态构造的清单会明确失败。检查复用启动器的 `loadOverlayPatches` 和 `composeEntries`，保留按 id 覆盖、整份 config 替换和未执行的插件表达式。

每棵组合后的 Loader 树都拒绝重复 id，包括嵌套分组和禁用条目。不同 profile 可以复用 id。普通插件的配置数组不属于条目列表。挂载 `dsh-agent-presets` 的 Host 使用最终组合后的条目与每份内置 preset 比较；静态禁用的祖先同时禁用其后代，表达式控制的条目仍视为可能启用。preset corpus 为空时会失败，不会省略比较。

[Profile/bundle 决策](../architecture/2026-08-05-profile-plugin-bundles.zh.md)继续拥有顺序与激活规则。本检查不引入 Desktop bundle，不从 npm 依赖推断组合，不改变 Loader 行为，也不验证用户安装的 profile。测试覆盖声明格式错误、重复插入、合法的后续覆盖、仅发生于 Desktop 的重叠、禁用分组及未执行的表达式。现有 `verify-cordis-config` 命令仍由仓库检查聚合执行。

## 考虑过的替代方案

**把所有依赖 base 的 bundle 与 base patch 比较。** npm 依赖确定包的可用性，不决定激活顺序。这会漏掉模式层之间及 Desktop 私有覆盖产生的冲突，也可能拒绝从不共同组合的 bundle。

**维护另一套 patch 合并器或固定 profile 表。** 两者都可能与应用启动偏离。读取所属声明并使用生产组合函数，可以让检查使用同样的输入和语义。

**只依赖应用启动。** 启动仍拥有运行时验证，但内置且静态可见的重复 id 或 Host/preset 重叠可以在启动应用或产物前被拒绝。

## 影响

检查覆盖静态声明的内置组合，不执行插件代码。清单声明语法变化时，必须同步更新读取器和拒绝用例。条件配置、任意第三方 profile 及运行时服务关系仍需各自的测试。将 Git 符号链接检出为文本的 Windows 工作区可能独立触发 Loader YAML 验证失败；临时物化源码 fixture 与确认该工作区可直接使用是不同的证据。
