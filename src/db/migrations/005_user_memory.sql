-- Paid-tier cross-conversation memory (user instructions + generated summary)

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS memory_instructions TEXT NOT NULL DEFAULT '';

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS memory_summary TEXT NOT NULL DEFAULT '';

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS memory_summary_generated_at TIMESTAMPTZ;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS memory_summary_edited_at TIMESTAMPTZ;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS memory_auto_update_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS last_chat_activity_at TIMESTAMPTZ;
