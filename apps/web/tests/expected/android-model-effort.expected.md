# Android model effort selection (§30)

- The composition picker lists each reasoning model's effort choices under its row; a model without reasoning offers none, and its model-row tap sends no effort field.
- Tapping one effort sends exactly one device-signed session/selectModel dispatch carrying the provider, model, and reasoningEffort; the Host appends the model/selection event and the device confirms by model and effort name.
- No prompt or turn is involved; the selection rides the shared model-select capability.
