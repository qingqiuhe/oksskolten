-- Materialized snapshots for inbox ranking features (issue #15)
-- Caches feed/category engagement and frequency statistics across process restarts.
CREATE TABLE IF NOT EXISTS inbox_ranking_snapshots (
  user_id INTEGER,
  snapshot_type TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, snapshot_type)
);
