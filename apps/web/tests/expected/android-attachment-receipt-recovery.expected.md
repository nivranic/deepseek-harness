# Android attachment receipt recovery

- A real SAF upload is verified against Host storage before the owning Session is flushed, disposed and resumed.
- The same Host and durable Session id retain distinct live Session objects; the old receipt is no longer authorized.
- Explicit sending receives session/attachment-invalid with FILE_NOT_STAGED and displays local recovery guidance.
- The rejected pending intent retains its original text, attachment and request id while a different newer draft survives.
- Retrying the pending intent sends its unchanged arguments and receives the same real refusal without a durable user message.
- Explicit discard preserves the newer draft; removing and reselecting its attachment creates a new receipt and request identity.
- Two uploads and three prompt calls produce exactly one accepted user message, only after the final explicit send.
- The application PID, Host identity, local Session model and single device grant remain unchanged; normal teardown completes.
- This case qualifies Session-disposal receipt invalidation for SAF files, not a time expiry, Host restart or photo recovery.
