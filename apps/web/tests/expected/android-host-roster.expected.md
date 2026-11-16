# Android saved Host selection

- Two real Hosts store distinct grants and expose the same Session id.
- Pairing Host B keeps Host A saved; returning to either Host restores only its own draft.
- The current Host label follows the selected saved identity.
- A different process restores Host B and its draft without submitting a prompt or redeeming a grant.
- Explicit submission reaches Host B once; Host A receives no prompt and retains its own draft.
- Switching back and Activity recreation preserve Host A input; each Host retains exactly one device grant.
