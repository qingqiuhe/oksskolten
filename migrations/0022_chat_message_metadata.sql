-- Display-safe assistant-turn metadata for chat continuity (issue #8)
-- Stores provider/model, elapsed time, usage, status and compact tool summary
-- for completed, failed and interrupted assistant turns.
ALTER TABLE chat_messages ADD COLUMN metadata TEXT;
