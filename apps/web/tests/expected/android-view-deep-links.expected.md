# Android view-position deep links

- Installed acceptance APK hashes match the current build artifacts.
- Real public VIEW/BROWSABLE delivery resolves the application and a viewer can navigate the selected trusted Host without another confirmation.
- Wrong-Host and malformed links open no Session follow or history request and preserve both drafts.
- A pending Share proposal rejects link navigation; dismissing it cannot silently retry the rejected link.
- Explicit retry reveals the old persistent anchor in an 88-turn Session and preserves the target draft.
- The native copy action wraps the existing Web v1 payload; repeated new delivery of the same URI reveals the anchor again.
- A failed history read requires explicit retry, and an opening link rejects a concurrent Share delivery.
- Process death discards pending navigation authority; normal restart restores drafts without requesting the old anchor.
- A genuinely new cold VIEW launch waits for the same trusted Host restoration and opens the requested anchor once.
- Navigation submits no prompt, upload, Session creation or runtime migration and redeems no additional grant.
- Evidence covers the tested emulator and native scheme, not physical devices, browser distribution, HTTPS App Links or other platform shells.
