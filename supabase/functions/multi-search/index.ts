import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ──────────────────────────────────────────────────────────

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

// ─── Engine Configuration (Task 3) ─────────────────────────────────
// Per-engine metadata for SerpApi: query param names, extra params,
// which JSON key holds organic results, and optional custom parsers.

interface EngineConfig {
  engine: string;
  queryParam?: string;                        // default "q"
  extraParams?: Record<string, string>;       // appended to SerpApi URL
  resultsKey?: string;                        // default "organic_results"
  parseResult?: (r: any, i: number) => SerpResult | null;
}

/** Standard parser — works for Google, Bing, DuckDuckGo, Yandex, Baidu, Naver */
function parseStandard(r: any, i: number): SerpResult | null {
  const link = r.link || r.url || "";
  if (!link) return null;
  return {
    position: r.position ?? i + 1,
    title: r.title ?? "",
    link,
    snippet: r.snippet ?? r.description ?? "",
  };
}

/** Brave — results live under data.web.results with { title, url, description } */
function parseBrave(r: any, i: number): SerpResult | null {
  const link = r.url || r.link || "";
  if (!link) return null;
  return {
    position: r.position ?? i + 1,
    title: r.title ?? "",
    link,
    snippet: r.description ?? r.snippet ?? "",
  };
}

/** Google Scholar — append publication_info to snippet */
function parseScholar(r: any, i: number): SerpResult | null {
  const link = r.link || "";
  if (!link) return null;
  let snippet = r.snippet ?? "";
  if (r.publication_info?.summary) {
    snippet = `${r.publication_info.summary} — ${snippet}`;
  }
  return {
    position: r.position ?? i + 1,
    title: r.title ?? "",
    link,
    snippet,
  };
}

/** Google News — results use news_results with { title, link, snippet, source, date } */
function parseNews(r: any, i: number): SerpResult | null {
  const link = r.link || "";
  if (!link) return null;
  let snippet = r.snippet ?? "";
  if (r.source?.name) snippet = `[${r.source.name}] ${snippet}`;
  if (r.date) snippet = `${snippet} (${r.date})`;
  return {
    position: r.position ?? i + 1,
    title: r.title ?? "",
    link,
    snippet: snippet.trim(),
  };
}

const WEB_ENGINES: EngineConfig[] = [
  // ── Original 6 engines ──
  { engine: "google" },
  { engine: "bing" },
  { engine: "duckduckgo" },
  { engine: "yahoo", queryParam: "p" },
  { engine: "yandex", queryParam: "text" },
  { engine: "baidu" },
  // ── New engines (Task 3) ──
  { engine: "naver", extraParams: { where: "web" } },
  { engine: "brave", resultsKey: "web.results", parseResult: parseBrave },
  { engine: "google_scholar", parseResult: parseScholar },
  { engine: "google_news", resultsKey: "news_results", parseResult: parseNews },
];

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

/**
 * Resolves a nested key like "web.results" from an object.
 * e.g. getNestedKey(data, "web.results") → data.web?.results
 */
function getNestedKey(obj: any, key: string): any {
  return key.split(".").reduce((acc, part) => acc?.[part], obj);
}

// ─── Search Engine Query (with cache) ───────────────────────────────

