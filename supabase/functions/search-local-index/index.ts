import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * search-local-index: Searches the locally crawled web_pages index
 * using hybrid vector similarity + full-text search.
 *
 * Accepts: { query: string, count?: number }
 * Returns: { success: true, results: SerpResult[], total_indexed: number }
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { query, count } = await req.json();

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "Query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const matchCount = Math.min(Math.max(count || 20, 1), 50);

    // 1. Generate query embedding
    let queryEmbedding: number[] | null = null;
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: query, task_type: "RETRIEVAL_QUERY" }),
      });
      if (resp.ok) {
        const data = await resp.json();
        queryEmbedding = data.embedding || null;
      }
    } catch (e) {
      console.error("Query embedding error:", e);
    }

    if (!queryEmbedding) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to generate query embedding" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Hybrid search: vector + full-text
    const embeddingStr = `[${queryEmbedding.join(",")}]`;
    const { data: results, error: searchError } = await supabase.rpc(
      "search_local_index",
      {
        query_embedding: embeddingStr,
        query_text: query,
        match_count: matchCount,
      }
    );

    if (searchError) {
      throw new Error(`Search failed: ${searchError.message}`);
    }

    // 3. Blend scores: 0.6 * vector similarity + 0.4 * text rank
    const scored = (results || []).map((r: any) => {
      const textRankNorm = Math.min(r.text_rank / 0.1, 1.0); // normalize text rank
      const blended = 0.6 * r.similarity + 0.4 * textRankNorm;
      return { ...r, blended };
    });
    scored.sort((a: any, b: any) => b.blended - a.blended);

    // 4. Format as SerpResult-compatible
    const formattedResults = scored.map((r: any, i: number) => ({
      position: i + 1,
      title: r.title || r.url,
      link: r.url,
      snippet: r.snippet || "",
      domain: r.domain,
      similarity: r.similarity,
    }));

    // 5. Get total indexed count (for stats)
    const { count: totalIndexed } = await supabase
      .from("web_pages")
      .select("id", { count: "exact", head: true })
      .eq("crawl_status", "crawled");

    return new Response(
      JSON.stringify({
        success: true,
        results: formattedResults,
        total_indexed: totalIndexed || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("search-local-index error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
