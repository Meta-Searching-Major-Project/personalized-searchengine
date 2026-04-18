import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Computes document importance I(d) per the Beg & Ahmad (2007) formula:
 *   I(d) = wV·V + wT·T + wP·P + wS·S + wB·B + wE·E + wC·C
 *
 * Then generates an embedding for the document via the generate-embedding function
 * and stores it alongside the learned_score in feedback_learning_index.
 *
 * Text-chunking strategy:
 *   - Short text (≤ 2000 chars): embed directly
 *   - Long text (> 2000 chars): split into overlapping chunks (~1500 chars,
 *     200-char overlap), embed each, average the vectors, and L2-normalize
 */

// ─── Text Chunking ─────────────────────────────────────────────────

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const DIRECT_EMBED_LIMIT = 2000;

/**
 * Splits text into overlapping chunks for embedding.
 * Tries to break at sentence boundaries when possible.
 */
function chunkText(text: string): string[] {
  if (text.length <= DIRECT_EMBED_LIMIT) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);

    // Try to break at a sentence boundary (., !, ?, newline)
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastBreak = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("\n")
      );
      if (lastBreak > CHUNK_SIZE * 0.3) {
        end = start + lastBreak + 1;
      }
    }

    chunks.push(text.slice(start, end).trim());

    // Advance by chunk size minus overlap
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    // Prevent infinite loop for very short remaining text
    if (end >= text.length) break;
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Averages multiple embedding vectors and L2-normalizes the result.
 */
function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  if (embeddings.length === 1) return embeddings[0];

  const dim = embeddings[0].length;
  const avg = new Array(dim).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      avg[i] += emb[i];
    }
  }

  // Average
  for (let i = 0; i < dim; i++) {
    avg[i] /= embeddings.length;
  }

  // L2 normalize
  const norm = Math.sqrt(avg.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      avg[i] /= norm;
    }
  }

  return avg;
}

// ─── Embedding via generate-embedding function ──────────────────────

async function generateEmbeddingViaFunction(
  supabaseUrl: string,
  serviceKey: string,
  text: string,
  taskType: string = "RETRIEVAL_DOCUMENT"
): Promise<number[] | null> {
  try {
    const chunks = chunkText(text);

    if (chunks.length === 1) {
      // Single chunk — embed directly
      const resp = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: chunks[0], task_type: taskType }),
      });
      if (!resp.ok) {
        console.error("Embedding generation failed:", resp.status, await resp.text());
        return null;
      }
      const data = await resp.json();
      return data.embedding || null;
    }

    // Multiple chunks — embed each, then average
    const resp = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ texts: chunks, task_type: taskType }),
    });
    if (!resp.ok) {
      console.error("Batch embedding generation failed:", resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    const embeddings: number[][] = data.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length === 0) {
      return null;
    }

    return averageEmbeddings(embeddings);
  } catch (e) {
    console.error("Embedding call error:", e);
    return null;
  }
}

