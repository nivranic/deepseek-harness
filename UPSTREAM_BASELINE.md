# Upstream baseline

Status: IN_PROGRESS. This reference records the 2026-10-31 review baseline; it is not a release receipt.

## Source identities

| Source | Ref or snapshot field | Exact identity evidence |
|---|---|---|
| Official `master`, fetched directly | `refs/remotes/audit-upstream/master` | [Snapshot: official.head](.artifacts/upstream-first-review/baseline.json) |
| Current `dev` HEAD | `refs/heads/dev` | [Snapshot: candidate.head](.artifacts/upstream-first-review/baseline.json) |
| Last adopted upstream and merge-base | `adoptedUpstream`, `candidate.mergeBase` | [Snapshot](.artifacts/upstream-first-review/baseline.json), [adopted comparison](.artifacts/upstream-first-review/change-scope-adopted.json) |
| Separate implementation worktree HEAD | `refs/heads/agents/upstream-first` | [Snapshot: worktrees and branches](.artifacts/upstream-first-review/baseline.json) |

The raw snapshot records full commit identifiers, merge heads, merge-bases, and every dirty/untracked pathname. Maintained reports link that captured evidence instead of embedding commit identifiers, as required by the repository-reference policy. Ref names alone are not immutable identity evidence.

`dev` is 165 commits ahead and 351 behind the fetched official commit. The adopted-upstream comparison contains 1,233 downstream paths; the newer official changes touch 1,461 paths. These are changed-path counts, not merge-conflict counts. The [latest comparison](.artifacts/upstream-first-review/change-scope-latest.json) records its exact base and head.

## Preserved work

The separate `agents/upstream-first` worktree has an unfinished merge whose `MERGE_HEAD` is the last adopted upstream commit. Its working files, index, untracked files, and historical receipts are not reset, cleaned, committed, or imported by this review. The snapshot records every migration, compatibility, trust, settings, and Session branch HEAD and its ahead/behind counts.

The main worktree already contained untracked JavaScript/declaration outputs beside TypeScript sources. They remain untouched. Current review edits are uncommitted; no same-source release or clean-tree claim follows from the HEAD alone.

The corrected porcelain parser treats each rename/copy plus its original pathname as one status entry. The separate implementation worktree has 16,581 tracked-status entries and 29,409 untracked paths at capture. The [initial snapshot](.artifacts/upstream-first-review/baseline-initial.json) is retained separately from the corrected snapshot.

## Merge feasibility

A read-only `git merge-tree --write-tree --name-only --no-messages HEAD refs/remotes/audit-upstream/master` produced nine conflicted paths, recorded in the [merge preview](.artifacts/upstream-first-review/merge-preview.txt). Its exit status 1 denotes conflicts, not an attempted working-tree merge. The preview does not include the current uncommitted repairs; it therefore cannot authorize overwriting or merging the dirty candidate. The nine conflicts are not interchangeable with the 1,461 newer-official changed paths.

## Desktop amendment

The later requirement permits personal and official Desktop distributions to coexist. The recorded option C keeps the official application under `apps/desktop` and the personal shell under `apps/desktop-user`. Coexistence does not waive shared Host/Session/RPC authority, packaging correctness, identity isolation, or independent verification of both entry paths.

## Verification scope

The external specification path and SHA-256, live worktree states, critical ownership-path differences, and all local branch identities are in [UPSTREAM_DELTA.json](UPSTREAM_DELTA.json). The [capability inventory](CUSTOM_CAPABILITY_INVENTORY.json) explicitly leaves unreviewed ownership decisions open. Gate 0 is not PASS until source review and classification finish.
