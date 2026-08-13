-- Persist last teaching-turn RAG excerpts so citation follow-ups can reuse catalog cites.
ALTER TABLE threads ADD COLUMN IF NOT EXISTS last_source_excerpts TEXT;
