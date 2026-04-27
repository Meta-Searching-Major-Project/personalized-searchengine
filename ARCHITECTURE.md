# PersonaSearch — Comprehensive Architecture & Documentation

PersonaSearch is a personalized meta-search engine that queries multiple search engines in parallel, aggregates their results, learns from user behavior to personalize future searches, and builds a local web index.

This document serves as the definitive guide to the system's architecture, components, workflows, logic, and interactions.

## 1. System Overview & Technology Stack

The system is composed of three main parts:
1. **Frontend Web App**: Provides the search interface, user authentication, and settings.
2. **Browser Extension**: Silently tracks user interaction with search results (dwell time, copy-pasting) to provide implicit feedback.
3. **Backend & Database**: Hosted on Supabase, handling search aggregation, ranking, machine learning (personalization), indexing, and user data storage.

### Tech Stack
- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui, React Router, React Query.
- **Backend (Lovable Cloud)**: Supabase PostgreSQL, Supabase Auth, Deno Edge Functions.
- **Search Provider**: SerpApi (Google, Bing, DuckDuckGo, Yahoo, Yandex, Baidu, Naver, Brave, Google Scholar, Google News).
- **AI & Embeddings**: Google Generative Language API (`gemini-embedding-001`, 768-dimensional vectors) for semantic search.

---

## 2. Core Workflows & Data Flow

### 2.1 The Search Request Flow

When a user submits a search query, the following steps occur:

1. **Query Submission**: The frontend (`Index.tsx`) calls the `multi-search` edge function via `src/lib/api/search.ts`.
2. **Parallel Fetching**: The `multi-search` function queries all configured web engines via SerpApi.
   - It checks the `search_cache` table first (7-day TTL).
   - If a cache miss occurs, it fetches from SerpApi, extracts organic results and "Rich Blocks" (Weather, Dictionary, etc.), and upserts the cache.
3. **Local Index Search**: If the local `web_pages` index has ≥100 crawled pages, a hybrid search (vector + full-text) is performed on it.
4. **Personalized "Learned" Engine (N+1)**: If the user is signed in:
   - The query is embedded using `generate-embedding`.
   - The system queries the `feedback_learning_index` using a vector similarity search (`match_learned_documents` RPC) to find highly relevant documents from past interactions.
   - These results act as an additional search engine.
5. **Deduplication & Aggregation**:
   - Results are grouped by normalized URL.
   - A chosen rank aggregation algorithm (e.g., Borda, Shimura, Biased) merges the rankings into a final sorted list.
6. **Background Crawling Queue**: The unique URLs from the search results are asynchronously inserted into the `crawl_queue` table.
7. **Response to Client**: The aggregated results and Rich Blocks are returned to the frontend and rendered.
8. **Telemetry Recording**: The frontend writes the search query to `search_history` and the returned results to `search_results`.

### 2.2 Implicit Feedback Tracking (The 7-Tuple)

PersonaSearch learns from user interactions using a 7-tuple signal (V, T, P, S, B, E, C):

1. **V (Click Order)**: Tracked by the frontend when a user clicks a result.
2. **T (Dwell Time)**: Tracked by the browser extension. The background service worker measures active tab time and normalizes it against the page size and user's reading speed.
3. **P (Printed), S (Saved), B (Bookmarked), E (Emailed)**: Tracked by frontend buttons on each `SearchResultCard`.
4. **C (Copy-Paste)**: Tracked by the browser extension content script, counting characters copied from the result page.

All these signals are synced to the `user_feedback` table.

### 2.3 Post-Session Learning & Optimization

After a search session, two background edge functions run to update the system:

1. **`update-learning-index`**:
   - Computes a document importance score ($I(d)$) based on the 7-tuple.
   - Fetches an embedding for the document's content.
   - Upserts the document into `feedback_learning_index` using an exponential moving average to update its `learned_score`.
   - Penalizes ignored documents using an exponential decay factor.
2. **`compute-sqm`**:
   - Calculates the Search Quality Measure (SQM) for each engine using Spearman rank-order correlation between the engine's original ranking and the user's implicit preference ranking.
   - Updates the `search_quality_measures` table with a running average of the engine's performance.

### 2.4 Background Crawling

1. The `multi-search` function adds URLs to `crawl_queue`.
2. The `crawl-page` edge function processes this queue:
   - Fetches the HTML.
   - Extracts clean text (strips scripts/styles).
   - Generates an embedding for the content.
   - Upserts the data into the `web_pages` table, computing a SHA-256 hash for deduplication.
   - Updates the `crawl_queue` status.

---

## 3. Component Breakdown

### 3.1 Frontend (`src/`)

- **Pages (`src/pages/`)**:
  - `Index.tsx`: The main search interface. Handles queries, renders widgets and results.
  - `Auth.tsx`: Handles user authentication via Supabase Auth.
  - `SettingsPage.tsx`: Allows users to configure feedback weights ($w_V \dots w_C$), reading speed, and the default rank aggregation method.
  - `AnalyticsPage.tsx`: Displays charts of SQM scores, search history, and feedback metrics.
- **Components (`src/components/`)**:
  - `RichWidgets.tsx`: Renders SerpApi answer blocks (Weather, Dictionary, Knowledge Graph, etc.).
  - `SearchResultCard.tsx`: Displays individual search results with action buttons (Save, Bookmark, etc.) and tracks interactions.
  - `EngineStatusBar.tsx`: Shows statistics on which engines contributed to the results.
