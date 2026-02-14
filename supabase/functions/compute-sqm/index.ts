import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Computes Search Quality Measures (SQM) per the Beg & Ahmad (2007) paper.
 *
 * For each engine, SQM = Spearman rank-order correlation between:
 *   - The engine's original ranking of documents
 *   - The user's preference ranking R (derived from implicit feedback signals)
 *
 * Spearman ρ = 1 - (6 * Σ d_i²) / (n * (n² - 1))
 * where d_i = rank difference for document i
 *
 * The SQM score is maintained as a running average across search sessions.
 */

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

    // Verify user
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

    // 1. Fetch user weights
    const { data: profile } = await supabase
      .from("profiles")
      .select("weight_v, weight_t, weight_p, weight_s, weight_b, weight_e, weight_c, reading_speed")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch search results for this session
    const { data: searchResults } = await supabase
      .from("search_results")
      .select("id, url, engine, original_rank")
      .eq("search_history_id", search_history_id);

    if (!searchResults || searchResults.length === 0) {
      return new Response(JSON.stringify({ success: true, updated: 0, message: "No search results" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Fetch feedback for these results
    const resultIds = searchResults.map((r) => r.id);
    const { data: feedbackRows } = await supabase
      .from("user_feedback")
      .select("*")
      .in("search_result_id", resultIds)
      .eq("user_id", user.id);

    if (!feedbackRows || feedbackRows.length === 0) {
      return new Response(JSON.stringify({ success: true, updated: 0, message: "No feedback to compute SQM from" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fbMap = new Map(feedbackRows.map((f) => [f.search_result_id, f]));

    // 4. Compute importance I(d) for each result that has feedback
    // Normalization bounds
    const maxClickOrder = Math.max(...feedbackRows.map((f) => f.click_order ?? 0), 1);
    const maxDwell = Math.max(...feedbackRows.map((f) => f.dwell_time_ms ?? 0), 1);
    const maxCopy = Math.max(...feedbackRows.map((f) => f.copy_paste_chars ?? 0), 1);

    // Group results by URL (dedupe across engines)
    const urlMap = new Map<string, { url: string; resultIds: string[]; engineRanks: Map<string, number> }>();
    for (const sr of searchResults) {
      const normalized = sr.url.replace(/\/+$/, "").toLowerCase();
      const existing = urlMap.get(normalized);
      if (existing) {
        existing.resultIds.push(sr.id);
        existing.engineRanks.set(sr.engine, sr.original_rank);
      } else {
        const engineRanks = new Map<string, number>();
        engineRanks.set(sr.engine, sr.original_rank);
        urlMap.set(normalized, { url: sr.url, resultIds: [sr.id], engineRanks });
      }
    }

    // Compute I(d) per URL
    const docImportance: { url: string; importance: number; engineRanks: Map<string, number> }[] = [];

    for (const [, doc] of urlMap) {
      // Find best feedback across engine entries
      let bestFb = null;
      for (const rid of doc.resultIds) {
        const fb = fbMap.get(rid);
        if (fb && (!bestFb || (fb.click_order ?? 999) < (bestFb.click_order ?? 999))) {
          bestFb = fb;
        }
      }
      if (!bestFb) continue;

      const V = bestFb.click_order ? 1 - (bestFb.click_order - 1) / maxClickOrder : 0;
      const T = (bestFb.dwell_time_ms ?? 0) / maxDwell;
      const P = bestFb.printed ? 1 : 0;
      const S = bestFb.saved ? 1 : 0;
      const B = bestFb.bookmarked ? 1 : 0;
      const E = bestFb.emailed ? 1 : 0;
      const C = (bestFb.copy_paste_chars ?? 0) / maxCopy;

      const importance =
        profile.weight_v * V +
        profile.weight_t * T +
        profile.weight_p * P +
        profile.weight_s * S +
        profile.weight_b * B +
        profile.weight_e * E +
        profile.weight_c * C;

      docImportance.push({ url: doc.url, importance, engineRanks: doc.engineRanks });
    }

    if (docImportance.length < 2) {
      return new Response(JSON.stringify({ success: true, updated: 0, message: "Need at least 2 documents with feedback for Spearman correlation" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Build user preference ranking R (sorted by importance descending)
    docImportance.sort((a, b) => b.importance - a.importance);
    const preferenceRanks = new Map<string, number>();
    docImportance.forEach((d, i) => {
      preferenceRanks.set(d.url.replace(/\/+$/, "").toLowerCase(), i + 1);
    });

    // 6. Compute Spearman ρ for each engine
    const engines = new Set<string>();
    for (const doc of docImportance) {
      for (const eng of doc.engineRanks.keys()) {
        engines.add(eng);
      }
    }

    const n = docImportance.length;
    const sqmResults: { engine: string; rho: number }[] = [];

    for (const engine of engines) {
      // Only consider docs that appear in this engine
      const docsInEngine = docImportance.filter((d) => d.engineRanks.has(engine));
      if (docsInEngine.length < 2) continue;

      // Assign engine ranks (1-based, sorted by original_rank)
      const engineSorted = [...docsInEngine].sort((a, b) =>
        (a.engineRanks.get(engine) ?? 999) - (b.engineRanks.get(engine) ?? 999)
      );
      const engineRankMap = new Map<string, number>();
      engineSorted.forEach((d, i) => {
        engineRankMap.set(d.url.replace(/\/+$/, "").toLowerCase(), i + 1);
      });

      // Assign preference ranks (1-based among this subset)
      const prefSorted = [...docsInEngine].sort((a, b) => b.importance - a.importance);
      const prefRankMap = new Map<string, number>();
      prefSorted.forEach((d, i) => {
        prefRankMap.set(d.url.replace(/\/+$/, "").toLowerCase(), i + 1);
      });

      // Spearman ρ = 1 - 6Σd² / (n(n²-1))
      const nDocs = docsInEngine.length;
      let sumD2 = 0;
      for (const doc of docsInEngine) {
        const key = doc.url.replace(/\/+$/, "").toLowerCase();
        const eRank = engineRankMap.get(key) ?? nDocs;
        const pRank = prefRankMap.get(key) ?? nDocs;
        sumD2 += (eRank - pRank) ** 2;
      }

      const rho = 1 - (6 * sumD2) / (nDocs * (nDocs ** 2 - 1));
      sqmResults.push({ engine, rho });
    }

    // 7. Upsert SQM scores (running average)
    let updated = 0;
    for (const { engine, rho } of sqmResults) {
      const { data: existing } = await supabase
        .from("search_quality_measures")
        .select("id, sqm_score, query_count")
        .eq("user_id", user.id)
        .eq("engine", engine)
        .maybeSingle();

      if (existing) {
        const newCount = existing.query_count + 1;
        // Running average: new_avg = old_avg + (rho - old_avg) / newCount
        const newScore = existing.sqm_score + (rho - existing.sqm_score) / newCount;
        await supabase
          .from("search_quality_measures")
          .update({
            sqm_score: newScore,
            query_count: newCount,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("search_quality_measures").insert({
          user_id: user.id,
          engine,
          sqm_score: rho,
          query_count: 1,
        });
      }
      updated++;
    }

    return new Response(JSON.stringify({ success: true, updated, sqm: sqmResults }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("compute-sqm error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
