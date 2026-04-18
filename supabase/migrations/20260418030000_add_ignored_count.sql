-- Add ignored_count to feedback_learning_index to support penalization logic in N+1 Engine
SET search_path TO 'public', 'extensions';

ALTER TABLE public.feedback_learning_index
ADD COLUMN IF NOT EXISTS ignored_count INT DEFAULT 0;
