-- ============================================================
-- PersonaSearch: COMPLETE DATABASE SETUP (IDEMPOTENT)
-- Safe to run multiple times — skips anything that already exists.
-- Dashboard URL: https://supabase.com/dashboard/project/tqczpxsrtymzmjmacqip/sql/new
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- PART 1: Core schema
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN CREATE TYPE public.app_role AS ENUM ('admin', 'user'); END IF; END $$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  weight_v FLOAT NOT NULL DEFAULT 1.0,
  weight_t FLOAT NOT NULL DEFAULT 1.0,
  weight_p FLOAT NOT NULL DEFAULT 1.0,
  weight_s FLOAT NOT NULL DEFAULT 1.0,
  weight_b FLOAT NOT NULL DEFAULT 1.0,
  weight_e FLOAT NOT NULL DEFAULT 1.0,
  weight_c FLOAT NOT NULL DEFAULT 1.0,
  reading_speed FLOAT NOT NULL DEFAULT 10.0,
  default_aggregation_method TEXT NOT NULL DEFAULT 'borda',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE TABLE IF NOT EXISTS public.search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.search_history ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.search_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_history_id UUID NOT NULL REFERENCES public.search_history(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  snippet TEXT,
  original_rank INT NOT NULL,
  aggregated_rank INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.search_results ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  search_result_id UUID NOT NULL REFERENCES public.search_results(id) ON DELETE CASCADE,
  click_order INT,
  dwell_time_ms INT DEFAULT 0,
  printed BOOLEAN DEFAULT false,
  saved BOOLEAN DEFAULT false,
  bookmarked BOOLEAN DEFAULT false,
  emailed BOOLEAN DEFAULT false,
  copy_paste_chars INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.search_quality_measures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  sqm_score FLOAT NOT NULL DEFAULT 0.0,
  query_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.search_quality_measures ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.feedback_learning_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  snippet TEXT,
  learned_score FLOAT NOT NULL DEFAULT 0.0,
  query_matches TEXT[] DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.feedback_learning_index ENABLE ROW LEVEL SECURITY;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_feedback_updated_at ON public.user_feedback;
CREATE TRIGGER update_feedback_updated_at BEFORE UPDATE ON public.user_feedback FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_sqm_updated_at ON public.search_quality_measures;
CREATE TRIGGER update_sqm_updated_at BEFORE UPDATE ON public.search_quality_measures FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_learning_updated_at ON public.feedback_learning_index;
CREATE TRIGGER update_learning_updated_at BEFORE UPDATE ON public.feedback_learning_index FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS Policies (drop-if-exists then create)
DO $$ BEGIN
  -- profiles
  DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
  DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
  DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
  CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
  CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
  CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
  -- user_roles
  DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
  DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
  CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
  CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));
  -- search_history
  DROP POLICY IF EXISTS "Users own search history" ON public.search_history;
  DROP POLICY IF EXISTS "Admins read search history" ON public.search_history;
  CREATE POLICY "Users own search history" ON public.search_history FOR ALL USING (auth.uid() = user_id);
  CREATE POLICY "Admins read search history" ON public.search_history FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
  -- search_results
  DROP POLICY IF EXISTS "Users own search results" ON public.search_results;
  DROP POLICY IF EXISTS "Admins read search results" ON public.search_results;
  CREATE POLICY "Users own search results" ON public.search_results FOR ALL USING (EXISTS (SELECT 1 FROM public.search_history WHERE id = search_results.search_history_id AND user_id = auth.uid()));
  CREATE POLICY "Admins read search results" ON public.search_results FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
  -- user_feedback
  DROP POLICY IF EXISTS "Users own feedback" ON public.user_feedback;
  DROP POLICY IF EXISTS "Admins read feedback" ON public.user_feedback;
  CREATE POLICY "Users own feedback" ON public.user_feedback FOR ALL USING (auth.uid() = user_id);
  CREATE POLICY "Admins read feedback" ON public.user_feedback FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
  -- sqm
  DROP POLICY IF EXISTS "Users own sqm" ON public.search_quality_measures;
  DROP POLICY IF EXISTS "Admins read sqm" ON public.search_quality_measures;
  CREATE POLICY "Users own sqm" ON public.search_quality_measures FOR ALL USING (auth.uid() = user_id);
  CREATE POLICY "Admins read sqm" ON public.search_quality_measures FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
  -- learning index
  DROP POLICY IF EXISTS "Users own learning index" ON public.feedback_learning_index;
  DROP POLICY IF EXISTS "Admins read learning index" ON public.feedback_learning_index;
  CREATE POLICY "Users own learning index" ON public.feedback_learning_index FOR ALL USING (auth.uid() = user_id);
  CREATE POLICY "Admins read learning index" ON public.feedback_learning_index FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
END $$;

