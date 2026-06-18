CREATE INDEX IF NOT EXISTS idx_articles_user_feed_published
  ON articles(user_id, feed_id, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_articles_user_unread_published_active
  ON articles(user_id, published_at DESC, feed_id)
  WHERE purged_at IS NULL AND seen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_articles_user_active_feed_counts
  ON articles(user_id, purged_at, feed_id, seen_at, published_at, fetched_at);

CREATE INDEX IF NOT EXISTS idx_articles_user_unread_oldest_active
  ON articles(user_id, COALESCE(published_at, fetched_at), feed_id)
  WHERE purged_at IS NULL AND seen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_articles_user_bookmarked_active
  ON articles(user_id, bookmarked_at)
  WHERE purged_at IS NULL AND bookmarked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_articles_user_liked_active
  ON articles(user_id, liked_at)
  WHERE purged_at IS NULL AND liked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_articles_retry_queue_active
  ON articles(retry_count, last_retry_at)
  WHERE purged_at IS NULL AND last_error IS NOT NULL AND full_text IS NULL;
