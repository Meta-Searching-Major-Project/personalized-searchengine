# PersonaSearch (AMURA): Deep Dive into System Architecture and Implementation Details

*This document provides an exhaustive, granular breakdown of the architectural decisions, structural flow, and precise technical implementation of the AMURA Meta-Search ecosystem. It is intended to be used as a source document for generating highly technical academic thesis chapters regarding system design and software engineering.*

---

## 1. High-Level Architectural Paradigm

The AMURA system is built on a decoupled, serverless micro-architecture. It abandons the traditional monolithic backend (e.g., a single Express.js server) in favor of distributed Edge Computing. The system is conceptually divided into four distinct planes:
1.  **The Client Presentation Plane**: A React-based Single Page Application (SPA) responsible for rendering the UI and handling user interaction.
2.  **The Telemetry Observation Plane**: A Manifest V3 Google Chrome Extension that injects content scripts into third-party web pages to track implicit user feedback passively.
3.  **The Orchestration & Edge Execution Plane**: A suite of Supabase Edge Functions (running on the Deno V8 isolate runtime) that act as the middle-tier orchestrators. These functions handle the heavy lifting of meta-search parallel dispatch, data normalization, and rank aggregation mathematics.
4.  **The Persistence & AI Plane**: A PostgreSQL database (hosted via Supabase) that acts as the source of truth for user profiles, search session states, raw telemetry logs, and dense vector embeddings (via `pgvector`).

This architecture was chosen to maximize horizontal scalability, minimize global latency (via edge execution), and maintain strict security boundaries between the presentation layer and the machine learning logic.

---

## 2. Frontend Implementation (Client Presentation Plane)

The frontend is constructed using React 18, bootstrapped with Vite, and written entirely in strict TypeScript. 

### 2.1 State Management and Progressive Rendering
Unlike traditional search engines that block the UI until all results are fetched, AMURA implements a progressive, real-time rendering strategy.
*   **The Session Paradigm**: When a user submits a query, the frontend does not directly await an HTTP array of results. Instead, it sends an initiation request to the backend, which immediately returns a `search_session_id` (a UUID).
*   **Supabase Realtime WebSockets**: The React frontend uses the Supabase Client SDK to open a WebSocket connection and subscribe to changes exclusively on that specific `search_session_id` row in the database.
*   **Progressive Hydration**: As the Edge Functions resolve individual upstream engines (e.g., DuckDuckGo finishes in 200ms, Google finishes in 400ms, Baidu finishes in 1200ms), the database row is updated. The WebSocket pushes this delta to the React client.
*   **Dynamic Re-calculation**: A custom React Hook (`useSearchStream`) listens to these WebSocket events. Upon receiving a new payload, it immediately recalculates the Borda Count (or chosen aggregation method) and updates the local React state. This causes the UI to animate and reorder the search results in real-time as data streams in, achieving sub-200ms perceived latency.

### 2.2 Component Architecture and Styling
*   **Tailwind CSS & Shadcn UI**: The project utilizes Tailwind CSS for utility-first, atomic CSS styling, ensuring a minimal footprint and no CSS specificity clashes. Complex interactive elements (Dropdowns, Dialogs, Sliders) are built using Shadcn UI, which provides unstyled, accessible Radix primitives wrapped in Tailwind classes.
*   **Modular Rendering**: The SERP (Search Engine Results Page) is broken down into highly specialized components. The `SearchResultCard` component handles the rendering of the title, URL snippet, and dynamically generated engine badges (showing which engine proposed the link and at what rank). It also embeds micro-interactions (Save, Bookmark, Email) that directly call the feedback tracking hooks.

---

## 3. The Meta-Search Orchestrator (Edge Execution Plane)

The core logic resides in a Deno Edge Function named `multi-search/index.ts`. This function is responsible for the entire retrieval lifecycle.

