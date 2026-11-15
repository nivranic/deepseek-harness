---
kind: upgrade-guide
description: "个人桌面版使用 ~/.dsh-personal 而非共享的 ~/.dsh 主目录，不迁移现有数据。"
---

# 个人桌面版数据隔离

[English](guide.md) | 中文

## 变更

个人桌面外壳此前与官方桌面应用使用相同的 Harness 主目录和 `profiles/desktop` 目录，通常位于 `~/.dsh`。现在，它在加载桌面 profile 前将运行时 `DSH_HOME` 设为 `~/.dsh-personal`。`DSH_DESKTOP_USER_HOME` 可指定其他目录，其值必须是非空绝对路径；无效值会阻止启动。继承的 `DSH_HOME` 不用于选择个人版主目录。官方桌面版的行为保持不变。

此变更不执行自动迁移。现有共享数据保留在 `~/.dsh`；个人应用在此变更过程中不会读取、复制、移动或删除这些数据。Electron 的 app.name 和 userData 保持不变，以保留现有 Electron 偏好设置。

个人 Windows 版的产品名称、可执行文件基本名称和快捷方式名称改为 `DeepSeek Harness Personal`，安装目标为 `%LOCALAPPDATA%\Programs\DeepSeek Harness Personal`。打包和安装需要由打包脚本负责人另行验证。

## 迁移

1. 更改主目录前，退出个人应用。保持 `DSH_DESKTOP_USER_HOME` 未设置即可使用 `~/.dsh-personal`，也可在启动个人应用的环境中将其设为经过明确选择的独立绝对目录，此处以 `<personal-home>` 表示。该值必须非空且为绝对路径。
2. 将现有共享数据保留在 `~/.dsh`。根据需要在个人应用中单独配置凭据和设置。不要复制仍在使用的凭据或会话文件，也不要在同时运行时选择官方应用的主目录。
3. 启动个人应用，确认其 profile 和锁路径分别位于 `<personal-home>/profiles/desktop` 和 `<personal-home>/profiles/desktop/lock`，而不是 `~/.dsh/profiles/desktop`。确认官方应用仍使用原有主目录。这些启动检查需要打包脚本负责人手动验证；聚焦路径测试只验证路径解析，不安装任何应用。
