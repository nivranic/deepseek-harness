---
kind: upgrade-guide
description: "Personal desktop uses ~/.dsh-personal instead of the shared ~/.dsh home without migrating existing data."
---

# Personal desktop data isolation

English | [中文](guide.zh.md)

## Change

The personal desktop shell previously used the same Harness home and `profiles/desktop` directory as the official desktop app, normally `~/.dsh`. It now sets its runtime `DSH_HOME` to `~/.dsh-personal` before loading the desktop profile. `DSH_DESKTOP_USER_HOME` selects an explicit alternative and must be a nonempty absolute path; an invalid value stops startup. An inherited `DSH_HOME` does not select the personal home. Official desktop behavior is unchanged.

There is no automatic migration. Existing shared data remains in `~/.dsh`; the personal app does not read, copy, move, or delete that data during this change. Electron app.name and userData remain unchanged, preserving existing Electron preferences.

The personal Windows product, executable basename, and shortcut name become `DeepSeek Harness Personal`, with installation target `%LOCALAPPDATA%\Programs\DeepSeek Harness Personal`. Packaging and installation require separate verification by the packaging-script owner.

## Migration

1. Quit the personal app before changing its home. Leave `DSH_DESKTOP_USER_HOME` unset to use `~/.dsh-personal`, or set it in the environment that launches the personal app to a deliberately chosen, separate absolute directory, represented here by `<personal-home>`. The value must be nonempty and absolute.
2. Keep existing shared data in `~/.dsh`. Configure credentials and settings separately in the personal app as needed. Do not copy live credential or session files, and do not select the official app's home for simultaneous use.
3. Launch the personal app and confirm its profile and lock resolve under `<personal-home>/profiles/desktop` and `<personal-home>/profiles/desktop/lock`, not `~/.dsh/profiles/desktop`. Confirm the official app still uses its original home. These launch checks require manual verification by the packaging-script owner; the focused path tests verify resolution without installing either app.
