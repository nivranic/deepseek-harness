# Native TLS Question reply

- missing: gateway/permission-denied; Question remains pending
- other-device: gateway/permission-denied; Question remains pending
- wrong-signature: device/key-invalid; Question remains pending
- Each code presented twice over Gateway RPC: exactly one device grant; the duplicate is rejected
- Matching device: accepted; exactly one Tool settlement; recorded turn completes with DONE
- Pairing, event stream, and reply cross the separately mounted TLS source after SPKI verification
