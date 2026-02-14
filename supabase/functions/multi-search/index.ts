import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

interface MergedDoc {
  url: string;
  title: string;
  snippet: string;
  engines: { engine: string; rank: number }[];
}

// ─── Search Engine Query ─────────────────────────────────────────────

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

// ─── Deduplication (separate from ranking) ──────────────────────────

function deduplicateResults(engineResults: EngineResult[]): MergedDoc[] {
  const urlMap = new Map<string, MergedDoc>();

  for (const er of engineResults) {
    for (const r of er.results) {
      const normalizedUrl = r.link.replace(/\/+$/, "").toLowerCase();
      const existing = urlMap.get(normalizedUrl);
      if (existing) {
        existing.engines.push({ engine: er.engine, rank: r.position });
        if (!existing.snippet && r.snippet) existing.snippet = r.snippet;
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

  return Array.from(urlMap.values());
}

// ─── Rank Aggregation Algorithms ────────────────────────────────────

const N = 10; // max results per engine
const engineNames = ["google", "bing", "duckduckgo", "learned"];

/** Helper: get rank of doc in engine, or N+1 if absent */
function getRank(doc: MergedDoc, engine: string): number {
  const entry = doc.engines.find((e) => e.engine === engine);
  return entry ? entry.rank : N + 1;
}

/** 1. Borda's Method: score = Σ(n+1 - rank) */
function bordaScore(doc: MergedDoc): number {
  return doc.engines.reduce((sum, e) => sum + (N + 1 - e.rank), 0);
}

function aggregateBorda(docs: MergedDoc[]): MergedDoc[] {
  return [...docs].sort((a, b) => bordaScore(b) - bordaScore(a));
}

/**
 * 2. Shimura's Fuzzy Ordering
 * Pairwise fuzzy preference: μ(a,b) = #{engines where a ≤ b rank} / #engines
 * Score(a) = min over all b≠a of μ(a,b)
 */
function aggregateShimura(docs: MergedDoc[], engines: string[]): MergedDoc[] {
  const m = engines.length;
  if (m === 0) return aggregateBorda(docs);

  const scores = docs.map((a, i) => {
    let minPref = Infinity;
    for (let j = 0; j < docs.length; j++) {
      if (i === j) continue;
      const b = docs[j];
      let count = 0;
      for (const eng of engines) {
        if (getRank(a, eng) <= getRank(b, eng)) count++;
      }
      const pref = count / m;
      if (pref < minPref) minPref = pref;
    }
    return { doc: a, score: minPref === Infinity ? 1 : minPref };
  });

  scores.sort((a, b) => b.score - a.score);
  return scores.map((s) => s.doc);
}

/**
 * 3. Modal Value Method
 * For each doc, the "modal rank" is the rank that appears most frequently
 * across engines. Ties broken by best (lowest) modal rank.
 * Absent engines count as rank N+1.
 */
function aggregateModal(docs: MergedDoc[], engines: string[]): MergedDoc[] {
  function modalRank(doc: MergedDoc): number {
    const ranks = engines.map((eng) => getRank(doc, eng));
    const freq = new Map<number, number>();
    for (const r of ranks) freq.set(r, (freq.get(r) || 0) + 1);
    let maxFreq = 0;
    let bestRank = N + 1;
    for (const [rank, count] of freq) {
      if (count > maxFreq || (count === maxFreq && rank < bestRank)) {
        maxFreq = count;
        bestRank = rank;
      }
    }
    return bestRank;
  }

  return [...docs].sort((a, b) => modalRank(a) - modalRank(b));
}

/**
 * 4. Membership Function Ordering (MFO)
 * μ_i(x) = (N+1 - rank_i(x)) / N for each engine i
 * Score = max over all engines of μ_i
 * (The doc with the highest membership in any single engine wins)
 */
function aggregateMFO(docs: MergedDoc[], engines: string[]): MergedDoc[] {
  function mfoScore(doc: MergedDoc): number {
    let maxMu = 0;
    for (const eng of engines) {
      const r = getRank(doc, eng);
      const mu = (N + 1 - r) / N;
      if (mu > maxMu) maxMu = mu;
    }
    return maxMu;
  }

  return [...docs].sort((a, b) => mfoScore(b) - mfoScore(a));
}

/**
 * 5. Mean-by-Variance (MBV)
 * Score = mean_rank - k * variance
 * Lower is better. k=0.5 is a common choice.
 * This favors docs ranked consistently well across engines.
 */
function aggregateMBV(docs: MergedDoc[], engines: string[]): MergedDoc[] {
  const k = 0.5;

  function mbvScore(doc: MergedDoc): number {
    const ranks = engines.map((eng) => getRank(doc, eng));
    const mean = ranks.reduce((s, r) => s + r, 0) / ranks.length;
    const variance =
      ranks.reduce((s, r) => s + (r - mean) ** 2, 0) / ranks.length;
    // Lower mean - k*variance is better → we negate for sorting descending
    return -(mean - k * Math.sqrt(variance));
  }

  return [...docs].sort((a, b) => mbvScore(b) - mbvScore(a));
}

/**
 * 6. OWA-improved Shimura
 * Uses Ordered Weighted Averaging operator on pairwise preferences.
 * OWA weights: w_j = 2(m+1-j) / (m(m+1)) where m = #engines
 * Score(a) = min over all b≠a of OWA({μ_eng(a,b)})
 */
function aggregateOWA(docs: MergedDoc[], engines: string[]): MergedDoc[] {
  const m = engines.length;
  if (m === 0) return aggregateBorda(docs);

  // Compute OWA weights (descending importance)
  const weights: number[] = [];
  for (let j = 1; j <= m; j++) {
    weights.push((2 * (m + 1 - j)) / (m * (m + 1)));
  }

  const scores = docs.map((a, i) => {
    let minOWA = Infinity;
    for (let j = 0; j < docs.length; j++) {
      if (i === j) continue;
      const b = docs[j];

      // Per-engine binary preferences (1 if a beats/ties b, 0 otherwise)
      const prefs = engines.map((eng) =>
        getRank(a, eng) <= getRank(b, eng) ? 1 : 0
      );

      // Sort descending for OWA
      prefs.sort((x, y) => y - x);

      // Weighted sum
      const owaVal = prefs.reduce((sum, p, idx) => sum + weights[idx] * p, 0);
      if (owaVal < minOWA) minOWA = owaVal;
    }
    return { doc: a, score: minOWA === Infinity ? 1 : minOWA };
  });

  scores.sort((a, b) => b.score - a.score);
  return scores.map((s) => s.doc);
}

/**
 * 7. Biased Rank Aggregation
 * Weights each engine's Borda contribution by its SQM score.
 * score(d) = Σ_i  sqm_i * (N+1 - rank_i(d))
 * Engines without SQM default to 1.0.
 */
function aggregateBiased(
  docs: MergedDoc[],
  sqmScores: Record<string, number>
): MergedDoc[] {
  function biasedScore(doc: MergedDoc): number {
    return doc.engines.reduce((sum, e) => {
      const sqm = sqmScores[e.engine] ?? 1.0;
      return sum + sqm * (N + 1 - e.rank);
    }, 0);
  }

  return [...docs].sort((a, b) => biasedScore(b) - biasedScore(a));
}

// ─── Dispatcher ─────────────────────────────────────────────────────

function rankResults(
  docs: MergedDoc[],
  method: string,
  activeEngines: string[],
  sqmScores: Record<string, number>
): MergedDoc[] {
  switch (method) {
    case "shimura":
      return aggregateShimura(docs, activeEngines);
    case "modal":
      return aggregateModal(docs, activeEngines);
    case "mfo":
      return aggregateMFO(docs, activeEngines);
    case "mbv":
      return aggregateMBV(docs, activeEngines);
    case "owa":
      return aggregateOWA(docs, activeEngines);
    case "biased":
      return aggregateBiased(docs, sqmScores);
    case "borda":
    default:
      return aggregateBorda(docs);
  }
}

// ─── Main Handler ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(supabaseUrl, anonKey);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user: authUser },
      error: authError,
    } = await authClient.auth.getUser(token);

    if (authError || !authUser) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid authentication" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { query, aggregation_method } = await req.json();

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
        JSON.stringify({
          success: false,
          error: "Query too long (max 500 chars)",
        }),
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
        JSON.stringify({ success: false, error: "Search API not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const trimmedQuery = query.trim();
    const method = aggregation_method || "borda";
    console.log(`Multi-engine search [${method}]:`, trimmedQuery);

    // Query all three engines in parallel
    const [google, bing, duckduckgo] = await Promise.all([
      searchEngine(trimmedQuery, "google", apiKey),
      searchEngine(trimmedQuery, "bing", apiKey),
      searchEngine(trimmedQuery, "duckduckgo", apiKey),
    ]);

    const engineResults = [google, bing, duckduckgo];

    // (N+1)-th source: query the feedback learning index for this user
    let learningResults: EngineResult = { engine: "learned", results: [] };
    let sqmScores: Record<string, number> = {};

    try {
      const serviceClient = createClient(
        supabaseUrl,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      // Fetch learning index + SQM in parallel
      const [learnedRes, sqmRes] = await Promise.all([
        serviceClient
          .from("feedback_learning_index")
          .select("url, title, snippet, learned_score, query_matches")
          .eq("user_id", authUser.id)
          .order("learned_score", { ascending: false })
          .limit(20),
        serviceClient
          .from("search_quality_measures")
          .select("engine, sqm_score")
          .eq("user_id", authUser.id),
      ]);

      // Process learning index
      if (learnedRes.data && learnedRes.data.length > 0) {
        const queryWords = trimmedQuery.toLowerCase().split(/\s+/);
        const relevant = learnedRes.data.filter((doc) => {
          const matches = doc.query_matches || [];
          return matches.some((q: string) => {
            const matchWords = q.toLowerCase().split(/\s+/);
            return queryWords.some((w) => matchWords.includes(w));
          });
        });

        learningResults.results = relevant.map((doc, i) => ({
          position: i + 1,
          title: doc.title || doc.url,
          link: doc.url,
          snippet: doc.snippet || "",
        }));
      }

      // Process SQM scores for biased aggregation
      if (sqmRes.data) {
        for (const row of sqmRes.data) {
          sqmScores[row.engine] = row.sqm_score;
        }
      }
    } catch (e) {
      console.error("Learning index / SQM query failed:", e);
    }

    if (learningResults.results.length > 0) {
      engineResults.push(learningResults);
    }

    // Deduplicate then rank with selected algorithm
    const deduplicated = deduplicateResults(engineResults);
    const activeEngines = engineResults
      .filter((er) => er.results.length > 0)
      .map((er) => er.engine);
    const merged = rankResults(deduplicated, method, activeEngines, sqmScores);

    return new Response(
      JSON.stringify({
        success: true,
        query: trimmedQuery,
        aggregation_method: method,
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
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
