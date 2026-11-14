# Android Camera attachments

- Both installed acceptance APK hashes match the current build artifacts.
- The explicit Camera action opens the installed system camera with a full-size, app-owned JPEG output.
- Cancelling preserves the exact draft, removes the owned temporary file and makes no Host call.
- The independently read temporary file hash matches the uploaded JPEG; its dimensions exceed thumbnail size.
- Sending stays unavailable while staging is held; completion removes the capture after the Host operation settles.
- Independent Host storage hashing matches the image reference; normalization can change encoding and remove metadata.
- Actual process termination with another Camera selection pending restores only the completed receipt and draft identity.
- Restart removes the orphan capture without restoring upload authority or issuing a prompt.
- Explicit sending records one user-origin ImageBlock; Session-authorized image reading returns the stored bytes.
- Model output uses a keyless recorded reply; physical cameras, live visual understanding and share intents remain unverified.
