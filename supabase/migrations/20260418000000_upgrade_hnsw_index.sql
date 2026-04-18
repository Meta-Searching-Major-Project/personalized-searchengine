
-- ============================================================
-- PersonaSearch: Upgrade pgvector index from IVFFlat to HNSW
-- ============================================================

-- Ensure pgvector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Make vector type visible for this session
SET search_path TO 'public', 'extensions';

-- Ensure the 768-dim vector column exists
ALTER TABLE public.feedback_learning_index
ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Drop old indexes
DROP INDEX IF EXISTS public.idx_fli_embedding;
DROP INDEX IF EXISTS public.idx_fli_embedding_hnsw;

-- Create HNSW index
CREATE INDEX idx_fli_embedding_hnsw
ON public.feedback_learning_index
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Recreate the match_learned_documents function
CREATE OR REPLACE FUNCTION public.match_learned_documents(
  query_embedding vector(768),
  match_user_id uuid,
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  url text,
  title text,
  snippet text,
  learned_score float8,
  similarity float8
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    fli.id,
    fli.url,
    fli.title,
    fli.snippet,
    fli.learned_score,
    1 - (fli.embedding <=> query_embedding) AS similarity
  FROM feedback_learning_index fli
  WHERE fli.user_id = match_user_id
    AND fli.embedding IS NOT NULL
    AND 1 - (fli.embedding <=> query_embedding) > match_threshold
  ORDER BY fli.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

-- Reset search_path
RESET search_path;