- **Hooks (`src/hooks/`)**:
  - `useFeedbackTracker.ts`: Central logic for recording user interactions and syncing them to `user_feedback`.
- **API Clients (`src/lib/api/`)**:
  - `search.ts`: Calls the `multi-search` endpoint.
  - `learningIndex.ts`: Triggers the post-session optimization functions.

### 3.2 Browser Extension (`extension/`)

- **`manifest.json`**: Chrome extension manifest (MV3).
- **`background.js` (Service Worker)**:
  - Manages active tab state and window focus.
  - Accurately tracks active dwell time.
  - Periodically flushes dwell time data to the `track-dwell` edge function.
- **`content.js`**:
  - Injected into all web pages.
  - Estimates page size (in bytes) to normalize dwell time.
  - Listens to `copy` events and reports copied character counts to the background script.

### 3.3 Backend Edge Functions (`supabase/functions/`)

- **`multi-search`**: The central orchestrator. Queries SerpApi, local index, and learning index. Performs rank aggregation. Queues URLs for crawling.
- **`update-learning-index`**: Processes session feedback to update `feedback_learning_index`. Chunks long text (>2000 chars) before embedding.
- **`compute-sqm`**: Calculates the Spearman correlation between engine rankings and user preference, updating `search_quality_measures`.
- **`crawl-page`**: Background worker that fetches URLs, extracts text, generates embeddings, and populates the local `web_pages` index.
- **`search-local-index`**: Performs hybrid search (vector similarity + full-text) on the `web_pages` table.
- **`generate-embedding`**: Wraps the Google Generative Language API to convert text into 768-dim vectors.
- **`track-dwell`**: Endpoint used by the browser extension to report dwell time and copy-paste events directly to the database.

---

## 4. Database Schema

### 4.1 Tables

| Table | Description |
|-------|-------------|
| `profiles` | Stores user settings: feedback weights, reading speed, and default aggregation method. |
| `user_roles` | Manages role assignments (e.g., `admin`, `user`) for Row Level Security (RLS). |
| `search_history` | Logs every search query executed by signed-in users. |
| `search_results` | Stores the raw results returned by each engine for a specific `search_history` entry. Acts as the foreign key target for feedback. |
| `user_feedback` | Stores the 7-tuple telemetry for a specific `search_result_id`. |
| `search_quality_measures` | Tracks the SQM score (rolling Spearman $\rho$) per user and per engine. |
| `feedback_learning_index` | The personalized index. Stores URL, text, embedding, and `learned_score` for interacted documents. |
| `search_cache` | Global cache for SerpApi results to reduce API costs. (7-day TTL). |
| `web_pages` | The local web index. Stores crawled text, full-text `tsvector`, and vector embeddings for hybrid search. |
| `crawl_queue` | Queue for background crawling jobs. Prioritized by how many engines returned the URL. |

### 4.2 Key PostgreSQL Functions

- `match_learned_documents(query_embedding, user_id, threshold, count)`: Performs cosine similarity search over `feedback_learning_index`.
- `search_local_index(query_embedding, query_text, match_count)`: Hybrid search over `web_pages` combining pgvector and `tsvector` scores.

### 4.3 Row Level Security (RLS)

- Personal data (`search_history`, `user_feedback`, `profiles`, `search_quality_measures`, `feedback_learning_index`) is strictly isolated. Users can only read/write their own rows.
- Global resources (`search_cache`, `web_pages`) are publicly readable but only writable by the service role.
- Internal mechanics (`crawl_queue`) are completely restricted to the service role.

---

## 5. Core Algorithms

### 5.1 Rank Aggregation Algorithms
PersonaSearch supports multiple methods to merge rankings from different engines:
1. **Borda Count**: Assigns points based on rank. The "learned" engine receives a massive 5x weight multiplier.
2. **Shimura (Fuzzy Majority)**: Uses fuzzy logic to evaluate how often document A beats document B across all engines.
3. **Modal Rank**: Ranks based on the most frequent rank position a document receives.
4. **MFO (Maximum Fuzzy Optimistic)**: Considers the highest rank a document achieved across any engine.
5. **MBV (Mean-Variance)**: Rewards documents with low average rank and low variance (consistency across engines).
6. **OWA (Ordered Weighted Averaging)**: Applies specialized weighting vectors to ranked preferences.
7. **Biased (SQM-weighted Borda)**: Borda count, but each engine's points are multiplied by its historical SQM score for that specific user.

### 5.2 Document Importance ($I(d)$)
Based on Beg & Ahmad (2007), calculated in `update-learning-index`:
$I(d) = w_V \cdot V + w_T \cdot T + w_P \cdot P + w_S \cdot S + w_B \cdot B + w_E \cdot E + w_C \cdot C$

Where:
- $V = 1 / 2^{(click\_order - 1)}$
- $T = \min(dwell\_time / max\_expected\_time, 1.0)$
- $C = copied\_chars / total\_copied\_in\_session$
- Others are binary (0 or 1).
- $w_V$ is strictly enforced as 1.0.

---

## 6. Extending the System

- **Adding a New Search Engine**: Update the `WEB_ENGINES` array in `supabase/functions/multi-search/index.ts`. Add a custom parser if the SerpApi output format is unique.
- **Adding a Rich Widget**: Update `extractRichBlocks()` in the edge function, define types in `src/lib/api/search.ts`, and create the React UI in `src/components/RichWidgets.tsx`.
- **Modifying Aggregation**: Add a new function in `multi-search/index.ts`, update `rankResults()`, and add the new option to the frontend `SettingsPage.tsx` and `EngineStatusBar.tsx`.