async function searchEngine(
  query: string,
  config: EngineConfig,
  apiKey: string,
  serviceClient: any
): Promise<EngineResult> {
  const { engine } = config;
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
    const qp = config.queryParam || "q";
    const params = new URLSearchParams({
      [qp]: query,
      api_key: apiKey,
      engine,
      num: "10",
      ...(config.extraParams || {}),
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

    // Resolve the results array using the configured key
    const resultsKey = config.resultsKey || "organic_results";
    const rawResults = getNestedKey(data, resultsKey) || [];
    const parser = config.parseResult || parseStandard;

    const organicResults: SerpResult[] = [];
    if (Array.isArray(rawResults)) {
      for (let i = 0; i < rawResults.length; i++) {
        const parsed = parser(rawResults[i], i);
        if (parsed) organicResults.push(parsed);
      }
    }

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

// ─── Rank Aggregation Algorithms (Task 1 — fixed) ──────────────────
// All algorithms now use a dynamic maxRank instead of hardcoded N=10.
// Deterministic tiebreaker: more engines first, then URL alphabetically.

function computeMaxRank(docs: MergedDoc[]): number {
  let max = 10; // floor
  for (const d of docs) {
    for (const e of d.engines) {
      if (e.rank > max) max = e.rank;
    }
  }
  return max;
}

/** Sentinel rank for documents absent from an engine */
function getSentinel(maxRank: number): number {
  return maxRank + 1;
}

function getRank(doc: MergedDoc, engine: string, maxRank: number): number {
  const entry = doc.engines.find((e) => e.engine === engine);
  return entry ? entry.rank : getSentinel(maxRank);
}

/** Deterministic tiebreaker: prefer more engines, then alphabetical URL */
function tiebreak(a: MergedDoc, b: MergedDoc): number {
  if (b.engines.length !== a.engines.length) return b.engines.length - a.engines.length;
  return a.url.localeCompare(b.url);
}

// ── Borda Count ─────────────────────────────────────────────────────

function bordaScore(doc: MergedDoc, maxRank: number): number {
  // Only count engines the doc appears in (no sentinel penalty)
  return doc.engines.reduce((sum, e) => sum + (maxRank + 1 - e.rank), 0);
}

function aggregateBorda(docs: MergedDoc[], maxRank: number): MergedDoc[] {
  return [...docs].sort((a, b) => {
    const diff = bordaScore(b, maxRank) - bordaScore(a, maxRank);
    return diff !== 0 ? diff : tiebreak(a, b);
  });
}

// ── Shimura (Fuzzy Majority) ────────────────────────────────────────

function aggregateShimura(docs: MergedDoc[], engines: string[], maxRank: number): MergedDoc[] {
  const m = engines.length;
  if (m === 0) return aggregateBorda(docs, maxRank);
  const scores = docs.map((a, i) => {
    let minPref = Infinity;
    for (let j = 0; j < docs.length; j++) {
      if (i === j) continue;
      const b = docs[j];
      let count = 0;
      for (const eng of engines) {
        if (getRank(a, eng, maxRank) <= getRank(b, eng, maxRank)) count++;
      }
      const pref = count / m;
      if (pref < minPref) minPref = pref;
    }
    return { doc: a, score: minPref === Infinity ? 1 : minPref };
  });
  scores.sort((a, b) => {
    const diff = b.score - a.score;
    return diff !== 0 ? diff : tiebreak(a.doc, b.doc);
  });
  return scores.map((s) => s.doc);
}

// ── Modal Rank (FIXED: only count actual ranks, not sentinels) ──────

function aggregateModal(docs: MergedDoc[]): MergedDoc[] {
  function modalRank(doc: MergedDoc): number {
    // Only use ranks from engines that actually returned this doc
    if (doc.engines.length === 0) return Infinity;
    const freq = new Map<number, number>();
    for (const e of doc.engines) {
      freq.set(e.rank, (freq.get(e.rank) || 0) + 1);
    }
    let maxFreq = 0;
    let bestRank = Infinity;
    for (const [rank, count] of freq) {
      if (count > maxFreq || (count === maxFreq && rank < bestRank)) {
        maxFreq = count;
        bestRank = rank;
      }
    }
    return bestRank;
  }
  return [...docs].sort((a, b) => {
    const diff = modalRank(a) - modalRank(b);
    return diff !== 0 ? diff : tiebreak(a, b);
  });
}

// ── MFO (Maximum Fuzzy Optimistic) ──────────────────────────────────

function aggregateMFO(docs: MergedDoc[], maxRank: number): MergedDoc[] {
  function mfoScore(doc: MergedDoc): number {
    let best = 0;
    for (const e of doc.engines) {
      const mu = (maxRank + 1 - e.rank) / maxRank;
      if (mu > best) best = mu;
    }
    return best;
  }
  return [...docs].sort((a, b) => {
    const diff = mfoScore(b) - mfoScore(a);
    return diff !== 0 ? diff : tiebreak(a, b);
  });
}

// ── MBV (FIXED: compute over actual ranks only, positive scoring) ───

function aggregateMBV(docs: MergedDoc[], maxRank: number): MergedDoc[] {
  const k = 0.5;
  function mbvScore(doc: MergedDoc): number {
    if (doc.engines.length === 0) return 0;
    const ranks = doc.engines.map((e) => e.rank);
    const mean = ranks.reduce((s, r) => s + r, 0) / ranks.length;
    const variance = ranks.reduce((s, r) => s + (r - mean) ** 2, 0) / ranks.length;
    // Positive scoring: lower mean = better, lower variance = more consistent
    // k * σ rewards consistency (subtracts less for low-variance docs)
    return (maxRank + 1 - mean) + k * Math.sqrt(variance > 0 ? 1 / variance : 1);
  }
  return [...docs].sort((a, b) => {
    const diff = mbvScore(b) - mbvScore(a);
    return diff !== 0 ? diff : tiebreak(a, b);
  });
}

// ── OWA (Ordered Weighted Averaging) ────────────────────────────────

function aggregateOWA(docs: MergedDoc[], engines: string[], maxRank: number): MergedDoc[] {
  const m = engines.length;
  if (m === 0) return aggregateBorda(docs, maxRank);
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
        getRank(a, eng, maxRank) <= getRank(b, eng, maxRank) ? 1 : 0
      );
      prefs.sort((x, y) => y - x);
      const owaVal = prefs.reduce((sum, p, idx) => sum + weights[idx] * p, 0);
      if (owaVal < minOWA) minOWA = owaVal;
    }
    return { doc: a, score: minOWA === Infinity ? 1 : minOWA };
  });
  scores.sort((a, b) => {
    const diff = b.score - a.score;
    return diff !== 0 ? diff : tiebreak(a.doc, b.doc);
  });
  return scores.map((s) => s.doc);
}

