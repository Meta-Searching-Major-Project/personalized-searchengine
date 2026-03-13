
-- Function to search feedback_learning_index by cosine similarity
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
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
