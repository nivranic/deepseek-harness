# Android Files attachments

- Installed application and instrumentation APK hashes match their current build artifacts.
- The explicit composer Files action opens the real single-document SAF picker.
- Picker cancellation preserves the text draft and sends neither fileUploads/upload nor session/prompt.
- A file larger than 512 KiB is refused locally before any upload or prompt.
- SAF uploads Chinese-named binary and empty files; independent Host storage hashes match the selected bytes.
- Removing a staged attachment changes only the local draft and sends no further upload or prompt.
- Draft text, attachment names and identities are absent from the encrypted input file raw bytes.
- Actual process termination restores the same grant, text, file receipts and request identity without uploading or sending.
- Explicit sending produces one durable user message containing the retained FileBlocks and renders their filenames on Android.
- Photos, Camera, share intents and third-party document providers are outside this scenario.
