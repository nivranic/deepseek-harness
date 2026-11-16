# Android persisted follow window across process death

- A real Host serves a seeded Session; Android loads one older history page before the process is killed.
- After process death the reopened request uses the original address and page bound, without a wire resume cursor.
- The Host returns a complete bounded window including the three appended records; Android verifies its overlap with the persisted older page before merging.
- Unsent input, the single device grant, and the displayed first row survive the restart.
- Reopening sends no prompt, creation, cancellation, reply, or runtime Handoff mutation.
- This scenario qualifies process-death persistence, not physical network loss or foreground recovery.
