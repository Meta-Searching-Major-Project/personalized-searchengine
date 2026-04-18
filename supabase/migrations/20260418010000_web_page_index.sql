
-- ============================================================
-- PersonaSearch: Web Page Indexing System
-- ============================================================

-- Ensure pgvector is available
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Make vector type visible for this session
SET search_path TO 'public', 'extensions';

-- Core web page index
CREATE TABLE IF NOT EXISTS public.web_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  title TEXT,
  extracted_text TEXT,
  meta_description TEXT,
  content_hash TEXT,
  embedding vector(768),
  word_count INT NOT NULL DEFAULT 0,
  language TEXT DEFAULT 'en',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_crawled_at TIMESTAMPTZ,
  crawl_count INT NOT NULL DEFAULT 0,
  crawl_status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  tsv tsvector
);

CREATE INDEX IF NOT EXISTS idx_web_pages_domain ON public.web_pages (domain);
CREATE INDEX IF NOT EXISTS idx_web_pages_status ON public.web_pages (crawl_status);
CREATE INDEX IF NOT EXISTS idx_web_pages_hash ON public.web_pages (content_hash);
CREATE INDEX IF NOT EXISTS idx_web_pages_last_crawled ON public.web_pages (last_crawled_at DESC);

DROP INDEX IF EXISTS public.idx_web_pages_embedding;
CREATE INDEX idx_web_pages_embedding ON public.web_pages
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_web_pages_tsv ON public.web_pages USING gin (tsv);

-- Auto-update tsvector on insert/update
CREATE OR REPLACE FUNCTION public.web_pages_tsv_trigger()
RETURNS trigger AS $$
BEGIN
  NEW.tsv :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.meta_description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(
      left(NEW.extracted_text, 100000), ''
    )), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_web_pages_tsv ON public.web_pages;
CREATE TRIGGER trg_web_pages_tsv
BEFORE INSERT OR UPDATE OF title, meta_description, extracted_text
ON public.web_pages
FOR EACH ROW EXECUTE FUNCTION public.web_pages_tsv_trigger();

-- Crawl queue
CREATE TABLE IF NOT EXISTS public.crawl_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  title TEXT,
  snippet TEXT,
  source_engine TEXT,
  priority INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crawl_queue_status ON public.crawl_queue (status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_crawl_queue_url ON public.crawl_queue (url);

-- RLS
ALTER TABLE public.web_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crawl_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can read web pages" ON public.web_pages;
  CREATE POLICY "Anyone can read web pages" ON public.web_pages FOR SELECT USING (true);
END $$;

-- Hybrid search function
CREATE OR REPLACE FUNCTION public.search_local_index(
  query_embedding vector(768),
  query_text text DEFAULT '',
  match_count int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  url text,
  domain text,
  title text,
  snippet text,
  similarity float8,
  text_rank float4
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    wp.id,
    wp.url,
    wp.domain,
    wp.title,
    coalesce(wp.meta_description, left(wp.extracted_text, 300)) AS snippet,
    1 - (wp.embedding <=> query_embedding) AS similarity,
    CASE
      WHEN query_text != ''
      THEN ts_rank_cd(wp.tsv, plainto_tsquery('english', query_text))
      ELSE 0.0::float4
    END AS text_rank
  FROM web_pages wp
  WHERE wp.crawl_status = 'crawled'
    AND wp.embedding IS NOT NULL
    AND 1 - (wp.embedding <=> query_embedding) > 0.15
  ORDER BY wp.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

-- Reset search_path
RESET search_path;
