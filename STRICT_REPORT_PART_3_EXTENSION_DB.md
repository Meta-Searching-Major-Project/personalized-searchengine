# AMURA (PersonaSearch): Strict Codebase Report - Part 3: Telemetry Extension & Database

*This is Part 3 of an exhaustive, file-by-file technical breakdown of the AMURA Meta-Search engine. This section focuses strictly on the Manifest V3 Chrome Extension and the PostgreSQL Schema.*

---

## 1. Observer Layer: Chrome Extension

The extension tracks precise user behavior without relying on explicit input, forming the foundation of the implicit feedback loop.

### 1.1 `extension/content.js` (DOM Interaction Script)
This file is injected into the DOM of every website a user visits after clicking a link in the AMURA web interface.
*   **Initialization**: Listens to the global `window` object for a `message` event containing `type: "PERSONASEARCH_TRACK_START"`. It extracts the `searchResultId`, target URL, and Auth Token, forwarding them via `chrome.runtime.sendMessage` to the isolated Background worker.
*   **Scroll Depth Logic (`scroll` listener)**: 
    *   Calculates `Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, document.body.offsetHeight)`.
    *   Determines current depth: `(window.scrollY + window.innerHeight) / totalHeight`.
    *   A local variable `maxScroll` tracks the highest percentage achieved, preventing the score from dropping if the user scrolls back up. It uses `requestAnimationFrame` to debounce the scroll events, protecting the browser's main rendering thread.
*   **Hover and Idle Timer (`mousemove` listener)**:
    *   Every time the mouse moves, a variable `lastMouseMove` is updated to `Date.now()`.
    *   A `setInterval` loop checks if `Date.now() - lastMouseMove > 3000` (3 seconds). If so, the user is flagged as `isIdle = true`.
    *   A separate `setInterval` increments the `hoverTimeMs` counter by 1000 every second, *only* if `isIdle === false`.
*   **Text Interaction**:
    *   A `selectionchange` listener triggers whenever the user highlights text. To avoid firing rapidly while dragging, a 500ms timeout acts as a debouncer before incrementing `highlightCount`.
    *   A `copy` event listener executes `window.getSelection().toString().length` to determine exactly how many characters were captured to the clipboard.

### 1.2 `extension/background.js` (Service Worker State Machine)
The Background script maintains the centralized state of all tracked tabs, solving the "background tab dwell time" flaw of traditional analytics.
*   **URL Normalization (`normalizeUrl`)**: 
    *   Constructs a native `URL` object.
    *   Iterates through the `search` params using `URLSearchParams`.
    *   Aggressively `delete()`s known analytics tags: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `fbclid`, and `gclid`.
    *   It reconstructs the URL without trailing slashes. This ensures that even if a website appends a tracking token upon click, the Extension can still match the URL against the clean version stored in the AMURA database.
*   **Active Tab Enforcement**:
    *   `chrome.windows.onFocusChanged`: If a user minimizes the browser or clicks into another application, `windowId` becomes `WINDOW_ID_NONE`. The script iterates through the `trackedTabs` Map and executes `pauseTimer(id)` on every single tab, stopping all dwell incrementation.
    *   `chrome.tabs.onActivated`: When a user switches tabs within the browser, the script calls `pauseTimer()` on the previously active tab, and initializes `activeStart = Date.now()` on the newly focused tab.
*   **The Heartbeat Mechanism**:
    *   A central `setInterval` runs every 5000 milliseconds.
    *   It iterates through the `trackedTabs` Map.
    *   For every tab where `activeStart !== null` (meaning it is currently visible and focused), it executes `reportCurrentState(tabId)`.
    *   `reportCurrentState` packages `dwell_time_ms`, `scroll_depth`, `hover_time_ms`, and `copy_paste_chars` into a JSON body and executes a `fetch()` POST request to the Supabase `track-dwell` Edge Function, authenticated with the JWT captured during initialization.

---

## 2. Persistence Layer: PostgreSQL Schema

The system relies on a strictly typed relational schema hosted on Supabase, leveraging extensions for vector mathematics.

### 2.1 Core Tables (Defined via SQL Migrations)
*   **`profiles`**: Tied 1:1 with the `auth.users` table.
    *   Contains the user's float weights: `weight_v, weight_t, weight_p, weight_s, weight_b, weight_e, weight_c` (defaults typically set to 1.0 or paper-derived constants).
    *   `reading_speed`: Integer, defaulting to 10 (bytes per second).
    *   `preferred_engines`: A `TEXT[]` array column added in `20260427010000_streaming_upgrade.sql`.
*   **`user_feedback`**: The raw telemetry ledger.
    *   Columns: `dwell_time_ms` (BigInt), `page_size_bytes` (BigInt), `copy_paste_chars` (Integer), `scroll_depth` (Double Precision), `hover_time_ms` (BigInt), `quick_bounce` (Boolean).
*   **`search_sessions`**: The infrastructure for progressive rendering.
    *   Columns: `status` (Text: running, complete, failed), `engine_results` (JSONB mapping engine names to arrays of results), `merged_results` (JSONB). 
    *   *Note: While fully provisioned with Row Level Security (RLS) and Supabase Realtime publication flags, the frontend `Index.tsx` currently utilizes standard HTTP `invoke` commands rather than subscribing to this table's WebSockets.*
*   **`feedback_learning_index`**: The AI knowledge base.
    *   Columns: `learned_score` (Double Precision), `ignored_count` (Integer), `query_matches` (TEXT[]).
    *   `embedding`: A `vector(768)` column provided by the `pgvector` extension.

### 2.2 Security and Access Control (RLS)
Security is pushed to the database layer via PostgreSQL Row Level Security (RLS) policies.
*   **User Isolation**: `CREATE POLICY "Users own sessions" ON public.search_sessions FOR ALL USING (auth.uid() = user_id);`
*   This policy guarantees that the `compute-sqm` and `update-learning-index` background functions, even if somehow manipulated with a stolen JWT, physically cannot `SELECT` or `UPDATE` the telemetry or embeddings belonging to a different user ID, ensuring total privacy of search habits.

### 2.3 Vector Similarity Operations
The schema leverages `pgvector` for Artificial Intelligence indexing.
*   **Index Architecture**: An `HNSW` (Hierarchical Navigable Small World) index is applied to the `embedding` column within `feedback_learning_index`. The operator class is defined as `vector_cosine_ops`.
*   **RPC Execution**: The backend executes the custom PL/pgSQL function `match_learned_documents`. This function executes the raw SQL: `embedding <=> query_embedding`. The `<=>` operator inherently utilizes the HNSW index to calculate Cosine Distance ($1 - Cosine Similarity$) without performing a sequential table scan, returning results to the orchestrator in milliseconds.
