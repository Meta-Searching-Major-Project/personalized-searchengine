# AMURA (PersonaSearch): Strict Codebase Architecture & Implementation Report

*This document provides an exhaustive, granular, file-by-file technical breakdown of the AMURA Meta-Search engine. It is strictly grounded in the exact source code implemented in the repository, documenting the precise functions, mathematical formulas, hooks, and SQL triggers currently in production.*

---

## 1. Frontend Web Application (React & Vite)

The frontend is a Single Page Application (SPA) built with React 18, Vite, and TypeScript. It utilizes Tailwind CSS for styling and Shadcn UI primitives. Data fetching is performed via standard REST API wrapper functions against Supabase Edge Functions.

### 1.1 Core Pages and Routing

#### `src/pages/Index.tsx` (Main Interface & Orchestrator)
This is the primary entry point for the application. It handles user input, local state, and the core search lifecycle.
*   **State Hooks**: Maintains state for `query` (user input), `loading` (boolean), `results` (an array of `ResultWithId` interfaces), `engineSummary` (metadata on engine performance), `richBlocks` (knowledge graph data), and `queryIntent` (string flag like 'coding' or 'research').
*   **Search Execution (`handleSearch`)**: 
    1. Trims the input and blocks empty queries.
    2. If a signed-in user is initiating a new search, it first flushes any pending telemetry from the previous search by sending a `window.postMessage({ type: "PERSONASEARCH_FLUSH_DWELL" })` to the Chrome Extension. 
    3. It triggers `updateLearningIndex` and `computeSQM` asynchronously for the *previous* session.
    4. It invokes the `multiSearch` wrapper.
    5. Upon receiving the JSON response, it updates the UI state.
    6. For signed-in users, it persists the search context by executing a `.insert()` to the `search_history` table (retrieving a history UUID), followed by a bulk `.insert()` of all returned documents into the `search_results` table to generate unique `search_result_id` UUIDs for telemetry tracking.
*   **Cleanup Phase**: Uses a `useEffect` hook bound to `window.addEventListener("beforeunload")` to trigger a final index update (via a `sendBeacon` fallback) if the user closes the browser tab.

#### `src/pages/SettingsPage.tsx` (User Configuration Interface)
Provides the interface for adjusting database-stored profile preferences.
*   **Database Interaction**: Mounts a `useEffect` to `.select()` the user's row from the `profiles` table. Updates are saved via a `.update()` query on the `profiles` table.
*   **Configurable Parameters**:
    *   **Feedback Weights**: Seven distinct `<Slider>` components for weights ($w_V, w_T, w_P, w_S, w_B, w_E, w_C$) ranging from 0.0 to 2.0 with 0.1 step increments.
    *   **Reading Speed**: Adjusts `reading_speed` (bytes/sec), used by the backend to normalize dwell time relative to page length.
    *   **Aggregation Method**: A `<Select>` dropdown to choose between `borda`, `shimura`, `modal`, `mfo`, `mbv`, `owa`, and `biased`.
    *   **Preferred Engines**: A grid of `<Checkbox>` components mapping over `AVAILABLE_ENGINES`. This modifies a `string[]` stored in the `preferred_engines` column. If this array is non-empty, the backend skips dynamic intent routing and strictly queries only these engines.

### 1.2 Core Components

#### `src/components/SearchResultCard.tsx` (Result Rendering & Telemetry Bridge)
This component renders an individual search result and acts as the bridge to the Chrome Extension.
*   **Fallback Copy Tracking**: Implements a `useEffect` with an `addEventListener("copy")` bound to the snippet paragraph. It uses `window.getSelection().toString().length` to calculate copied characters and reports it via the fallback hook.
*   **Link Click Handling (`handleLinkClick`)**: 
    1. Triggers `feedback.trackClick` to record the position the document was clicked at.
    2. Crucially, it sends a `window.postMessage({ type: "PERSONASEARCH_TRACK_START", url, searchResultId, ... })` down to the injected content script to initialize high-fidelity Chrome tab tracking.
    3. **Fallback Dwell Tracking**: If the extension is not installed, it attaches a `visibilitychange` event listener to the document to approximate return-time.
*   **Explicit Action Buttons**: Renders specific `<Button>` components for Save, Bookmark, Email, and Print. Clicking these immediately triggers a `toast` and executes the corresponding `feedback.trackX()` explicit signal.

### 1.3 Custom Hooks and API Wrappers

#### `src/hooks/useFeedbackTracker.ts` (Telemetry Manager)
*   Provides functions (`trackSave`, `trackBookmark`, etc.) that execute `.update()` statements on the `user_feedback` table.
*   Calculates relative click order by maintaining a session-level counter.

