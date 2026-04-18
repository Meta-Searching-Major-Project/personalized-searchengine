-- Add page_size_bytes to user_feedback for dwell time normalization
-- Per the paper: T = t_j / t_j_max where t_j_max = page_size_bytes / reading_speed
SET search_path TO 'public', 'extensions';

ALTER TABLE public.user_feedback
ADD COLUMN IF NOT EXISTS page_size_bytes INT DEFAULT 0;
