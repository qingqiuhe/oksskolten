---
paths:
  - "docs/proposals/**"
  - "docs/plans/**"
---

# Implementation Planning

Before presenting a plan to the user, review it with the `codex` command. Adjust the review prompt as needed, but always include the instruction to only flag critical issues.

```bash
# Initial plan review
codex exec -m gpt-5.3-codex "Review this plan. Don't nitpick trivial things. Only flag critical issues: {plan_full_path} (ref: {CLAUDE.md full_path})"

# Updated plan review (resume --last preserves prior review context)
codex exec resume --last -m gpt-5.3-codex "Plan updated. Review again. Don't nitpick trivial things. Only flag critical issues: {plan_full_path} (ref: {CLAUDE.md full_path})"
```
