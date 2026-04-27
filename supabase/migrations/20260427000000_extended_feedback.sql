-- PersonaSearch: Extended Feedback Signals Migration
-- Adds new tracking columns to user_feedback for richer implicit feedback
-- Safe to run multiple times (idempotent)

ALTER TABLE public.user_feedback ADD COLUMN IF NOT EXISTS scroll_depth FLOAT NOT NULL DEFAULT 0;
ALTER TABLE public.user_feedback ADD COLUMN IF NOT EXISTS quick_bounce BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.user_feedback ADD COLUMN IF NOT EXISTS open_in_new_tab BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.user_feedback ADD COLUMN IF NOT EXISTS hover_time_ms INT NOT NULL DEFAULT 0;
ALTER TABLE public.user_feedback ADD COLUMN IF NOT EXISTS repeat_visit BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.user_feedback ADD COLUMN IF NOT EXISTS highlight_count INT NOT NULL DEFAULT 0;
