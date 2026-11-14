# Android model selection (§30)

- A Host advertising model.select.v1 renders the composition picker entry for an open Session.
- The picker lists the Host model catalog (provider groups with routable models); tapping one model sends exactly one device-signed session/selectModel dispatch.
- The Host appends the model/selection event and the device confirms the chosen model by name; no prompt or turn is involved.
