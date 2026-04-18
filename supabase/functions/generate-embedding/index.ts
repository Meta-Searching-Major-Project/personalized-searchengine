import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Generates 768-dimensional embeddings using Google's dedicated embedding model
 * (gemini-embedding-001) via the Generative Language REST API.
 *
 * This uses a purpose-built embedding model — NOT a generative text model —
 * guaranteeing semantically consistent, deterministic vectors.
 *
 * Accepts:
 *   { text: string, task_type?: string }           → { embedding: number[] }
 *   { texts: string[], task_type?: string }         → { embeddings: number[][] }
 *
 * task_type values:
 *   "RETRIEVAL_QUERY"    — for search queries (default)
 *   "RETRIEVAL_DOCUMENT" — for document content being indexed
 *   "SEMANTIC_SIMILARITY" — for comparing text similarity
 *   "CLASSIFICATION"     — for text classification tasks
 */

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
const MAX_RETRIES = 3;
const MAX_INPUT_CHARS = 8000; // gemini-embedding-001 input limit safety margin

type TaskType =
  | "RETRIEVAL_QUERY"
  | "RETRIEVAL_DOCUMENT"
  | "SEMANTIC_SIMILARITY"
  | "CLASSIFICATION";

/**
 * Calls the Google Generative Language API embedContent endpoint.
 * Returns a 768-dimensional embedding vector.
 */
async function generateEmbedding(
  text: string,
  apiKey: string,
  taskType: TaskType = "RETRIEVAL_QUERY"
): Promise<number[]> {
  // Truncate input to stay within model limits
  const truncatedText = text.slice(0, MAX_INPUT_CHARS);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;

  const body = {
    model: `models/${EMBEDDING_MODEL}`,
    content: {
      parts: [{ text: truncatedText }],
    },
    task_type: taskType,
    output_dimensionality: EMBEDDING_DIMENSIONS,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.status === 429) {
        // Rate limited — exponential backoff
        const waitMs = Math.min(1000 * 2 ** attempt, 8000);
        console.warn(`Embedding API rate limited, retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Embedding API error [${response.status}]: ${errText}`);
      }

      const data = await response.json();

      const values = data?.embedding?.values;
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error("Embedding API returned no values");
      }

      // gemini-embedding-001 with output_dimensionality=768 returns exactly 768 dims
      // No padding/truncation needed — the model handles it natively via MRL
      return values as number[];
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < MAX_RETRIES - 1) {
        const waitMs = Math.min(500 * 2 ** attempt, 4000);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  throw lastError || new Error("Embedding generation failed after retries");
}

/**
 * Batch embed multiple texts. Processes sequentially to respect rate limits.
 */
async function generateEmbeddings(
  texts: string[],
  apiKey: string,
  taskType: TaskType = "RETRIEVAL_DOCUMENT"
): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    const embedding = await generateEmbedding(text, apiKey, taskType);
    embeddings.push(embedding);
  }
  return embeddings;
}

// ─── HTTP Handler ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const taskType: TaskType = body.task_type || "RETRIEVAL_QUERY";

    // Single text
    if (body.text && typeof body.text === "string") {
      const embedding = await generateEmbedding(body.text, GEMINI_API_KEY, taskType);
      return new Response(JSON.stringify({ embedding }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Multiple texts (max 20 to prevent abuse)
    if (body.texts && Array.isArray(body.texts)) {
      const embeddings = await generateEmbeddings(
        body.texts.slice(0, 20),
        GEMINI_API_KEY,
        taskType
      );
      return new Response(JSON.stringify({ embeddings }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Provide 'text' or 'texts' field" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-embedding error:", error);
    const msg = error instanceof Error ? error.message : "Internal error";
    const status = msg.includes("429") ? 429 : msg.includes("402") ? 402 : 500;
    return new Response(
      JSON.stringify({ error: msg }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