### 3.1 Dynamic Query Intent Routing
To optimize the monetary cost of API calls and improve result relevance, the orchestrator implements an Intent Detection algorithm before any network requests are dispatched.
*   **Lexical Analysis**: The query string is normalized (lowercased, trimmed).
*   **Regional Detection**: The system uses Unicode block scanning. For example, the regex `[\uAC00-\uD7AF]` checks for Hangul (Korean characters). If true, the system dynamically injects the `Naver` search engine into the routing pool. Cyrillic characters inject `Yandex`, and Hanzi injects `Baidu`.
*   **Semantic Intent Mapping**: Keyword matching categorizes the query. A query containing "paper" or "dataset" is tagged as `research`, overriding the default engine list to specifically include `google_scholar`. A query with "bug" or "github" is tagged `coding`, prioritizing DuckDuckGo.
*   **Manual Overrides**: The function checks the user's `profiles` table. If the user has manually defined an array of `preferred_engines` via the Settings UI, the dynamic intent routing is bypassed entirely, enforcing strict user control.

### 3.2 Concurrent Network Dispatch and Fault Tolerance
AMURA must query up to 8 separate external APIs (via Serper.dev and SerpAPI) simultaneously. Sequential fetching would result in catastrophic latency ($O(N)$ time complexity).
*   **Promise.allSettled**: The orchestrator maps the selected engine configurations into an array of asynchronous fetch Promises. It uses `Promise.allSettled` to execute them concurrently ($O(1)$ time complexity relative to the number of engines).
*   **Timeout Enclosures**: To prevent a single slow API from halting the entire pipeline, each fetch Promise is wrapped in a `Promise.race` against a strict `setTimeout` function (typically 4000ms). If the API fails to respond within the window, the race resolves to an error state, and the orchestrator simply drops that engine from the current search cycle, maintaining high availability.

### 3.3 Data Normalization and Deduplication
Different search engines return drastically different JSON schemas. The orchestrator maps every response into a standardized `SerpResult` interface.
*   **Deduplication Logic**: A Map data structure is used to deduplicate results. The URL of each result is passed through a normalizer that strips trailing slashes, converts to lowercase, and removes common tracking parameters (UTM tags). 
*   **Reference Counting**: If DuckDuckGo and Google both return the same Wikipedia article, the article is stored once in the Map, but an array of `engines` attached to that document is appended to include both Google (rank X) and DuckDuckGo (rank Y). This mapping is crucial for the mathematical rank aggregation phase.

### 3.4 Mathematical Rank Aggregation Implementation
The orchestrator supports multiple mathematical models for combining the disparate rankings.
*   **Borda Count Method**: The system iterates through the deduplicated documents. For each document, it checks which engines proposed it. If the maximum depth fetched across all engines is $k$ (e.g., 20), and engine $E$ ranked the document at position $r$, the document receives a score of $(k + 1 - r)$. The scores across all engines are summed. The documents are then sorted descending by this total score.
*   **Biased Aggregation (SQM Weighting)**: In this advanced mode, the Borda score from each engine is multiplied by a floating-point weight. This weight is retrieved from the `search_quality_measures` database table, representing the Exponential Moving Average (EMA) of that engine's historical Spearman's Rank Correlation Coefficient ($\rho$) for the specific user.

---

## 4. The Telemetry Observer (Chrome Extension Implementation)

The implicit feedback loop is powered by a Manifest V3 Chrome Extension. It is engineered to capture high-resolution behavioral data without impacting the browser's main thread performance.

### 4.1 Message Passing Bridge
When a user clicks a link in the AMURA web app, the React frontend cannot know what happens after the user leaves the site. It bridges this gap by sending a `postMessage` to the `window` object. The extension's content script intercepts this `PERSONASEARCH_TRACK_START` message, capturing the target URL, the unique `searchResultId`, and the user's JWT Auth Token. It forwards this payload to the extension's isolated Background Service Worker.

