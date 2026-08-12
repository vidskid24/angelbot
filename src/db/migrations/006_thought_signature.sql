-- Store Gemini thought signatures for multi-turn reasoning continuity (3.x models).
ALTER TABLE thread_messages
  ADD COLUMN IF NOT EXISTS thought_signature TEXT;
