# Android encrypted input persistence

- A saved Question choice and custom answer survive force-stop and restoration in a different process.
- Restoring input and transport does not answer the Host Question; explicit submission settles one result.
- A failed explicit prompt saves its original request identity and text before dispatch.
- Force-stop preserves the last selected Session, original pending prompt, and a newer composer draft.
- A different process restores the same pending request identity without sending either retained text.
- Process restoration uses the existing Host device grant.
- Corrupt ciphertext and a missing input key preserve the original bytes and display explicit recovery.
- Reading input does not recreate a missing key; explicit recovery preserves a byte-identical backup before saving empty input.
