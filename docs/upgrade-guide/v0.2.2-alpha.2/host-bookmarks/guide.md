---
kind: upgrade-guide
description: "Host bookmarks remain local while page connections and current Host identity no longer follow a saved selection."
---

# Open each Host in its own page

English | [中文](guide.zh.md)

## Change

The Hosts settings section retains bookmarks, names, and order. It no longer offers an in-page Switch or Back to the page Host action. The official Web connection stays on the page origin; the current Host marker follows authenticated discovery instead of a saved selection.

## Migration

1. Open Settings → Hosts. Existing `dsh-saved-hosts.v1` bookmarks need no conversion; local names and order are retained. The old `dsh-selected-host.v1` value is ignored.
2. Use **Open Host page** for a different origin. If access is refused, obtain that Host's current launch link; a bookmark is not authorization.
3. Confirm the current Host marker after connection. If discovery fails, bookmarks remain visible without claiming a current identity. Renaming or forgetting a bookmark does not switch or disconnect the page.