#### `src/lib/api/search.ts` (Search Gateway)
*   Defines strict TypeScript interfaces (`MergedResult`, `EngineSummary`, `SearchResponse`).
*   The `multiSearch()` function is a wrapper that executes `supabase.functions.invoke("multi-search", { body: { query, aggregation_method, preferred_engines } })`.

---

## 2. Orchestration & Retrieval Layer (Supabase Edge Functions)

The primary search logic runs on Deno V8 isolate instances within the Supabase Edge network.

### 2.1 `supabase/functions/multi-search/index.ts` (The Retrieval Engine)

#### 2.1.1 Query Intent & Engine Selection
*   **`detectQueryIntent(query)`**: 
    *   Checks Unicode code blocks: `[\uAC00-\uD7AF]` for Korean (returns `regionalEngine: "naver"`), `[\u4E00-\u9FFF]` for Chinese (returns `baidu`), and `[\u0400-\u04FF]` for Cyrillic (returns `yandex`).
    *   Uses Regex matching: `\b(error|bug|github|code|npm)\b` triggers `coding` intent. `\b(today|latest|breaking|news)\b` triggers `news` intent.
*   **`selectEnginesForIntent()`**: If `preferred_engines` is populated from the user's profile, it maps only those engines. Otherwise, it maps the detected intent to predefined engine arrays (e.g., generic = `["google", "bing", "duckduckgo", "yahoo", "yandex"]`).

#### 2.1.2 Parallel Fetching and Caching
*   **Cache Check**: Queries `search_cache` table. If a match is found and `Date.now() - fetched_at < CACHE_TTL_MS` (7 days), it returns cached data immediately.
*   **Concurrent API Dispatch**: Uses `Promise.allSettled()` to fetch from `serpapi.com`. 
*   **Pagination Scaling**: For major engines (Google, Bing, Yahoo), it pushes multiple fetch promises to the array to retrieve pages 1 and 2 simultaneously (e.g., `start: 10` for Google, `first: 11` for Bing) to ensure enough depth for accurate rank aggregation.
*   **Schema Normalization**: Passes raw JSON through specialized parsers (`parseBrave`, `parseScholar`, `parseStandard`) to extract `position`, `title`, `link`, and `snippet`. It hard-caps results to 20 per engine.

#### 2.1.3 Deduplication & Mathematical Aggregation
*   **`deduplicateResults()`**: Iterates through all flat results. The URL is cleaned (lowercase, trailing slash removed) and used as a Map key. For identical URLs, the `{ engine, rank }` is appended to a tracking array.
*   **`aggregateBorda()`**: Classic Borda count. Points are awarded based on `(maxRank + 1) - rank`. 
*   **`aggregateMBV()`**: Mean-By-Variance ordering. Formula: `(maxRank + 1 - mean) + 0.5 * Math.sqrt(1 / variance)`. This positively scores documents with low variance (high consensus among engines).
*   **`aggregateBiased()`**: Reads `sqm_score` from the `search_quality_measures` table. Borda points are multiplied by the SQM weight.

#### 2.1.4 The N+1 Learned Engine Integration
If the user is authenticated:
1.  Executes a `fetch` POST to `/functions/v1/generate-embedding` with the raw search query.
2.  Passes the returned 768-dimension vector to PostgreSQL via `serviceClient.rpc("match_learned_documents")`.
3.  The database calculates Cosine Distance. Results scoring `> 0.05` are returned.
4.  The script blends the semantic similarity score with the historical `learned_score` and injects these documents into the `engineResults` array. 

---

## 3. Telemetry Observer Layer (Chrome Extension)

The extension tracks precise user behavior to construct the Relevance Matrix.

### 3.1 `extension/content.js` (DOM Monitor)
*   **Initialization**: Listens for the `PERSONASEARCH_TRACK_START` message from the window.
*   **Scroll Tracking**: Attaches a `scroll` event. Calculates `(window.scrollY + window.innerHeight) / document.body.scrollHeight`. Emits the maximum depth reached (0.0 to 1.0).
*   **Hover/Idle Tracking**: Tracks `mousemove`. If the mouse is stationary for 3000ms, it pauses the hover timer.
*   **Selection & Clipboard**: Tracks `selectionchange` to count highlights. Tracks `copy` events to sum the exact number of characters saved to the clipboard.
*   **Transmission**: Uses `chrome.runtime.sendMessage` to forward this data to the background worker.

