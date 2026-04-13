ALTER TABLE feeds
  ADD COLUMN ingest_kind TEXT NOT NULL DEFAULT 'rss'
  CHECK (ingest_kind IN ('rss', 'json_api'));

ALTER TABLE feeds
  ADD COLUMN source_config_json TEXT;

CREATE INDEX IF NOT EXISTS idx_feeds_user_ingest_kind
  ON feeds(user_id, ingest_kind);
