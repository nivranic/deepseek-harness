# Android complete resource saving

- The system document picker receives the resource basename and detected MIME type.
- Unicode text, empty files and binary bytes save through the installed Activity.
- Independent filesystem reads match the complete Host bytes; saving dispatches no additional file read.
- Picker cancellation leaves the resource available without writing.
- Retiring the selected resource rejects a late picker result and removes its new empty document.
- A large resource prefix exposes no complete-file save action.
- No Host prompt or other business mutation is sent.
