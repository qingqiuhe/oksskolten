---
paths:
  - "src/lib/demo/**"
---

# Demo Mode Implementation Rules

## Architecture (3-layer)

```
fetcher.demo.ts  →  mock-api.ts  →  demo-store.ts
(adapter)           (router)        (in-memory DB)
```

- **`demo-store.ts`**: State management and business logic. Holds feeds / articles / conversations in memory
- **`mock-api.ts`**: HTTP method × path routing. `window.fetch` intercept (SSE, etc.) also lives here
- **`fetcher.demo.ts`**: Thin adapter exposing the same public API as production `fetcher.ts`. No logic here
- **`i18n.ts`**: Demo-only i18n dictionary (`dt()` / `getLocale()` / `streamText()`)

## Rules

### Logic placement
- Business logic (data manipulation, computation) must go in `demo-store.ts`
- `fetcher.demo.ts` must only delegate to `demoStore.xxx()` — no inline logic
- Routing (path matching → handler dispatch) goes in `mock-api.ts`

### Data creation
- Use `createFeed(overrides)` factory for `SeedFeed` objects
- Use `createArticle(overrides)` factory for `SeedArticle` objects
- Never write object literals directly (fields will be missed when schema changes)

### Type safety
- Use `asBody<T>(body)` helper for narrowing `unknown` body in `mock-api.ts`
- Avoid raw `as` casts

### i18n
- User-visible text must be registered in `i18n.ts` dictionary and retrieved via `dt()`
- Use `getLocale()` for current locale (backed by `localStorage`)

### Dates
- Seed JSON dates use relative format (`-3d`, `-2d23h`)
- `resolveRelativeDate()` converts them to ISO 8601 at module init

### DB schema changes
- Update type definitions in `demo-store.ts` and add new fields to seed data (`articles.json` / `feeds.json`)
- Dev DB seed reads JSON directly at startup — no regeneration step needed

### Frontend-only changes
- No demo-side changes needed (automatically reflected)

### Adding a new API endpoint
1. Add data method to `demo-store.ts`
2. Add route to the matching HTTP method section (GET/POST/PATCH/DELETE) in `mock-api.ts`
3. If SSE is needed, add to `window.fetch` intercept in `mock-api.ts`
4. Only add an adapter in `fetcher.demo.ts` if a new public function is required
