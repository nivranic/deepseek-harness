# Android notification permission recovery

- Current installed APKs start without a notification grant or retained user-set/user-fixed permission flags.
- The real permission dialog is denied; Activity recreation retains the Application-owned request history.
- The application opens its own notification settings, and a real Host event is consumed while notifications are disabled.
- The actual application-level switch grants notifications; a real Back action refreshes the visible application state.
- The same PID, controller, Host, Session, models, complete draft and pending prompt survive settings and rotation.
- The consumed disabled event is not posted after grant or rotation; the next Host event produces a minimized notification.
- The healthy Push subscription stays single, and recovery adds no prompt, reply, cancel, upload, creation, handoff or pairing redemption.
- Both Host approval waits are cancelled by the fixture and normal instrumentation teardown succeeds.
- Evidence is limited to this emulator and application-level grant; channel enablement, settings revocation, process death and physical devices remain unqualified.
