
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Add embedding column to feedback_learning_index (768-dim for Gemini embeddings)
ALTER TABLE public.feedback_learning_index
ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Create index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_fli_embedding ON public.feedback_learning_index
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
