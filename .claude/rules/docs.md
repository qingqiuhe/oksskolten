---
paths:
  - "src/**"
  - "server/**"
  - "migrations/**"
---

# Documentation Update Rules

- When adding/changing features or modifying schemas, update `docs/spec/*.md` (English version)
- **MANDATORY**: Every edit to a `docs/spec/*.md` file MUST be accompanied by the equivalent edit to its `docs/spec/*.ja.md` counterpart in the same commit. Never update one without the other. Both files must stay structurally and semantically synchronized at all times
- If the change affects user-facing features or setup, also update `README.md` (English, brief summary — detailed spec lives in `docs/spec/`)
- When adding new files or changing directory structure, update `docs/proposals/oss-2-migration.md` Step 2 (commit restructuring table): determine the appropriate commit number for the added file and append to the "included files" column
