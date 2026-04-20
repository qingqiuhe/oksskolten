ALTER TABLE feeds
  ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'site'
  CHECK (source_kind IN ('site', 'social'));

ALTER TABLE feeds
  ADD COLUMN source_platform TEXT
  CHECK (source_platform IS NULL OR source_platform IN ('x'));

UPDATE feeds
SET source_kind = 'site'
WHERE source_kind IS NULL OR source_kind = '';

UPDATE feeds
SET source_kind = 'social',
    source_platform = 'x'
WHERE
  LOWER(COALESCE(url, '')) LIKE '%://x.com/%'
  OR LOWER(COALESCE(url, '')) LIKE '%://twitter.com/%'
  OR LOWER(COALESCE(url, '')) LIKE '%://%.x.com/%'
  OR LOWER(COALESCE(url, '')) LIKE '%://%.twitter.com/%'
  OR LOWER(COALESCE(rss_url, '')) LIKE '%://x.com/%'
  OR LOWER(COALESCE(rss_url, '')) LIKE '%://twitter.com/%'
  OR LOWER(COALESCE(rss_url, '')) LIKE '%://%.x.com/%'
  OR LOWER(COALESCE(rss_url, '')) LIKE '%://%.twitter.com/%'
  OR LOWER(COALESCE(rss_bridge_url, '')) LIKE '%://x.com/%'
  OR LOWER(COALESCE(rss_bridge_url, '')) LIKE '%://twitter.com/%'
  OR LOWER(COALESCE(rss_bridge_url, '')) LIKE '%://%.x.com/%'
  OR LOWER(COALESCE(rss_bridge_url, '')) LIKE '%://%.twitter.com/%'
  OR LOWER(COALESCE(rss_url, '')) LIKE '%/twitter/user/%'
  OR LOWER(COALESCE(rss_bridge_url, '')) LIKE '%/twitter/user/%';

CREATE INDEX IF NOT EXISTS idx_feeds_user_source_kind
  ON feeds(user_id, source_kind);

CREATE INDEX IF NOT EXISTS idx_feeds_user_source_platform
  ON feeds(user_id, source_platform);
