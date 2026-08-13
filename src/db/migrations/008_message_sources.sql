-- Per-assistant-message catalog sources for the widget Source control.
ALTER TABLE thread_messages
  ADD COLUMN IF NOT EXISTS sources JSONB;
