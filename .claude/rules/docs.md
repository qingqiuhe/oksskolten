---
paths:
  - "src/**"
  - "server/**"
  - "migrations/**"
---

# Documentation Update Rules

- When adding/changing features or modifying schemas, update `docs/spec/*.md` (English only; Japanese spec files have been removed)
- If the change affects user-facing features or setup, also update `README.md` (English, brief summary — detailed spec lives in `docs/spec/`)
- When adding new files or changing directory structure, update `docs/proposals/oss-2-migration.md` Step 2 (commit restructuring table): determine the appropriate commit number for the added file and append to the "included files" column
