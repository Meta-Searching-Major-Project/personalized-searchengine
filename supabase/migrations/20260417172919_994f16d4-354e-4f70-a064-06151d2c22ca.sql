
CREATE TABLE public.search_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  query_normalized TEXT NOT NULL,
  engine TEXT NOT NULL,
  organic_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  rich_blocks JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT search_cache_query_engine_unique UNIQUE (query_normalized, engine)
);

CREATE INDEX idx_search_cache_query ON public.search_cache (query_normalized);
CREATE INDEX idx_search_cache_fetched_at ON public.search_cache (fetched_at DESC);

ALTER TABLE public.search_cache ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous) can read cache
CREATE POLICY "Anyone can read search cache"
ON public.search_cache
FOR SELECT
USING (true);

-- Only service role writes (edge function uses service key) — no client-side insert/update/delete policies
