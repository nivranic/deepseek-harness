# Android connection outage (§29)

- The Host-side terminateDeviceConnections primitive destroys the paired device's physical stream carrier, which the device reads as carrier loss: the location-facts line leaves its settled form and publishes the reconnecting state word.
- After the reconnect delay the follow stream re-opens, the state word clears, and the settled facts line (Host · workspace basename · preset word) returns unchanged; the device admission itself was never revoked.
- The outage is deterministic — no adb-reverse removal is involved — closing the gap the location-facts lane documented (an idle follow stream cannot detect a removed reverse tunnel).
