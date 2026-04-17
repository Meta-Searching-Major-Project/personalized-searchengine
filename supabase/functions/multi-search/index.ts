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

interface RichBlocks {
  weather?: any;
  dictionary?: any;
  images?: any[];
  knowledge_graph?: any;
  answer_box?: any;
}

interface EngineResult {
  engine: string;
  results: SerpResult[];
  rich?: RichBlocks;
  error?: string;
  cached?: boolean;
}

interface MergedDoc {
  url: string;
  title: string;
  snippet: string;
  engines: { engine: string; rank: number }[];
}

// ─── General web engines fanned out per search ──────────────────────
const WEB_ENGINES = ["google", "bing", "duckduckgo", "yahoo", "yandex", "baidu"];

// Cache freshness window — 7 days
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

// ─── Extract rich blocks from a SerpAPI response ────────────────────
function extractRichBlocks(data: any): RichBlocks {
  const rich: RichBlocks = {};
  if (data.weather_result || data.answer_box?.weather) {
    rich.weather = data.weather_result || data.answer_box;
  }
  // Dictionary appears in answer_box with type "dictionary_results" or in dictionary_results
  if (data.dictionary_results) {
    rich.dictionary = data.dictionary_results;
  } else if (data.answer_box?.type === "dictionary_results") {
    rich.dictionary = data.answer_box;
  }
  if (Array.isArray(data.inline_images) && data.inline_images.length > 0) {
    rich.images = data.inline_images.slice(0, 12);
  } else if (Array.isArray(data.images_results) && data.images_results.length > 0) {
    rich.images = data.images_results.slice(0, 12);
  }
  if (data.knowledge_graph) {
    rich.knowledge_graph = data.knowledge_graph;
  }
  if (data.answer_box && !rich.dictionary && !rich.weather) {
    rich.answer_box = data.answer_box;
  }
  return rich;
}

// ─── Search Engine Query (with cache) ───────────────────────────────