// ── Biased (SQM-weighted Borda) ─────────────────────────────────────

function aggregateBiased(
  docs: MergedDoc[],
  sqmScores: Record<string, number>,
  maxRank: number
): MergedDoc[] {
  function biasedScore(doc: MergedDoc): number {
    return doc.engines.reduce((sum, e) => {
      const sqm = sqmScores[e.engine] ?? 1.0;
      return sum + sqm * (maxRank + 1 - e.rank);
    }, 0);
  }
  return [...docs].sort((a, b) => {
    const diff = biasedScore(b) - biasedScore(a);
    return diff !== 0 ? diff : tiebreak(a, b);
  });
}

// ── Dispatcher ──────────────────────────────────────────────────────

function rankResults(
  docs: MergedDoc[],
  method: string,
  activeEngines: string[],
  sqmScores: Record<string, number>
): MergedDoc[] {
  const maxRank = computeMaxRank(docs);
  switch (method) {
    case "shimura":
      return aggregateShimura(docs, activeEngines, maxRank);
    case "modal":
      return aggregateModal(docs);
    case "mfo":
      return aggregateMFO(docs, maxRank);
    case "mbv":
      return aggregateMBV(docs, maxRank);
    case "owa":
      return aggregateOWA(docs, activeEngines, maxRank);
    case "biased":
      return aggregateBiased(docs, sqmScores, maxRank);
    case "borda":
    default:
      return aggregateBorda(docs, maxRank);
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
      WEB_ENGINES.map((cfg) => searchEngine(trimmedQuery, cfg, apiKey, serviceClient))
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
              body: JSON.stringify({ text: trimmedQuery, task_type: "RETRIEVAL_QUERY" }),
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

    // ─── Local web index as additional engine source ──────────────
    let localIndexResults: EngineResult = { engine: "local_index", results: [] };
    try {
      const { count: indexedCount } = await serviceClient
        .from("web_pages")
        .select("id", { count: "exact", head: true })
        .eq("crawl_status", "crawled");

      // Only query local index if we have a meaningful number of pages
      if (indexedCount && indexedCount >= 100) {
        const localResp = await fetch(`${supabaseUrl}/functions/v1/search-local-index`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: trimmedQuery, count: 10 }),
        });
        if (localResp.ok) {
          const localData = await localResp.json();
          if (localData.results && localData.results.length > 0) {
            localIndexResults.results = localData.results.map((r: any, i: number) => ({
              position: i + 1,
              title: r.title || r.link,
              link: r.link,
              snippet: r.snippet || "",
            }));
          }
        }
      }
    } catch (e) {
      console.warn("Local index search failed (non-fatal):", e);
    }
    if (localIndexResults.results.length > 0) engineResults.push(localIndexResults);

    // Always re-aggregate (even on cached engine results)
    const deduplicated = deduplicateResults(engineResults);
    const activeEngines = engineResults
      .filter((er) => er.results.length > 0)
      .map((er) => er.engine);
    const merged = rankResults(deduplicated, method, activeEngines, sqmScores);

    const responseBody = JSON.stringify({
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
    });

    // ─── Fire-and-forget: queue URLs for crawling ─────────────────
    // This runs AFTER the response is built so it doesn't slow down search.
    // We insert all unique result URLs into the crawl_queue table.
    (async () => {
      try {
        // Collect unique URLs with metadata
        const urlMap = new Map<string, { url: string; title: string; snippet: string; engines: string[]; priority: number }>();
        for (const er of engineResults) {
          if (er.engine === "learned" || er.engine === "local_index") continue;
          for (const r of er.results) {
            if (!r.link) continue;
            const key = r.link.replace(/\/+$/, "").toLowerCase();
            const existing = urlMap.get(key);
            if (existing) {
              existing.engines.push(er.engine);
              existing.priority = existing.engines.length;
            } else {
              urlMap.set(key, {
                url: r.link,
                title: r.title || "",
                snippet: r.snippet || "",
                engines: [er.engine],
                priority: 1,
              });
            }
          }
        }

        // Check which URLs are already in web_pages (crawled recently)
        const urls = Array.from(urlMap.values()).map((u) => u.url);
        if (urls.length === 0) return;

        const { data: existingPages } = await serviceClient
          .from("web_pages")
          .select("url")
          .in("url", urls.slice(0, 200));

        const existingUrls = new Set((existingPages || []).map((p: any) => p.url));

        // Also check what's already queued
        const { data: existingQueue } = await serviceClient
          .from("crawl_queue")
          .select("url")
          .in("url", urls.slice(0, 200))
          .in("status", ["pending", "processing"]);

        const queuedUrls = new Set((existingQueue || []).map((q: any) => q.url));

        // Insert only new URLs
        const toInsert = Array.from(urlMap.values())
          .filter((u) => !existingUrls.has(u.url) && !queuedUrls.has(u.url))
          .map((u) => ({
            url: u.url,
            title: u.title,
            snippet: u.snippet,
            source_engine: u.engines[0],
            priority: u.priority,
          }));

        if (toInsert.length > 0) {
          await serviceClient.from("crawl_queue").insert(toInsert);
          console.log(`Queued ${toInsert.length} URLs for crawling`);
        }

        // Trigger crawl-page in background (fire-and-forget)
        fetch(`${supabaseUrl}/functions/v1/crawl-page`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ batch_size: 5 }),
        }).catch((e) => console.warn("Background crawl trigger failed:", e));
      } catch (e) {
        console.warn("URL queueing failed (non-fatal):", e);
      }
    })();

    return new Response(responseBody, {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Multi-search error:", error);
    const msg = error instanceof Error ? error.message : "Search failed";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