-- ═══════════════════════════════════════════════════════════════
-- PART 2: pgvector + embeddings + HNSW index
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.feedback_learning_index ADD COLUMN IF NOT EXISTS embedding vector(768);

DROP INDEX IF EXISTS idx_fli_embedding;
DROP INDEX IF EXISTS idx_fli_embedding_hnsw;
CREATE INDEX idx_fli_embedding_hnsw ON public.feedback_learning_index
USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE OR REPLACE FUNCTION public.match_learned_documents(
  query_embedding vector(768), match_user_id uuid, match_threshold float DEFAULT 0.3, match_count int DEFAULT 20
) RETURNS TABLE (id uuid, url text, title text, snippet text, learned_score float8, similarity float8)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
  SELECT fli.id, fli.url, fli.title, fli.snippet, fli.learned_score,
    1 - (fli.embedding <=> query_embedding) AS similarity
  FROM feedback_learning_index fli
  WHERE fli.user_id = match_user_id AND fli.embedding IS NOT NULL
    AND 1 - (fli.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC LIMIT match_count;
$$;

-- ═══════════════════════════════════════════════════════════════
-- PART 3: Search cache
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.search_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  query_normalized TEXT NOT NULL,
  engine TEXT NOT NULL,
  organic_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  rich_blocks JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT search_cache_query_engine_unique UNIQUE (query_normalized, engine)
);
CREATE INDEX IF NOT EXISTS idx_search_cache_query ON public.search_cache (query_normalized);
CREATE INDEX IF NOT EXISTS idx_search_cache_fetched_at ON public.search_cache (fetched_at DESC);
ALTER TABLE public.search_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can read search cache" ON public.search_cache;
  CREATE POLICY "Anyone can read search cache" ON public.search_cache FOR SELECT USING (true);
END $$;

-- ═══════════════════════════════════════════════════════════════
-- PART 4: Web page indexing system
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.web_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL UNIQUE, domain TEXT NOT NULL,
  title TEXT, extracted_text TEXT, meta_description TEXT,
  content_hash TEXT, embedding vector(768),
  word_count INT NOT NULL DEFAULT 0, language TEXT DEFAULT 'en',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_crawled_at TIMESTAMPTZ, crawl_count INT NOT NULL DEFAULT 0,
  crawl_status TEXT NOT NULL DEFAULT 'pending', error_message TEXT,
  tsv tsvector
);
CREATE INDEX IF NOT EXISTS idx_web_pages_domain ON public.web_pages (domain);
CREATE INDEX IF NOT EXISTS idx_web_pages_status ON public.web_pages (crawl_status);
CREATE INDEX IF NOT EXISTS idx_web_pages_hash ON public.web_pages (content_hash);
CREATE INDEX IF NOT EXISTS idx_web_pages_last_crawled ON public.web_pages (last_crawled_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_pages_embedding ON public.web_pages USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_web_pages_tsv ON public.web_pages USING gin (tsv);

CREATE OR REPLACE FUNCTION public.web_pages_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.meta_description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(left(NEW.extracted_text, 100000), '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_web_pages_tsv ON public.web_pages;
CREATE TRIGGER trg_web_pages_tsv BEFORE INSERT OR UPDATE OF title, meta_description, extracted_text ON public.web_pages FOR EACH ROW EXECUTE FUNCTION public.web_pages_tsv_trigger();

CREATE TABLE IF NOT EXISTS public.crawl_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL, title TEXT, snippet TEXT,
  source_engine TEXT, priority INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_crawl_queue_status ON public.crawl_queue (status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_crawl_queue_url ON public.crawl_queue (url);
ALTER TABLE public.web_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crawl_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can read web pages" ON public.web_pages;
  CREATE POLICY "Anyone can read web pages" ON public.web_pages FOR SELECT USING (true);
END $$;

CREATE OR REPLACE FUNCTION public.search_local_index(
  query_embedding vector(768), query_text text DEFAULT '', match_count int DEFAULT 20
) RETURNS TABLE (id uuid, url text, domain text, title text, snippet text, similarity float8, text_rank float4)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
  SELECT wp.id, wp.url, wp.domain, wp.title,
    coalesce(wp.meta_description, left(wp.extracted_text, 300)) AS snippet,
    1 - (wp.embedding <=> query_embedding) AS similarity,
    CASE WHEN query_text != '' THEN ts_rank_cd(wp.tsv, plainto_tsquery('english', query_text)) ELSE 0.0::float4 END AS text_rank
  FROM web_pages wp
  WHERE wp.crawl_status = 'crawled' AND wp.embedding IS NOT NULL
    AND 1 - (wp.embedding <=> query_embedding) > 0.15
  ORDER BY similarity DESC LIMIT match_count;
$$;

-- ═══════════════════════════════════════════════════════════════
-- DONE! Your database is fully set up.
-- ═══════════════════════════════════════════════════════════════