### 4.2 High-Fidelity Signal Tracking (Content Script)
The content script (`content.js`) is injected into the third-party website (e.g., the Wikipedia page the user clicked).
*   **Scroll Depth Tracking**: A `scroll` event listener calculates the viewport position relative to the `document.body.scrollHeight`. It maintains a `maxScroll` variable (a float between 0.0 and 1.0). To avoid performance bottlenecks, this listener is debounced using `requestAnimationFrame`.
*   **Highlight & Copy Tracking**: A `selectionchange` listener tracks how many times the user highlights text. A `copy` event listener intercepts clipboard actions, calculating the exact `length` of the copied string.
*   **Hover Time**: A passive `mousemove` listener resets an idle timer. If the mouse does not move for 3 seconds, the user is considered "idle," and the hover timer pauses. This distinguishes between active reading and a user simply leaving a tab open while away from the keyboard.

### 4.3 Dwell Time Precision and The Heartbeat Flush (Background Worker)
Standard "time on page" analytics are heavily skewed by background tabs. AMURA's Background Worker (`background.js`) solves this using Chrome's native APIs.
*   **Visibility State**: It listens to `chrome.tabs.onActivated` (when the user switches tabs) and `chrome.windows.onFocusChanged` (when the user switches applications). The Dwell Timer ($T$) *only* increments when the target tab is the currently active tab in the currently focused window.
*   **Heartbeat Synchronization**: Manifest V3 restricts background execution time. To guarantee data survival, the worker uses a `setInterval` loop to perform a "Heartbeat Flush" every 5 seconds. It packages the current metrics (Scroll, Dwell, Copy, Hover) into a JSON payload and executes a `fetch` POST request to the Supabase `track-dwell` Edge Function, authenticating via the JWT captured during the initial click.

---

## 5. Persistence, AI, and The Learned Engine (Database Plane)

The Supabase PostgreSQL database serves as the analytical engine of the system.

### 5.1 Database Schema and Trigger Logic
*   `user_feedback`: This table acts as the raw ledger. It logs the 7-tuple metrics (V, T, P, S, B, E, C) alongside the new high-fidelity signals.
*   **Postgres Triggers**: When a row in `user_feedback` is updated (e.g., via the 5-second extension heartbeat), a PostgreSQL Trigger automatically invokes a PL/pgSQL function. This function recalculates the normalized Importance Score $I(d)$ for the document dynamically.

### 5.2 Vector Embeddings and `pgvector`
AMURA implements semantic understanding using Artificial Intelligence.
*   When a document's Importance Score $I(d)$ exceeds a defined threshold, a background process is dispatched. It invokes the Google Generative AI API (`text-embedding-004` model) to generate a dense, 768-dimensional floating-point array (a Vector Embedding) representing the semantic meaning of the document's title and snippet.
*   This array is stored in a `vector(768)` column in the database, indexed using an HNSW (Hierarchical Navigable Small World) graph algorithm to enable millisecond-level similarity searches across millions of rows.

### 5.3 The N+1 Learned Engine Integration
The true innovation of AMURA's implementation is how it handles the "Learned Engine" during the `multi-search` orchestration phase.
1.  **Query Embedding**: When the user searches, the `multi-search` function first asks the LLM to embed the query itself into a 768-dimensional vector.
2.  **Cosine Similarity Retrieval**: The function executes an RPC (Remote Procedure Call) to the database, invoking a custom SQL function `match_learned_documents`. This function performs a mathematical Cosine Distance operation (`<=>`) between the Query Vector and the User's historical Document Vectors stored in the `feedback_learning_index`.
3.  **Recency Decay Matrix**: The SQL function applies a temporal decay. If a document was highly relevant 3 years ago, its similarity score is mathematically penalized compared to a document interacted with yesterday.
4.  **SERP Injection**: The resulting semantically matched documents are injected directly into the `multi-search` engine array as an artificial, personalized "$N+1$" engine. The rank aggregation algorithm processes these results identically to results from Google or Bing, but assigns them a massively inflated SQM multiplier. This mathematically guarantees that highly relevant, semantically linked historical documents automatically surface at the very top of the user's aggregated search results.
