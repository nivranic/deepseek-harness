# Android persisted follow window across a backgrounded carrier loss

- A real Host serves a seeded Session; Android loads one older history page and three further records before backgrounding.
- While the application holds no window focus, the Host-side terminateDeviceConnections primitive destroys its stream carrier; the backgrounded process re-opens follow on its own with the last applied durable sequence.
- Three records appended while backgrounded are consumed by the re-attached background follower, so the cursor advances without the UI; a plain launcher return brings the same singleTask application back without routing any intent.
- On foreground return the merged window keeps the retained older page and all six appended records contiguously — no full Session re-download; unsent input and the single device grant survive; no prompt, creation, cancellation, reply, or runtime Handoff mutation is sent.
- This scenario qualifies backgrounded reconnect and foreground presentation for the persisted window; a healthy background round-trip by design produces no new follow request, OS background-kill behaviors, FCM delivery, and real devices remain unqualified.
