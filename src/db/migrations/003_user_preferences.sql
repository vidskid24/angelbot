-- Per-user tone and MA experience preferences for personalized replies

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS tone TEXT NOT NULL DEFAULT 'warm'
    CHECK (tone IN ('warm', 'professional', 'concise'));

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS ma_experience TEXT NOT NULL DEFAULT 'some_experience'
    CHECK (ma_experience IN ('new', 'some_experience', 'long_time'));

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS preferences_completed_at TIMESTAMPTZ;
