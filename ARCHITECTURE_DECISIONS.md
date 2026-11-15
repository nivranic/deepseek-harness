# Architecture review decisions

Status: IN_PROGRESS.

## Applicable requirements

The later personal/official Desktop coexistence requirement supersedes only the original prohibition on two distributed Desktop shells. It does not authorize a second Agent loop, durable Session truth, parallel business RPC, unsafe installer/process interference, or unverified release claims.

Official package ownership, Cordis lifecycle, Typert dispatch, Connection generations, Host-owned Session/Interaction state, and shared Client tokens remain the review baseline. The fetched official architecture takes precedence over obsolete examples in the original specification, including the older no-HTTP-port Desktop description.

## Implementation lineage

`dev` is the current review/edit target. The separate `agents/upstream-first` worktree has a different implementation lineage and an unfinished merge. Its code and receipts remain preserved; importing an entire historical report, schema, or generated fixture set would not establish compatibility with current Host types.

## Parallel Desktop isolation

The source comparison confirms shared Harness/profile state, not a shared Electron userData or single-instance lock. Personal startup therefore receives a separate default Harness home before environment loading, with an explicit personal-home override; existing shared data is not moved or copied automatically. Official startup remains unchanged. Personal packaging receives a distinct product/executable, shortcut, application identifier, and install destination, with shutdown limited to owned executable paths. This correction must still pass built and installed side-by-side verification.

The fixed personal install location was not independently proven to collide with an official installation. Changing it prevents ambiguous mirror targeting; it does not justify deleting the old installation. The copied personal release scaffold is not the actual custom packager path, and does not establish updater/signing parity with official Desktop.

## Open decisions

- Complete the Adopt/Adapt/Keep/Migrate/Delete/Experimental classification against the fetched official source.
- Establish personal/official identity, storage/profile, updater, installer, and process-lifecycle isolation through real entry paths.
- Separate view-location handoff from any explicit Lite-to-Full execution/import operation.
- Reconcile retained Remote services and permission roles with current official access-policy extension points.
- Establish the actual migration chain and same-candidate native/release evidence before granting any release status.

No unresolved architectural conflict is treated as permission to expand the old implementation.
