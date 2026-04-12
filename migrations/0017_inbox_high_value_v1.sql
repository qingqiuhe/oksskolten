ALTER TABLE feeds ADD COLUMN priority_level INTEGER NOT NULL DEFAULT 3 CHECK(priority_level BETWEEN 1 AND 5);

CREATE TABLE IF NOT EXISTS inbox_topic_cooldowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  anchor_article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  UNIQUE(user_id, anchor_article_id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_topic_cooldowns_user_expires
  ON inbox_topic_cooldowns(user_id, expires_at);
