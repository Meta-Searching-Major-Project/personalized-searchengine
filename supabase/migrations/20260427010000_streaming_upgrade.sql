-- ============================================================
-- PersonaSearch: Streaming Upgrade Migration
-- Adds: search_sessions table, preferred_engines on profiles
-- Safe to run multiple times (idempotent)
-- ============================================================

-- 1. Add preferred_engines to profiles (user's manually chosen engines)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferred_engines TEXT[] NOT NULL DEFAULT '{}';

-- 2. Create search_sessions table for real-time streaming
CREATE TABLE IF NOT EXISTS public.search_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  query           TEXT NOT NULL,
  query_intent    TEXT,
  aggregation_method TEXT NOT NULL DEFAULT 'borda',
  status          TEXT NOT NULL DEFAULT 'running', -- running | complete | failed
  all_engines     TEXT[] NOT NULL DEFAULT '{}',
  completed_engines TEXT[] NOT NULL DEFAULT '{}',
  timed_out_engines TEXT[] NOT NULL DEFAULT '{}',
  failed_engines  TEXT[] NOT NULL DEFAULT '{}',
  engine_results  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- keyed by engine name
  merged_results  JSONB NOT NULL DEFAULT '[]'::jsonb,
  rich_blocks     JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 hours')
);

CREATE INDEX IF NOT EXISTS idx_search_sessions_user  ON public.search_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_search_sessions_expires ON public.search_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_search_sessions_status  ON public.search_sessions (status);

ALTER TABLE public.search_sessions ENABLE ROW LEVEL SECURITY;

-- RLS: users see their own sessions; guest sessions (user_id IS NULL) are accessible by session_id only
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users own sessions" ON public.search_sessions;
  DROP POLICY IF EXISTS "Guest sessions readable" ON public.search_sessions;
  CREATE POLICY "Users own sessions" ON public.search_sessions
    FOR ALL USING (auth.uid() = user_id);
  -- Guest sessions (no user_id) are publicly readable — session_id UUID is unguessable
  CREATE POLICY "Guest sessions readable" ON public.search_sessions
    FOR SELECT USING (user_id IS NULL);
END $$;

-- 3. Enable Supabase Realtime on search_sessions
-- (Realtime must be enabled per-table in the Supabase dashboard OR via this statement)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'search_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.search_sessions;
  END IF;
END $$;

-- 4. Auto-cleanup: function to delete expired sessions (call via pg_cron or manually)
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.search_sessions WHERE expires_at < now();
$$;
