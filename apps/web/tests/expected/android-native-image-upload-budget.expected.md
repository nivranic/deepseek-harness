# Android complete image upload request budget

- Installed application and instrumentation APK hashes match the tested builds.
- The paired Host advertises the 2048-byte HTTP body budget and staged-image upload through versioned native capabilities.
- A padded real PNG fits the local source limit and the Host budget as encoded arguments, but its complete signed request is refused locally.
- The refusal preserves the typed draft, with zero upload or prompt invocation.
- Completed client HTTP counts match the observed unary calls around each pick, so no extra upload POST reaches the Host.
- After deleting the refused source photo, another explicit Photos selection queries a fresh budget and uploads the small metadata-free PNG.
- Host storage and session-authorized reading return the verified PNG bytes; the image reference keeps raster dimensions and MIME.
- Only the final explicit send creates one durable user message with an ImageBlock after the text.
- The Android process, Host identity, model owner and one device grant remain unchanged.
