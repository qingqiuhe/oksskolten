CREATE TABLE IF NOT EXISTS custom_llm_providers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind = 'openai-compatible'),
  base_url   TEXT NOT NULL,
  api_key    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_custom_llm_providers_user_created
  ON custom_llm_providers(user_id, created_at DESC, id DESC);
