# Android Session-list recovery

- An authenticated empty list displays its empty state and disables send and stop without an open Session.
- Removing only the test Host port forward makes an explicit list refresh fail with a visible transport message.
- The retry control remains available; transport recovery itself does not replay a user mutation.
- Restoring the port forward and tapping retry loads the list and removes the failure message.
- Revoking the device grant makes a later refresh display the classified Host refusal.
- The test closes its transport and releases its private forwards and emulator lease.
