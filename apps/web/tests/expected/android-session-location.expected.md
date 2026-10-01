# Android session location facts (§29)

- An open Session renders one facts line naming the paired Host, the workspace directory basename, and the permission preset word, plus a detail line publishing the full-runtime word and the full workspace path.
- The facts read published Host data only — no prompt, turn, or model call is involved. The live outage-state word rendering is covered by the JVM connection-state tests; a deterministic device-level outage needs a Host-side stream kill (see the note).
