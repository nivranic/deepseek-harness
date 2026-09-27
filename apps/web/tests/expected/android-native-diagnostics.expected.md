# Android Native Gateway support diagnostics

- A real Host serves a seeded Session to the installed isolated Android application.
- The application exports its live model and Native Gateway observations through the bundled Gitleaks scanner.
- HTTP callback ownership, mux subscription counts and pairing role have explicit Native Gateway producers.
- API protocol 2 and durable Session format 3 remain independent observations.
- A read-only negotiation refusal retains last-known facts with a fixed failure category; a successful refresh clears the failure.
- Snapshot capture starts no negotiation; export sends no prompt, creation, cancellation, reply or Handoff mutation.
- A test-owned logical follow failure and recovery appear in the separate SessionModel attempt and interruption counters.
- Pairing codes, Host and Session identities, pins, addresses, labels and refusal text are absent.
- This scenario does not qualify physical devices, crash collection, live-model behavior or release reproducibility.