// ─── Main Handler ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify user from JWT
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { search_history_id } = await req.json();
    if (!search_history_id) {
      return new Response(JSON.stringify({ error: "search_history_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch user weights + search results + feedback + query in parallel
    const [profileRes, searchResultsRes, historyRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("weight_v, weight_t, weight_p, weight_s, weight_b, weight_e, weight_c, reading_speed")
        .eq("id", user.id)
        .single(),
      supabase
        .from("search_results")
        .select("id, url, title, snippet")
        .eq("search_history_id", search_history_id),
      supabase
        .from("search_history")
        .select("query")
        .eq("id", search_history_id)
        .single(),
    ]);

    const profile = profileRes.data;
    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const searchResults = searchResultsRes.data;
    if (!searchResults || searchResults.length === 0) {
      return new Response(JSON.stringify({ success: true, updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch feedback
    const resultIds = searchResults.map((r) => r.id);
    const { data: feedbackRows } = await supabase
      .from("user_feedback")
      .select("*")
      .in("search_result_id", resultIds)
      .eq("user_id", user.id);

    if (!feedbackRows || feedbackRows.length === 0) {
      return new Response(JSON.stringify({ success: true, updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fbMap = new Map(feedbackRows.map((f) => [f.search_result_id, f]));
    const queryText = historyRes.data?.query || "";

    // Calculate c_j_total (sum of copy-paste chars across ALL feedback in this session)
    const cTotal = feedbackRows.reduce((sum, f) => sum + (f.copy_paste_chars ?? 0), 0);

    // Track URLs that were interacted with so we can penalize the rest
    const interactedUrls = new Set<string>();

    // Deduplicate by URL
    const urlResultMap = new Map<string, { url: string; title: string; snippet: string | null; resultIds: string[] }>();
    for (const sr of searchResults) {
      const normalized = sr.url.replace(/\/+$/, "").toLowerCase();
      const existing = urlResultMap.get(normalized);
      if (existing) {
        existing.resultIds.push(sr.id);
      } else {
        urlResultMap.set(normalized, { url: sr.url, title: sr.title, snippet: sr.snippet, resultIds: [sr.id] });
      }
    }

    let updated = 0;

    for (const [, doc] of urlResultMap) {
      let bestFb = null;
      for (const rid of doc.resultIds) {
        const fb = fbMap.get(rid);
        if (fb && (!bestFb || (fb.click_order ?? 999) < (bestFb.click_order ?? 999))) {
          bestFb = fb;
        }
      }
      if (!bestFb) continue;

      interactedUrls.add(doc.url);

      // V = 1 / 2^(v_j - 1)
      const V = bestFb.click_order ? 1 / Math.pow(2, bestFb.click_order - 1) : 0;

      // T = t_j / t_j_max
      const pageSizeBytes = (bestFb as any).page_size_bytes ?? 0;
      const readingSpeed = profile.reading_speed || 10;
      const tMax = pageSizeBytes > 0 ? (pageSizeBytes / readingSpeed) * 1000 : 0;
      const T = tMax > 0 ? Math.min((bestFb.dwell_time_ms ?? 0) / tMax, 1.0) : 0;

      const P = bestFb.printed ? 1 : 0;
      const S = bestFb.saved ? 1 : 0;
      const B = bestFb.bookmarked ? 1 : 0;
      const E = bestFb.emailed ? 1 : 0;

      // C = c_j / c_j_total
      const C = cTotal > 0 ? (bestFb.copy_paste_chars ?? 0) / cTotal : 0;

      // wV must be 1
      const importance =
        1.0 * V +
        profile.weight_t * T +
        profile.weight_p * P +
        profile.weight_s * S +
        profile.weight_b * B +
        profile.weight_e * E +
        profile.weight_c * C;

      if (importance <= 0) continue;

      // Generate embedding for the document content (with chunking)
      // Combine title + snippet for richer semantic representation
      const docText = `${doc.title} ${doc.snippet || ""}`.trim();
      const embedding = await generateEmbeddingViaFunction(
        supabaseUrl,
        serviceKey,
        docText,
        "RETRIEVAL_DOCUMENT"
      );

      // Upsert into feedback_learning_index
      const { data: existing } = await supabase
        .from("feedback_learning_index")
        .select("id, learned_score, query_matches")
        .eq("url", doc.url)
        .eq("user_id", user.id)
        .maybeSingle();

      const updatePayload: Record<string, any> = {
        learned_score: importance,
        title: doc.title,
        snippet: doc.snippet,
        updated_at: new Date().toISOString(),
      };

      if (embedding) {
        // Store as pgvector-compatible string: [0.1, 0.2, ...]
        updatePayload.embedding = `[${embedding.join(",")}]`;
      }

      if (existing) {
        // Exact formula: New = (Old + (µ * sigma)) / (1 + (µ * sigma))
        const mu = 0.1; // learning rate
        const updateTerm = mu * importance;
        updatePayload.learned_score = (existing.learned_score + updateTerm) / (1 + updateTerm);
        
        // Reset ignored_count since it was interacted with
        updatePayload.ignored_count = 0;

        const queries: string[] = existing.query_matches || [];
        if (queryText && !queries.includes(queryText)) {
          queries.push(queryText);
        }
        updatePayload.query_matches = queries;

        await supabase
          .from("feedback_learning_index")
          .update(updatePayload)
          .eq("id", existing.id);
      } else {
        // Initial score for first-time interaction
        const mu = 0.1;
        updatePayload.learned_score = (0 + (mu * importance)) / (1 + (mu * importance));
        
        await supabase.from("feedback_learning_index").insert({
          url: doc.url,
          user_id: user.id,
          query_matches: queryText ? [queryText] : [],
          ignored_count: 0,
          ...updatePayload,
        });
      }
      updated++;
    }

    // ─── Penalization for Ignored Documents ─────────────────────────
    // For all documents returned in the search but NOT interacted with,
    // apply an exponential penalty to their learned_score.
    for (const [, doc] of urlResultMap) {
      if (interactedUrls.has(doc.url)) continue;

      const { data: existing } = await supabase
        .from("feedback_learning_index")
        .select("id, learned_score, ignored_count")
        .eq("url", doc.url)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing && existing.learned_score > 0) {
        const newIgnoredCount = (existing.ignored_count || 0) + 1;
        // Exponential decay penalty (e.g., * 0.9^count)
        const decayFactor = Math.pow(0.9, newIgnoredCount);
        let newScore = existing.learned_score * decayFactor;
        
        // Bottom out at 0
        if (newScore < 0.01) newScore = 0;

        await supabase
          .from("feedback_learning_index")
          .update({
            learned_score: newScore,
            ignored_count: newIgnoredCount,
            updated_at: new Date().toISOString()
          })
          .eq("id", existing.id);
      }
    }

    return new Response(JSON.stringify({ success: true, updated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("update-learning-index error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