### 3.2 `extension/background.js` (Service Worker)
*   **Tab State Management**: Listens to `chrome.tabs.onActivated` and `chrome.windows.onFocusChanged`. Dwell time metrics are strictly paused unless `tab.active === true` and `window.focused === true`.
*   **URL Normalization**: `normalizeUrl()` aggressively removes analytics parameters (`utm_`, `fbclid`, `ref_src`) to ensure the extension's tracked URL perfectly matches the clean URL stored in the Supabase database.
*   **Heartbeat Flush**: Implements a `setInterval` loop executing every 5000ms. It iterates through the `trackedTabs` Map and executes a `fetch` POST to the Supabase `track-dwell` function, passing the accumulated `dwell_time_ms`, `scroll_depth`, and `copy_paste_chars`.

---

## 4. Machine Learning & Metric Computation Layer

The system mathematically processes the telemetry into usable ranking weights.

### 4.1 `supabase/functions/track-dwell/index.ts` (Ingestion)
*   Verifies JWT validity directly against the `/auth/v1/user` REST endpoint.
*   Extracts signals. If a `user_feedback` row already exists for the `search_result_id`, it executes an `.update()`. It applies `Math.max()` to `dwell_time_ms` and `scroll_depth` to prevent data regression.

### 4.2 `supabase/functions/compute-sqm/index.ts` (Spearman Rank Calculator)
Calculates engine reliability based on Beg & Ahmad (2007).
1.  **Importance Scoring**: For every document clicked in a session, it calculates $I(d) = w_V \cdot \frac{1}{2^{v-1}} + w_T \cdot \frac{t}{t_{max}} + w_C \cdot \frac{c}{c_{total}} + \sum Explicit$.
2.  **Normalization Variables**: $t_{max}$ is derived by dividing the `page_size_bytes` by the user's profile `reading_speed`. $c_{total}$ is the sum of all copied characters across the entire session.
3.  **Spearman Calculation**: It sorts the documents by $I(d)$ to create the User Preference Ranking ($R$). It then compares this against each engine's Original Ranking ($E$) using $\rho = 1 - \frac{6 \sum d^2}{n(n^2 - 1)}$.
4.  **Exponential Moving Average**: It updates the `search_quality_measures` table. The new SQM score is calculated as a running average: `new_avg = old_avg + (rho - old_avg) / newCount`.

### 4.3 `supabase/functions/update-learning-index/index.ts` (Vector Generation)
Responsible for maintaining the N+1 learned database.
*   **Importance Threshold**: It calculates the Importance Score $I(d)$ identical to `compute-sqm`. If $I(d) > 0$, the document qualifies for the learning index.
*   **Chunking Strategy**: To avoid context limits, `chunkText()` splits texts longer than 2000 characters into 1500-character segments with 200-character overlaps.
*   **Vectorization**: It POSTs the text to `/functions/v1/generate-embedding`. If chunked, it averages the resulting vectors and normalizes them via L2 Normalization (`norm = Math.sqrt(avg.reduce((s, v) => s + v * v, 0))`).
*   **Score Decay & Update**: It queries `feedback_learning_index`. If the document exists, the new `learned_score` is updated using the mathematical formula: `New = (Old + (µ * I(d))) / (1 + (µ * I(d)))` where $\mu = 0.1$.
*   **Ignored Document Penalty**: For documents returned in the SERP but *not* clicked, it applies an exponential decay penalty: `learned_score = learned_score * Math.pow(0.9, ignored_count)`.

---

## 5. PostgreSQL Database Schema & Triggers

### 5.1 Tables and RLS Policies
*   **`profiles`**: Contains weights ($w_V, w_T...$), `reading_speed`, `preferred_engines`.
*   **`search_sessions`**: Created for real-time progressive rendering capabilities. Contains `all_engines`, `completed_engines`, and `engine_results`. 
*   **`search_history`**: Logs the exact `query` and generates the UUID connecting a session.
*   **`search_results`**: Stores the output of the orchestrator. Maps `url` to `original_rank` and `aggregated_rank`.
*   **`user_feedback`**: The raw ledger. Contains columns for `dwell_time_ms`, `copy_paste_chars`, `scroll_depth`, `hover_time_ms`, `quick_bounce`.
*   **`feedback_learning_index`**: Stores the learned metadata, `learned_score`, `ignored_count`, and the `vector(768)` embedding.

**Row Level Security (RLS)** is strictly enforced. Policies map `auth.uid() = user_id`, guaranteeing that background workers and client queries cannot cross-pollinate telemetry or SQM scores between users.

### 5.2 AI Similarity Matching (RPC)
The `match_learned_documents` PostgreSQL function utilizes `pgvector`. It executes a `SELECT` statement mapping the `embedding <=> query_embedding` (Cosine Distance). It filters out vectors with similarity lower than the `match_threshold` (e.g., 0.75) and returns the combined scalar similarities directly to the Deno edge orchestrator.
