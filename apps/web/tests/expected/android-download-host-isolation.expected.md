# Android download Host isolation

- Installed application and instrumentation APK hashes match their current build artifacts.
- Two real Hosts expose different 9 MiB contents under the same Session id and relative file path.
- Host A commits 128 KiB before temporary failure; its observed unary gateway invocations finish before switching.
- Host B has no download controller or inherited progress; selection reads only its own 256-byte preview.
- Explicit download on Host B starts at byte zero and completes every 64 KiB window, with no further workspace byte reads from Host A.
- Returning to Host A restores exactly 128 KiB as PAUSED and reads only its own 256-byte preview.
- Explicit continuation on Host A starts at byte 131072 and completes every missing window, with no further workspace byte reads from Host B.
- Neither Host receives a prompt or business mutation; each retains exactly one device grant.