async function searchEngine(
  query: string,
  engine: string,
  apiKey: string,
  serviceClient: any
): Promise<EngineResult> {
  const qNorm = normalizeQuery(query);

  // 1. Try cache
  try {
    const { data: cached } = await serviceClient
      .from("search_cache")
      .select("organic_results, rich_blocks, fetched_at")
      .eq("query_normalized", qNorm)
      .eq("engine", engine)
      .maybeSingle();

    if (cached) {
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      if (age < CACHE_TTL_MS) {
        return {
          engine,
          results: cached.organic_results || [],
          rich: cached.rich_blocks || {},
          cached: true,
        };
      }
    }
  } catch (e) {
    console.warn(`Cache lookup failed for ${engine}:`, e);
  }

  // 2. Fetch from SerpAPI
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
    const rich = extractRichBlocks(data);

    // 3. Upsert cache (fire-and-forget)
    serviceClient
      .from("search_cache")
      .upsert(
        {
          query_normalized: qNorm,
          engine,
          organic_results: organicResults,
          rich_blocks: rich,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "query_normalized,engine" }
      )
      .then(({ error }: any) => {
        if (error) console.warn(`Cache write failed for ${engine}:`, error.message);
      });

    return { engine, results: organicResults, rich };
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
      if (!r.link) continue;
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

function getRank(doc: MergedDoc, engine: string): number {
  const entry = doc.engines.find((e) => e.engine === engine);
  return entry ? entry.rank : N + 1;
}

function bordaScore(doc: MergedDoc): number {
  return doc.engines.reduce((sum, e) => sum + (N + 1 - e.rank), 0);
}

function aggregateBorda(docs: MergedDoc[]): MergedDoc[] {
  return [...docs].sort((a, b) => bordaScore(b) - bordaScore(a));
}

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

function aggregateMBV(docs: MergedDoc[], engines: string[]): MergedDoc[] {
  const k = 0.5;
  function mbvScore(doc: MergedDoc): number {
    const ranks = engines.map((eng) => getRank(doc, eng));
    const mean = ranks.reduce((s, r) => s + r, 0) / ranks.length;
    const variance =
      ranks.reduce((s, r) => s + (r - mean) ** 2, 0) / ranks.length;
    return -(mean - k * Math.sqrt(variance));
  }
  return [...docs].sort((a, b) => mbvScore(b) - mbvScore(a));
}

function aggregateOWA(docs: MergedDoc[], engines: string[]): MergedDoc[] {
  const m = engines.length;
  if (m === 0) return aggregateBorda(docs);
  const weights: number[] = [];
  for (let j = 1; j <= m; j++) {
    weights.push((2 * (m + 1 - j)) / (m * (m + 1)));
  }
  const scores = docs.map((a, i) => {
    let minOWA = Infinity;
    for (let j = 0; j < docs.length; j++) {
      if (i === j) continue;
      const b = docs[j];
      const prefs = engines.map((eng) =>
        getRank(a, eng) <= getRank(b, eng) ? 1 : 0
      );
      prefs.sort((x, y) => y - x);
      const owaVal = prefs.reduce((sum, p, idx) => sum + weights[idx] * p, 0);
      if (owaVal < minOWA) minOWA = owaVal;
    }
    return { doc: a, score: minOWA === Infinity ? 1 : minOWA };
  });
  scores.sort((a, b) => b.score - a.score);
  return scores.map((s) => s.doc);
}

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

// ─── Merge rich blocks across engines (first non-empty wins) ────────
function mergeRichBlocks(engineResults: EngineResult[]): RichBlocks {
  const merged: RichBlocks = {};
  for (const er of engineResults) {
    if (!er.rich) continue;
    if (!merged.weather && er.rich.weather) merged.weather = er.rich.weather;
    if (!merged.dictionary && er.rich.dictionary) merged.dictionary = er.rich.dictionary;
    if (!merged.knowledge_graph && er.rich.knowledge_graph) merged.knowledge_graph = er.rich.knowledge_graph;
    if (!merged.answer_box && er.rich.answer_box) merged.answer_box = er.rich.answer_box;
    if ((!merged.images || merged.images.length === 0) && er.rich.images) {
      merged.images = er.rich.images;
    }
  }
  return merged;
}

// ─── Main Handler ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);
    let authUser: { id: string } | null = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const authClient = createClient(supabaseUrl, anonKey);
        const token = authHeader.replace("Bearer ", "");
        const { data: { user }, error: authError } = await authClient.auth.getUser(token);
        if (!authError && user) authUser = user;
      } catch (e) {
        console.warn("Auth validation failed, proceeding as guest:", e);
      }
    }

    const { query, aggregation_method } = await req.json();

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (query.length > 500) {
      return new Response(
        JSON.stringify({ success: false, error: "Query too long (max 500 chars)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("SERP_API_KEY");
    if (!apiKey) {
      console.error("SERP_API_KEY not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Search API not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const trimmedQuery = query.trim();
    const method = aggregation_method || "borda";
    console.log(`Multi-engine search [${method}] across ${WEB_ENGINES.length} engines:`, trimmedQuery);

    // Query all general engines in parallel (cache-first per engine)
    const engineResults: EngineResult[] = await Promise.all(
      WEB_ENGINES.map((eng) => searchEngine(trimmedQuery, eng, apiKey, serviceClient))
    );

    // Merge rich blocks from all engines
    const richBlocks = mergeRichBlocks(engineResults);

    // Personalized (N+1)-th source for signed-in users
    let learningResults: EngineResult = { engine: "learned", results: [] };
    let sqmScores: Record<string, number> = {};

    if (authUser) {
      try {
        const embeddingPromise = (async () => {
          try {
            const resp = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ text: trimmedQuery }),
            });
            if (resp.ok) {
              const data = await resp.json();
              return data.embedding as number[] | null;
            }
            return null;
          } catch (e) {
            console.error("Query embedding error:", e);
            return null;
          }
        })();

        const [queryEmbedding, sqmRes] = await Promise.all([
          embeddingPromise,
          serviceClient
            .from("search_quality_measures")
            .select("engine, sqm_score")
            .eq("user_id", authUser.id),
        ]);

        if (queryEmbedding) {
          const embeddingStr = `[${queryEmbedding.join(",")}]`;
          const { data: matchedDocs, error: matchError } = await serviceClient.rpc(
            "match_learned_documents",
            {
              query_embedding: embeddingStr,
              match_user_id: authUser.id,
              match_threshold: 0.2,
              match_count: 20,
            }
          );

          if (!matchError && matchedDocs && matchedDocs.length > 0) {
            const maxLearnedScore = Math.max(...matchedDocs.map((d: any) => d.learned_score), 0.01);
            const scored = matchedDocs.map((d: any) => ({
              ...d,
              blended: d.similarity * 0.6 + (d.learned_score / maxLearnedScore) * 0.4,
            }));
            scored.sort((a: any, b: any) => b.blended - a.blended);
            learningResults.results = scored.map((doc: any, i: number) => ({
              position: i + 1,
              title: doc.title || doc.url,
              link: doc.url,
              snippet: doc.snippet || "",
            }));
          }
        } else {
          const { data: learnedRes } = await serviceClient
            .from("feedback_learning_index")
            .select("url, title, snippet, learned_score, query_matches")
            .eq("user_id", authUser.id)
            .order("learned_score", { ascending: false })
            .limit(20);

          if (learnedRes && learnedRes.length > 0) {
            const queryWords = trimmedQuery.toLowerCase().split(/\s+/);
            const relevant = learnedRes.filter((doc) => {
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
        }

        if (sqmRes.data) {
          for (const row of sqmRes.data) sqmScores[row.engine] = row.sqm_score;
        }
      } catch (e) {
        console.error("Learning index / SQM query failed:", e);
      }
    }

    if (learningResults.results.length > 0) engineResults.push(learningResults);

    // Always re-aggregate (even on cached engine results)
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
        richBlocks,
        engineResults: engineResults.map((er) => ({
          engine: er.engine,
          count: er.results.length,
          error: er.error,
          cached: er.cached,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
