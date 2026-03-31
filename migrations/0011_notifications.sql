CREATE TABLE IF NOT EXISTS notification_channels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'feishu_webhook',
  name        TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  secret      TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notification_channels_user_created
  ON notification_channels(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_notification_rules (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                INTEGER REFERENCES users(id) ON DELETE CASCADE,
  feed_id                INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  enabled                INTEGER NOT NULL DEFAULT 0,
  check_interval_minutes INTEGER NOT NULL DEFAULT 60,
  next_check_at          TEXT,
  last_checked_at        TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(feed_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_notification_rules_user_next_check
  ON feed_notification_rules(user_id, next_check_at);

CREATE TABLE IF NOT EXISTS feed_notification_rule_channels (
  rule_id                  INTEGER NOT NULL REFERENCES feed_notification_rules(id) ON DELETE CASCADE,
  channel_id               INTEGER NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  last_notified_article_id INTEGER,
  last_notified_at         TEXT,
  last_error               TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (rule_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_notification_rule_channels_channel_id
  ON feed_notification_rule_channels(channel_id);

ALTER TABLE articles ADD COLUMN notification_body_text TEXT;
ALTER TABLE articles ADD COLUMN notification_media_json TEXT;
ALTER TABLE articles ADD COLUMN notification_media_extracted_at TEXT;
