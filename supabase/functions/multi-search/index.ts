const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SerpResult {
  position: number;
  title: string;
  link: string;
  snippet?: string;
}

interface EngineResult {
  engine: string;
  results: SerpResult[];
  error?: string;
}

async function searchEngine(
  query: string,
  engine: string,
  apiKey: string
): Promise<EngineResult> {
  try {
    const params = new URLSearchParams({
      q: query,
      api_key: apiKey,
      engine,
      num: "10",
    });

    const response = await fetch(
      `https://serpapi.com/search.json?${params.toString()}`
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`SerpAPI ${engine} error [${response.status}]:`, errText);
      return { engine, results: [], error: `HTTP ${response.status}` };
    }

    const data = await response.json();

    const organicResults: SerpResult[] = (data.organic_results || []).map(
      (r: any, i: number) => ({
        position: r.position ?? i + 1,
        title: r.title ?? "",
        link: r.link ?? "",
        snippet: r.snippet ?? "",
      })
    );

    return { engine, results: organicResults };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`SerpAPI ${engine} exception:`, msg);
    return { engine, results: [], error: msg };
  }
}

function deduplicateAndMerge(
  engineResults: EngineResult[]
): {
  url: string;
  title: string;
  snippet: string;
  engines: { engine: string; rank: number }[];
}[] {
  const urlMap = new Map<
    string,
    {
      url: string;
      title: string;
      snippet: string;
      engines: { engine: string; rank: number }[];
    }
  >();

  for (const er of engineResults) {
    for (const r of er.results) {
      const normalizedUrl = r.link.replace(/\/+$/, "").toLowerCase();
      const existing = urlMap.get(normalizedUrl);
      if (existing) {
        existing.engines.push({ engine: er.engine, rank: r.position });
        if (!existing.snippet && r.snippet) {
          existing.snippet = r.snippet;
        }
      } else {
        urlMap.set(normalizedUrl, {
          url: r.link,
          title: r.title,
          snippet: r.snippet || "",
          engines: [{ engine: er.engine, rank: r.position }],
        });
      }
    }
  }

  // Simple Borda-style aggregation for initial ranking
  const results = Array.from(urlMap.values());
  const n = 11; // max rank + 1
  results.sort((a, b) => {
    const scoreA = a.engines.reduce((sum, e) => sum + (n - e.rank), 0);
    const scoreB = b.engines.reduce((sum, e) => sum + (n - e.rank), 0);
    return scoreB - scoreA;
  });

  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Query is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (query.length > 500) {
      return new Response(
        JSON.stringify({ success: false, error: "Query too long (max 500 chars)" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const apiKey = Deno.env.get("SERP_API_KEY");
    if (!apiKey) {
      console.error("SERP_API_KEY not configured");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Search API not configured",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const trimmedQuery = query.trim();
    console.log("Multi-engine search:", trimmedQuery);

    // Query all three engines in parallel
    const [google, bing, duckduckgo] = await Promise.all([
      searchEngine(trimmedQuery, "google", apiKey),
      searchEngine(trimmedQuery, "bing", apiKey),
      searchEngine(trimmedQuery, "duckduckgo", apiKey),
    ]);

    const engineResults = [google, bing, duckduckgo];
    const merged = deduplicateAndMerge(engineResults);

    return new Response(
      JSON.stringify({
        success: true,
        query: trimmedQuery,
        merged,
        engineResults: engineResults.map((er) => ({
          engine: er.engine,
          count: er.results.length,
          error: er.error,
        })),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Multi-search error:", error);
    const msg = error instanceof Error ? error.message : "Search failed";
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
