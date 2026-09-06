# Agent Note: 折叠侧边栏中的本地化设置名称

Status: implemented

[English](2026-09-06-settings-rail-accessible-name.md) | 中文

## Problem

设置按钮从注册的内容取得无障碍名称。在折叠侧边栏中移除标签，会留下没有名称的图标按钮，辅助技术与按名称执行的操作无法识别它。窄视口可自动进入这一状态。

## Decision

[设置入口](../../../../packages/client/ui-settings-general/README.zh.md)在两种侧边栏宽度下均保留由 locale 所有的文字。折叠呈现通过视觉裁剪隐藏文字，不将其移出无障碍树，也不改变图标按钮的尺寸。外壳继续从 slot 内容取得名称。

## Alternatives considered

- 移除标签或对其使用 `display: none`，也会移除基于内容的无障碍名称。
- 为外壳另加一份翻译标签，会在外壳和内容注册方之间重复文案所有权。

## Consequences

英文与中文折叠控件均可识别，并打开相同的设置面板。组件检查与所有者本地的浏览器 ARIA 快照覆盖两种语言。浏览器对照检查展开和折叠按钮的尺寸保持一致。打包桌面验收仍通过 Windows 候选生产者执行。
