# Oksskolten Spec — Clip

> [Back to overview](./01_overview.md)

## Clip

### Overview

A feature that allows users to manually save (clip) arbitrary URLs. Articles are ingested through a flow independent of RSS feeds.

### Clip Feed

Clipped articles belong to a special singleton feed called the "clip feed." This allows article management (read status, bookmarks, summaries, translations, search, etc.) to be fully unified with regular RSS articles.

| Aspect | RSS Feed | Clip Feed |
|---|---|---|
| `type` in DB | `'rss'` | `'clip'` |
| `url` | Blog URL | `'clip://saved'` |
| Count | Multiple | Singleton (only one) |
| Article addition | Automatic via Cron | Manual by user via `POST /api/articles/from-url` |
| Cron target | Retrieved by `getEnabledFeeds()` | Excluded (only `type = 'rss'` is retrieved) |
| Sidebar placement | Feed list section (with categories) | Special section (alongside Inbox, Bookmarks, and Likes) |
| Global unread count | Included | Not included |
| Category | Can belong to one | Not allowed |
| Smart Floor | Applied | Not applied (all saved articles always visible) |
| Article deletion | Not allowed (403) | Allowed (`DELETE /api/articles/:id`) |
| Feed deletion | Allowed | Not allowed (403) |
| Icon | Domain favicon | Archive icon |

### DB Functions

| Function | Description |
|---|---|
| `ensureClipFeed()` | Retrieves the clip feed. Creates and returns it if it does not exist (idempotent) |
| `getClipFeed()` | Retrieves the clip feed. Returns `undefined` if not yet created |
| `getEnabledFeeds()` | Returns only feeds where `disabled = 0 AND type = 'rss'` (excludes clip) |
| `deleteArticle(id)` | Deletes an article. Returns `true` on success, `false` if not found |

### Clip Save Flow

```
User enters a URL
    │
    ▼
POST /api/articles/from-url
    │
    ├─ 1. getClipFeed() → 500 if not found
    ├─ 2. getArticleByUrl() → 409 if already exists
    ├─ 3. fetchFullText(url) → Retrieve body, OGP image, excerpt, and title
    │     On failure: record in last_error and continue with full_text = NULL (graceful degradation)
    ├─ 4. detectLanguage(fullText) → 'ja' / 'en'
    ├─ 5. Title resolution: request.title > fetchedTitle > hostname
    └─ 6. insertArticle() → 201
```

After saving, the article supports summary, translation, bookmark, like, and chat — just like regular RSS articles.
