# AMUSE (PersonaSearch): Strict Codebase Report - Part 2: Backend Edge Functions

*This is Part 2 of an exhaustive, file-by-file technical breakdown of the AMUSE Meta-Search engine. This section focuses strictly on the Deno V8 Edge Functions hosted on Supabase.*

---

## 1. Orchestration: `multi-search/index.ts`

This is the largest Edge Function in the repository, handling parallel fetching, normalization, and aggregation.

### 1.1 Intent Detection & Routing
*   **`detectQueryIntent(query)`**: A pure function utilizing regular expressions to categorize queries to optimize API spend.
    *   Korean characters `[\uAC00-\uD7AF]` automatically flag `intent: "regional"` and map `regionalEngine` to `"naver"`.
    *   Keywords like `error`, `bug`, `github`, and `npm` trigger `coding` intent.
*   **`selectEnginesForIntent(intentResult, preferredEngines)`**: Determines the final engine payload.
    *   If the user profile explicitly defined `preferredEngines` (via `SettingsPage`), the dynamic intent is strictly ignored.
    *   Otherwise, it relies on `routingMap`. For example, `generic` intent triggers an array containing `["google", "bing", "duckduckgo", "yahoo", "yandex"]`.

### 1.2 Parallel Execution (`searchEngine`)
The core fetch mechanism.
1.  **Cache Verification**: Queries the `search_cache` table using the normalized query and engine name. If `Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS`, it returns the JSON locally, bypassing the network.
2.  **API Dispatch**: Constructs a `URLSearchParams` object targeting `serpapi.com/search.json`. 
3.  **Pagination Aggregation**: For major engines like Google, it constructs an array of Promises: `pagesToFetch = [fetchPage(), fetchPage({ start: "10" })]`. This fetches the first 20 results simultaneously.
4.  **Data Extraction**: Utilizes custom parser functions (e.g., `parseScholar` appends the `publication_info.summary` to the standard snippet). It enforces a strict deduplication phase on the `organicResults` array, capping it at exactly 20 elements via `.slice(0, 20)`.

### 1.3 Mathematical Rank Aggregation
Once the `Promise.allSettled()` block resolves all engines, `deduplicateResults()` flattens the arrays. The `rankResults()` switch statement applies mathematical models:
*   **Borda Count**: The simplest consensus model. Points are calculated as `(maxRank + 1) - rank`. 
*   **Shimura (Fuzzy Majority)**: A pairwise matrix approach. For every pair of documents A and B, it counts the fraction of engines where $Rank(A) \leq Rank(B)$. It finds the minimum fraction across all pairings to determine the final document score.
*   **MFO (Maximum Fuzzy Optimistic)**: Calculates the membership function $\mu = (maxRank + 1 - rank) / maxRank$ across all engines that proposed the document, and simply takes the maximum $\mu$ value found.
*   **MBV (Mean By Variance)**: Sorts documents by rewarding low variance. Formula: `(maxRank + 1 - mean) + 0.5 * Math.sqrt(1 / variance)`. This penalizes documents that one engine ranks #1 but all others rank #20.

### 1.4 N+1 Learned Engine Injection
If the user provides an Auth Token:
1.  A POST request is sent to the local `generate-embedding` edge function to convert the string query into a 768-dimension vector.
2.  It executes `serviceClient.rpc("match_learned_documents")` against the PostgreSQL database.
3.  The SQL function calculates `embedding <=> query_embedding` (Cosine Distance).
4.  Documents matching the query are mathematically blended: `blended = similarity * 0.6 + (learned_score / maxLearnedScore) * 0.4`.
5.  These documents are wrapped into an `EngineResult` object named `"learned"` and appended to the aggregation queue. The `aggregateBiased` function grants this specific engine an artificially massive SQM weight of `5.0` to guarantee high placement.

---

## 2. Machine Learning: `compute-sqm/index.ts`

This function mathematically scores the reliability of each upstream search engine for a specific user using Spearman's Rank-Order Correlation.

### 2.1 Importance Scoring
Iterates over all documents interacted with during a `search_history_id` session.
*   Extracts signals: Click order ($V$), explicit prints ($P$), saves ($S$), bookmarks ($B$), and emails ($E$).
*   Calculates Dwell proportion ($T$): Uses the `page_size_bytes` fetched from the content script and divides by the user's `reading_speed` (default 10 bytes/sec) to find the theoretical maximum reading time ($t_{max}$). $T = t / t_{max}$.
*   Calculates Copy proportion ($C$): Sums all `copy_paste_chars` across the entire session to find $c_{total}$. $C = c / c_{total}$.
*   Multiplies these variables by the user's defined profile weights ($w_V, w_T, etc.$) to create the final scalar Importance Score $I(d)$.

### 2.2 Spearman Calculation ($\rho$)
*   Creates a User Preference array ($R$) by sorting documents descending by $I(d)$.
*   For each engine, creates an Original Ranking array ($E$) based on the engine's initial positions.
*   Calculates rank differences: $\rho = 1 - \frac{6 \sum d^2}{n(n^2 - 1)}$.
*   Upserts the `search_quality_measures` table, calculating the new Exponential Moving Average: `new_avg = old_avg + (rho - old_avg) / newCount`.

---

## 3. Vectorization: `update-learning-index/index.ts`

Manages the semantic embeddings stored in the PostgreSQL database.

### 3.1 Text Chunking
Long web pages exceed the input limits of standard LLM embedding models.
*   **`chunkText(text)`**: If text exceeds 2000 characters, it iterates through the string. It attempts to find sentence boundaries (`. `, `! `, `? `) near the 1500-character mark.
*   It creates a sequence of chunks, strictly enforcing a 200-character overlap between chunks so context isn't lost at the splits.

### 3.2 Embedding Generation and Normalization
*   Dispatches the array of chunks to `generate-embedding`.
*   If multiple vectors are returned, it averages them: `avg[i] += emb[i]` across all dimensions.
*   Applies strict L2 Normalization to the averaged vector: `norm = Math.sqrt(avg.reduce((s, v) => s + v * v, 0))`, dividing every element by the norm.

### 3.3 Score Decay & SQL Upsert
*   Calculates $I(d)$ identically to the SQM function.
*   Queries `feedback_learning_index`. If the URL is already learned, it updates the score using a dynamic learning rate ($\mu = 0.1$): `New = (Old + (Âµ * I(d))) / (1 + (Âµ * I(d)))`.
*   **Ignored Document Penalty**: Iterates over all URLs returned in the search session. If a URL was *not* interacted with, it increments the `ignored_count` and applies exponential decay: `newScore = existing.learned_score * Math.pow(0.9, newIgnoredCount)`.
