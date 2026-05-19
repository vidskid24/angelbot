-- Per-user daily chat message counts (resets per calendar day in configured timezone)

CREATE TABLE IF NOT EXISTS user_daily_message_usage (
  user_id TEXT NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  message_count INT NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_message_usage_date
  ON user_daily_message_usage (usage_date);
