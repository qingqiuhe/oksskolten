---
paths:
  - "server/**/*.ts"
---

# Database query rules

## Use `active_articles` VIEW for all SELECT queries

Articles support soft delete via a `purged_at` column. The `active_articles` VIEW (`WHERE purged_at IS NULL`) centralizes this filter.

- **SELECT**: always use `FROM active_articles` / `JOIN active_articles`
- **Never write `purged_at IS NULL`** in application code — that logic lives in the VIEW
- The base `articles` table is only for:
  - INSERT / UPDATE / DELETE (SQLite cannot write through a VIEW)
  - `getExistingArticleUrls()` (URL dedup must see purged rows)
  - `purgeExpiredArticles()` / `getRetentionStats()` (manage purged_at directly)

If you see `FROM articles` in a SELECT, it should be intentional and one of the exceptions above.

See `docs/adr/002-retention-soft-delete.md` for rationale.
