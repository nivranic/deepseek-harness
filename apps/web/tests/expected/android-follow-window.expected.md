# Android persisted follow window across process death

- A real Host serves a seeded Session; Android loads one older history page before the process is killed.
- The first request has no cursor; after process death the reopened request carries the persisted durable sequence.
- The Host returns only the three records appended during the interruption; the persisted older page folds back without a gap or duplicate.
- Unsent input, the single device grant, and the displayed first row survive the restart.
- Reopening sends no prompt, creation, cancellation, reply, or runtime Handoff mutation.
- This scenario qualifies process-death persistence, not physical network loss or foreground recovery.
