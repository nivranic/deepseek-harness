# Android persistent downloads

- Installed application and instrumentation APK hashes match their current build artifacts.
- A 9 MiB resource remains a bounded preview while its complete download is encrypted on disk.
- Temporary failure retains the committed prefix; an active download survives process death as paused progress.
- Restoration performs no automatic download; explicit continuation starts at the first missing byte.
- The real system picker saves complete large and empty files; independent destination SHA-256 matches Host bytes.
- Saving the completed download sends no further Host file read.
- Changed versions cannot append; explicit local removal leaves the Host and exported document unchanged.
- No Host prompt or business mutation is submitted.
