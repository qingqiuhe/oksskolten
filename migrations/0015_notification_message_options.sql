ALTER TABLE feed_notification_rules ADD COLUMN content_mode TEXT NOT NULL DEFAULT 'title_and_body';
ALTER TABLE feed_notification_rules ADD COLUMN max_articles_per_message INTEGER NOT NULL DEFAULT 5;
