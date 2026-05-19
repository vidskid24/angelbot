-- Replace professional tone with playful; migrate existing rows

UPDATE user_profiles SET tone = 'warm' WHERE tone = 'professional';

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_tone_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_tone_check
  CHECK (tone IN ('warm', 'playful', 'concise'));
