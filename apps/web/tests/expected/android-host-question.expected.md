# Android saved Host Question isolation

- A plain Host exposes no pending interaction while the same Session id on another Host raises a Question.
- Switching to the questioning Host never surfaces its Question card, options, or answer draft.
- Returning to the questioning Host restores its Question and the retained draft; a different process restores both.
- The draft submits exactly once through the questioning Host and completes its recorded turn.
- The plain Host receives no prompt and no interaction reply; each Host retains exactly one device grant.
- After the answer the retired Question never appears on the other Host.
