ALTER TABLE notification_channels ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC+8';

UPDATE notification_channels
SET timezone = 'UTC+8'
WHERE timezone IS NULL OR timezone = '';
