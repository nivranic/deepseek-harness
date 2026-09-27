# Android Photos and Files attachments

- Both installed acceptance APK hashes match the current build artifacts.
- The explicit Photos action opens the real system image picker without broad media permission.
- Cancelling preserves the draft and sends neither upload nor prompt.
- Photos and SAF Files share one ordered draft; removing an image makes no Host call and reselecting creates a new receipt.
- Independent Host storage hashes match the known metadata-free PNG and binary file; image references retain raster dimensions and MIME.
- Raw encrypted input contains no draft text or attachment identities.
- After removing the test-owned source photo, actual process termination restores the same grant, mixed order and request identity without upload or prompt.
- Explicit sending records one user-origin message with ImageBlock, FileBlock and ImageBlock in the selected order.
- Session-authorized image reading returns the verified PNG; Android renders the sent attachment names.
- Vision response uses a keyless recorded reply; live-model image understanding, Camera and share intents remain unverified.
