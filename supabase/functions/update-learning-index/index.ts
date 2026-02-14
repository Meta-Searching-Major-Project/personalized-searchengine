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
 * V = normalized click order (earlier click → higher value)
 * T = dwell_time_ms normalized by reading_speed
 * P, S, B, E = binary (0 or 1)
 * C = normalized copy-paste chars
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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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
      .select("id, url, title, snippet")
      .eq("search_history_id", search_history_id);

    if (!searchResults || searchResults.length === 0) {
      return new Response(JSON.stringify({ success: true, updated: 0 }), {
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
      return new Response(JSON.stringify({ success: true, updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build feedback lookup by search_result_id
    const fbMap = new Map(feedbackRows.map((f) => [f.search_result_id, f]));

    // Compute normalization bounds
    const maxClickOrder = Math.max(...feedbackRows.map((f) => f.click_order ?? 0), 1);
    const maxDwell = Math.max(...feedbackRows.map((f) => f.dwell_time_ms ?? 0), 1);
    const maxCopy = Math.max(...feedbackRows.map((f) => f.copy_paste_chars ?? 0), 1);

    // 4. Fetch the query text for query_matches
    const { data: historyRow } = await supabase
      .from("search_history")
      .select("query")
      .eq("id", search_history_id)
      .single();

    const queryText = historyRow?.query || "";

    // 5. Compute importance for each result that has feedback and upsert
    // Deduplicate by URL (multiple engines may have same URL)
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
      // Find best feedback across all engine entries for this URL
      let bestFb = null;
      for (const rid of doc.resultIds) {
        const fb = fbMap.get(rid);
        if (fb && (!bestFb || (fb.click_order ?? 999) < (bestFb.click_order ?? 999))) {
          bestFb = fb;
        }
      }
      if (!bestFb) continue;

      // Normalize signals to [0, 1]
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

      if (importance <= 0) continue;

      // Upsert into feedback_learning_index
      const { data: existing } = await supabase
        .from("feedback_learning_index")
        .select("id, learned_score, query_matches")
        .eq("url", doc.url)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        // Merge: exponential moving average for score, append query
        const alpha = 0.3;
        const newScore = alpha * importance + (1 - alpha) * existing.learned_score;
        const queries: string[] = existing.query_matches || [];
        if (queryText && !queries.includes(queryText)) {
          queries.push(queryText);
        }
        await supabase
          .from("feedback_learning_index")
          .update({
            learned_score: newScore,
            query_matches: queries,
            title: doc.title,
            snippet: doc.snippet,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("feedback_learning_index").insert({
          url: doc.url,
          user_id: user.id,
          learned_score: importance,
          title: doc.title,
          snippet: doc.snippet,
          query_matches: queryText ? [queryText] : [],
        });
      }
      updated++;
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
