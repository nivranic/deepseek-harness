---
kind: upgrade-guide
description: "The re-introduced 1017 model badge package is removed again; model badges come from the DeepSeek model listing."
---

# The `ui-deepseek-model-label-1017` package is removed again

English | [中文](guide.zh.md)

## Change

The lane re-introduced `@deepseek-ai/dsh-client-ui-deepseek-model-label-1017` after the release that first removed it ([frozen guide](../../v0.2.1-rc.2/model-badge-package-removal/guide.md)); its temporary 1017 badge is now over a month past date, so the package and its `ui-deepseek-model-label-1017` row in the Web bundle are removed again and the package receives no further releases. The composer model selector keeps showing the badge that the DeepSeek `GET /models` listing declares for a model; without a declared badge, `DeepSeek-V4.1-Flash` shows no `1017`.

## Migration

1. Delete the patch whose `id` is `ui-deepseek-model-label-1017`, with its `disabled` or other fields, from `$DSH_HOME/profiles/<profile>/cordis.patch.yml` and from any overlay passed with `--patch`.
2. Remove `@deepseek-ai/dsh-client-ui-deepseek-model-label-1017` from the dependencies of any package that lists it.
3. To change how model names or badges render, contribute to the `conversation.input.model.label` slot; its owner props carry the catalog `model.badge` ([label extensions](../../../../packages/client/ui-model-selection/README.md#use-this-package)).
4. Restart DSH and confirm that boot reports no missing `ui-deepseek-model-label-1017` entry.
