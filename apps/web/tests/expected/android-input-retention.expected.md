# Android explicit input retention

- Question choices and custom text survive tab replacement and Activity recreation without submitting.
- A failed explicit Question reply retains its inputs; restoring transport does not settle the interaction.
- An explicit retry settles exactly one recorded Host Question result.
- A Session draft survives tab replacement and Activity recreation.
- A failed prompt submission keeps the exact text and displays a visible unconfirmed-send message.
- Restoring transport does not submit the retained draft.
- This scenario covers UI lifetime; process restoration is exercised by android-input-persistence.
