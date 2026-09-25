# Native TLS Question reply

- missing: gateway/permission-denied; Question remains pending
- other-device: gateway/permission-denied; Question remains pending
- wrong-signature: device/key-invalid; Question remains pending
- Each code presented twice over Gateway RPC: exactly one device grant; the duplicate is rejected
- Matching device: accepted; exactly one Tool settlement; recorded turn completes with DONE
- Pairing, event stream, and reply cross the separately mounted TLS source after SPKI verification
- Settings issues the selected role after reading authenticated TLS metadata; its QR and copyable payload contain the same single-use code
- Closing removes the pairing payload; no code is persisted in browser localStorage
- Desktop and 390px layouts keep copy reachable inside Settings without horizontal page overflow
