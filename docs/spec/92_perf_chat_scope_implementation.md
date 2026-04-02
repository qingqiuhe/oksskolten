# Oksskolten Spec — Chat Scope Implementation Performance

> [Back to Overview](./01_overview.md)

## Overview

The list-scoped chat implementation resolves the user-visible article list into a bounded snapshot before the conversation is persisted. This keeps the scope stable across follow-up messages and gives the server a deterministic article set for tool enforcement.

The current implementation uses `MAX_SCOPE_ARTICLES = 500` in `server/chat/scope.ts`. Both `loaded_list` and `filtered_list` are normalized into concrete `article_ids`, and the stored scope keeps both `count_scoped` and `count_total` so the UI can show when the visible list has been capped.

## Motivation

The performance-sensitive part of chat scope is not prompt construction. It is the cost of repeatedly validating and querying the scoped article set while preserving a hard boundary around the list snapshot.

The implementation is structured to keep that cost predictable:

- Scope normalization happens once at conversation creation time.
- Subsequent messages read the stored snapshot instead of re-running the full list query.
- Tool enforcement is centralized in `executeTool()`, which avoids duplicated guard logic and inconsistent behavior across tools.
- List-scoped searches fall back to SQLite when `article_ids` must be enforced as an outer constraint.

## Design

### Snapshot Resolution

`buildLoadedListScope()` truncates the incoming article IDs to the configured cap and validates them against `getArticlesByIds()`. `buildFilteredListScope()` resolves the filter to a concrete article snapshot by calling `getArticles({ limit: MAX_SCOPE_ARTICLES })` once.

Both modes persist only the resolved article IDs. This means a conversation continues to refer to the original list snapshot even if new matching articles arrive later.

### Centralized Enforcement

`server/chat/tools.ts` enforces scope in one place:

- Article-specific tools call `assertArticleInScope()`.
- `search_articles` receives the hidden `__scope_article_ids` field from `applyScopeToArticleSearch()`.
- `searchArticles()` applies the scope IDs as an outer `IN (...)` filter and then ANDs any narrower user-requested filters on top.

This keeps the hard scope boundary server-side and avoids leaking scope internals into the model-visible tool schema.

### Performance Tradeoffs

List-scoped searches currently bypass Meilisearch when a concrete scoped ID set must be applied. For the current cap of 500 articles, SQLite query cost is acceptable and simpler than mixing full-text search with a large ID filter in the search backend.

The main tradeoff is that the system prefers determinism and enforcement simplicity over re-evaluating live list filters on every turn. That is intentional: the product semantics are "chat about this list snapshot", not "chat about whatever the list would look like right now".
