---
paths:
  - "src/**"
  - "server/**"
---

# Code Quality

After changing code, run these to verify:

- `npm run typecheck` — Type check (`noUnusedLocals` / `noUnusedParameters` catches unused code)
- `npm run lint` — ESLint (`no-floating-promises`: missing await, `react-hooks`: hooks rules)
- `npm run test` — Tests

CI (GitHub Actions) runs the same 3 checks. Verify locally before pushing.
