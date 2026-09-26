# Android covered cursor recovery

- A real Host serves an 88-turn seeded Session to the installed Android application.
- Android loads older history and retains unsent input before the logical follow interruption.
- The first request has no cursor; the reconnect request carries the last retained durable sequence.
- The Host returns only three new records; Android retains the older page and folds each sequence once.
- The final durable row is displayed; unsent input and the single device grant remain intact.
- Recovery sends no prompt, creation, cancellation, reply, or runtime Handoff mutation.
- This scenario qualifies a logical stream interruption, not physical network loss or foreground recovery.
