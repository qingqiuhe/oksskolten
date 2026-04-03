ALTER TABLE feed_notification_rules ADD COLUMN max_title_chars INTEGER NOT NULL DEFAULT 100;
ALTER TABLE feed_notification_rules ADD COLUMN max_body_chars INTEGER NOT NULL DEFAULT 1000;
