# Android persisted follow window across carrier loss

- A real Host serves a seeded Session; Android loads one older history page and three further records before the outage.
- The Host-side terminateDeviceConnections primitive destroys the paired device's stream carrier — a real transport break that the device detects on its own, with no adb-reverse removal involved.
- The re-opened follow requests a complete bounded window and verifies its overlap with retained history; nothing was appended during the outage.
- After reconnection three more records arrive on the re-opened stream and fold into the retained page without a gap or duplicate.
- Unsent input and the single device grant survive the carrier loss; reconnection sends no prompt, creation, cancellation, reply, or runtime Handoff mutation.
- This scenario qualifies carrier-loss resume for the persisted window; foreground/push recovery and real devices remain open.
