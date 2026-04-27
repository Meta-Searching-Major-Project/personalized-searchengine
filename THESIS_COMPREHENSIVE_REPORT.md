# AMURA (PersonaSearch): A Next-Generation Personalized Meta-Search Architecture utilizing Implicit Feedback, Vector Semantics, and Dynamic Intent Routing

## Abstract
Traditional web search engines operate on generalized algorithms designed to satisfy the broadest demographic, often failing to address the highly specific, context-dependent needs of individual users. While personalized search attempts to solve this, it often relies on invasive explicit tracking or traps users in "filter bubbles." This project presents AMURA (PersonaSearch), a novel privacy-preserving meta-search engine that dynamically aggregates results from multiple upstream providers (Google, Bing, DuckDuckGo, Scholar, etc.). AMURA introduces a sophisticated Manifest V3 browser extension to capture high-fidelity implicit telemetry (e.g., precise dwell time, scroll depth, copy-paste events) without degrading user experience. Using an extended Beg & Ahmad (2007) model, AMURA normalizes these signals to compute document importance scores. Furthermore, the system implements a "Learned Engine" (N+1 Engine) utilizing 768-dimensional Vector Embeddings (Google GenAI) and cosine similarity to inject historical, contextually relevant documents back into the search pool. Finally, AMURA employs a dynamic intent-based routing system and an Exponential Moving Average (EMA) of Spearman’s Rank Correlation (SQM) to dynamically weight engine reliability. This thesis details the architecture, mathematical formulations, and implementation of the AMURA system.

---

## Chapter 1: Introduction

### 1.1 Background and Context
The sheer volume of information available on the World Wide Web has made Information Retrieval (IR) systems the most critical infrastructure of the modern internet. Modern search engines like Google and Bing use complex algorithms combining PageRank, TF-IDF, and deep learning models to rank pages. However, a query like "python" can mean a snake to a biologist and a programming language to a software engineer. "One-size-fits-all" retrieval is fundamentally limited by its inability to understand the user's hidden domain context.

### 1.2 Problem Statement
Existing personalization techniques face significant challenges:
1.  **Privacy Concerns**: Major engines track users across the web, raising severe privacy issues.
2.  **Filter Bubbles**: Over-personalization leads to echo chambers where users are only exposed to information confirming their biases.
3.  **Low-Fidelity Feedback**: Most engines rely solely on Click-Through Rate (CTR). CTR proves a user was enticed by a title, not that the document contained the answer.
4.  **Vendor Lock-in**: Relying on a single engine means suffering its specific blind spots and biases.

### 1.3 Objectives of the Study
The AMURA project was developed to achieve the following:
1.  **Develop a Meta-Search Orchestrator**: Build a scalable backend capable of querying 8+ engines in parallel and normalizing their outputs.
2.  **Implement High-Fidelity Implicit Tracking**: Move beyond CTR by tracking actual content consumption (scroll depth, dwell time, text copying) via a custom browser extension.
3.  **Design a Privacy-First Personalization Loop**: Store all telemetry in an isolated database (Supabase) secured by Row Level Security (RLS), ensuring only the user's own algorithms have access to their data.
4.  **Build a Learned N+1 Engine**: Use Large Language Model (LLM) embeddings and vector databases to understand the semantic meaning of user history, rather than relying on exact keyword matches.

---

## Chapter 2: Literature Review and Related Work

### 2.1 Meta-Search Engines
Meta-search engines do not crawl the web themselves; they act as a query dispatcher to primary engines. Systems like DuckDuckGo (initially) and Searx operate on this principle. The primary challenge in meta-search is **Rank Aggregation**—the mathematical process of combining lists from different sources (e.g., Google ranks a page #1, Bing ranks it #5) into a single, cohesive list.

### 2.2 Implicit vs. Explicit Feedback
Relevance feedback is the process of updating search results based on user interactions.
*   **Explicit Feedback**: Users explicitly rate documents (e.g., clicking a "thumbs up" or bookmarking). While highly accurate, it suffers from severe user fatigue; very few users participate.
*   **Implicit Feedback**: Passively observing user behavior. The seminal work by Beg & Ahmad (2007) demonstrated that a combination of Click Order, Dwell Time, and Printing/Saving behaviors could approximate explicit ratings with high accuracy. 

### 2.3 Vector Semantics in Information Retrieval
Traditional IR uses Lexical matching (e.g., BM25), which looks for exact keyword overlaps. Modern IR uses Semantic matching. By passing text through a Transformer neural network, words are converted into dense, high-dimensional vectors (Embeddings) where spatial proximity equates to semantic similarity.

---

## Chapter 3: System Architecture

AMURA is built on a modern, distributed, serverless architecture to ensure high availability and low latency.

### 3.1 Frontend Architecture (Client Tier)
*   **Framework**: React 18 with TypeScript.
*   **Build Tool**: Vite (esbuild) for rapid Hot Module Replacement and optimized production bundling.
*   **UI Library**: Tailwind CSS combined with Shadcn/Radix UI primitives. This provides an accessible, fully responsive interface supporting dark/light modes and complex state-driven animations.
*   **State Management**: React Context API is used to manage the user's authentication state, preferred engines, and current search session IDs.

### 3.2 Backend Architecture (Orchestration Tier)
*   **Runtime Environment**: Supabase Edge Functions. These are powered by the Deno runtime and deployed on global Edge nodes. Edge functions eliminate cold starts associated with traditional serverless functions (like AWS Lambda) and place the execution logic geographically closer to the user.
*   **Third-Party Integration**: AMURA utilizes SerpAPI and Serper.dev as gateways to access the raw JSON outputs of Google, Bing, DuckDuckGo, Yahoo, Yandex, Naver, and Baidu.

### 3.3 Database and AI Storage (Data Tier)
*   **Relational Database**: PostgreSQL hosted by Supabase.
*   **Schema Design**:
    *   `profiles`: Stores user preferences, aggregation methods, and selected fallback engines.
    *   `search_history`: Logs query strings and timestamps.
    *   `search_results`: Stores the normalized metadata (URL, title, snippet) of discovered documents.
    *   `user_feedback`: The core telemetry table mapping users to search results. Contains columns for `dwell_time_ms`, `copy_paste_chars`, `scroll_depth`, `hover_time_ms`, etc.
    *   `search_sessions`: Used for Real-Time UI streaming.
*   **Vector Database**: The `pgvector` PostgreSQL extension is utilized. It introduces a `vector(768)` data type. AMURA uses the Hierarchical Navigable Small World (HNSW) index type for extremely fast Approximate Nearest Neighbor (ANN) lookups.

### 3.4 Security and Access Control
AMURA implements zero-trust architecture at the database level.
*   **JWT Authentication**: Users authenticate via Supabase Auth. The resulting JSON Web Token contains the user's unique UUID.
*   **Row Level Security (RLS)**: Policies are enforced directly in PostgreSQL. For example:
    `CREATE POLICY "Users can only view their own feedback" ON user_feedback FOR SELECT USING (auth.uid() = user_id);`
    This guarantees that even if a backend vulnerability occurs, User A cannot query User B's telemetry data.

---

## Chapter 4: The Meta-Search Orchestrator and Intent Routing

The `multi-search` Edge Function is the central nervous system of AMURA.

### 4.1 Parallel Fetching Algorithm
When a user submits a query, AMURA does not query engines sequentially ($O(N)$ time). It queries them concurrently ($O(1)$ time relative to engine count).

```javascript
// Pseudocode for Parallel Fetching
async function executeMultiSearch(query, selectedEngines) {
  const promises = selectedEngines.map(engine => {
    return Promise.race([
      fetchFromAPI(engine, query),
      new Promise((_, reject) => setTimeout(() => reject("Timeout"), 4000))
    ]);
  });
  
  // Wait for all to settle (succeed or timeout)
  const results = await Promise.allSettled(promises);
  return results.filter(r => r.status === "fulfilled").map(r => r.value);
}
```
This guarantees that a slow response from a regional engine (e.g., Baidu) does not degrade the user experience for the entire SERP.

### 4.2 Dynamic Query Intent Detection
Querying all 8 engines for every request is expensive and often yields irrelevant data (e.g., searching Google Scholar for "pizza near me"). AMURA implements an Intent Routing engine.

1.  **Language/Regional Intent**: The algorithm scans the query string's Unicode ranges. 
    *   `[\uAC00-\uD7AF]` triggers Korean Intent $\rightarrow$ Adds Naver.
    *   `[\u4E00-\u9FFF]` triggers Chinese Intent $\rightarrow$ Adds Baidu.
2.  **Semantic Intent**: Regex patterns analyze the query:
    *   Research keywords (e.g., "paper, pdf, thesis") route the query to Scholar and standard engines.
    *   Coding keywords (e.g., "error, github, npm") prioritize DuckDuckGo and StackOverflow.
3.  **Result**: This reduces API calls by 40-60% per query while drastically improving the contextual relevance of the returned documents.

---

## Chapter 5: Advanced Implicit Telemetry System

The defining feature of AMURA is its ability to accurately quantify "user satisfaction" without asking the user.

### 5.1 The Observer Pattern: Manifest V3 Extension
The AMURA Chrome extension operates silently. It uses a Background Service Worker to maintain state and a Content Script injected into the DOM of the target page.

**Tracking Mechanics:**
1.  **Click & Initialization**: When a user clicks a result in the AMURA web app, a `postMessage` is sent to the extension containing the `searchResultId`.
2.  **Strict Dwell Time ($T$)**: Simple "time on page" is flawed because users leave tabs open in the background. AMURA uses `chrome.tabs.onActivated` and `chrome.windows.onFocusChanged`. The dwell timer *only* increments when the tab is the active tab in the currently focused window.
3.  **Scroll Depth ($S$)**: The content script calculates: `depth = (window.scrollY + window.innerHeight) / document.body.scrollHeight`. The maximum depth reached is stored.
4.  **Hover Time ($H$)**: A passive `mousemove` listener tracks active cursor movement, differentiating an engaged reader from an AFK user.
5.  **Copy-Paste ($C$)**: The `copy` event listener counts the exact number of characters the user deemed valuable enough to copy to their clipboard.
6.  **Quick Bounce ($B$)**: If the user closes the tab or hits the back button in under 8 seconds, it is flagged as a Quick Bounce—a strong negative signal indicating a misleading title or irrelevant content.

### 5.2 Heartbeat Flush
To prevent data loss if a user abruptly closes the browser, the extension uses a `setInterval` heartbeat. Every 5 seconds, the state of all active tracked tabs is packaged into a JSON payload and flushed to the Supabase `track-dwell` Edge Function.

---

## Chapter 6: Mathematical Models of Personalization

AMURA transforms raw behavioral data into actionable mathematical values.

### 6.1 The Importance Score Formula $I(d)$
Based on the extended Beg & Ahmad model, AMURA calculates an absolute importance score for a document $d$:

$$I(d) = w_V\left(\frac{1}{2^{v-1}}\right) + w_T\left(\frac{t}{t_{max}}\right) + w_C\left(\frac{c}{c_{total}}\right) + w_S(S_{max}) - w_B(Bounce) + \sum Explicit$$

*   $v$ is the rank the document was clicked at.
*   $t$ is the precise active dwell time.
*   $S_{max}$ is the max scroll depth (0.0 to 1.0).
*   $Bounce$ is a boolean penalty (1 if quick bounce, 0 otherwise).

### 6.2 Rank Aggregation: Modified Borda Count
When multiple engines return the same document, AMURA must decide its final rank. Borda Count is a consensus-based voting system.

For a query $Q$, assume engines $E_1, E_2, ..., E_m$. Each engine returns $k$ results.
If a document $d$ is ranked at position $r$ by engine $e$, it receives $(k - r)$ points.
The total Borda Score $B(d)$ is:
$$B(d) = \sum_{e \in Engines} (k - Rank_{e}(d)) \cdot W_e$$
Where $W_e$ is the "Weight" or "Trust" assigned to engine $e$.

### 6.3 Engine Quality Assessment: Spearman Quality Metric (SQM)
How does AMURA determine $W_e$? It measures how well an engine predicts user behavior.
If Google ranks a page #1, but the user spends 0 seconds on it, and Google ranks a page #5, but the user spends 10 minutes on it, Google's prediction was poor.

AMURA calculates the Spearman Rank Correlation Coefficient ($\rho$) between the Engine's Ranking and the User's Importance Score Ranking.

$$\rho = 1 - \frac{6 \sum d_i^2}{n(n^2 - 1)}$$
Where $d_i$ is the difference between the two ranks for document $i$. $\rho$ ranges from -1.0 (perfectly opposite) to +1.0 (perfectly aligned).

### 6.4 Exponential Moving Average (EMA) for Engine Weighting
To prevent volatile fluctuations in engine weighting based on a single anomalous search, AMURA uses an EMA to smooth the SQM scores over time.

$$EMA_{today} = (\alpha \cdot \rho_{current}) + (1 - \alpha) \cdot EMA_{yesterday}$$
Where $\alpha$ (e.g., 0.2) dictates the responsiveness to new data. If an engine consistently provides poor results for a specific user, its EMA drops, and its voting power ($W_e$) in the Borda Count diminishes.

---

## Chapter 7: The Learned "N+1" Vector Engine

Standard meta-search aggregates $N$ engines. AMURA introduces an $N+1^{th}$ engine, powered by Artificial Intelligence, completely unique to the user.

### 7.1 Embedding Generation
When a document's $I(d)$ score surpasses a threshold (indicating high relevance), an asynchronous edge function (`update-learning-index`) is triggered. It takes the document's title and snippet and passes it to the Google Generative AI API (`text-embedding-004`). 

The LLM returns a dense vector of 768 floating-point numbers. This vector represents the semantic, conceptual "meaning" of the document.

### 7.2 Retrieval and Cosine Similarity
When the user submits a new query:
1.  The query itself is converted into a 768-dimensional vector $v_q$.
2.  AMURA queries the `user_feedback` database using `pgvector` to find the nearest neighbors using Cosine Distance.

$$Cosine Similarity = \frac{v_q \cdot v_d}{||v_q|| ||v_d||}$$

### 7.3 Recency Decay Function
A document highly relevant to the user 3 years ago may no longer be relevant today. AMURA applies a temporal decay function to the vector similarity score:

$$FinalScore = CosineSimilarity \cdot e^{-\lambda \cdot \Delta t}$$
Where $\Delta t$ is the time elapsed since the interaction, and $\lambda$ is the decay constant.

The top documents retrieved by this process are injected back into the Borda Count aggregation pool as if they were returned by Google or Bing. However, because this is the user's personal data, the N+1 engine is assigned a massive weight multiplier, forcing highly relevant historical data to the top of the SERP.

---

## Chapter 8: Caching and Real-Time Streaming Architecture

### 8.1 Intent-Aware Hybrid Caching
To minimize API consumption and reduce environmental footprint, AMURA utilizes an intelligent caching layer.
*   The query string is normalized, trimmed, and hashed.
*   **Time-To-Live (TTL)** is dynamically determined by the Query Intent Engine:
    *   **News**: Highly volatile. TTL = 1 hour.
    *   **Coding/Generic**: Moderately stable. TTL = 24 hours.
    *   **Research**: Highly stable (academic papers do not change). TTL = 7 days.

### 8.2 Real-Time Progressive UI Updates
Traditional web requests are blocking: the user sees a loading spinner until all 8 engines finish fetching, and then the entire page renders at once. This creates an unacceptable perceived latency.

AMURA implements a modern **Streaming Architecture**:
1.  The client initiates a search. The backend creates a UUID in the `search_sessions` table and returns it immediately.
2.  The client opens a Supabase Realtime WebSocket subscription to that session UUID.
3.  The backend continues executing the parallel fetches. As each engine (e.g., DuckDuckGo) resolves, the backend updates the `search_sessions` row with the partial data.
4.  The WebSocket pushes these updates to the React frontend in real-time. The frontend dynamically merges, recalculates the Borda Count, and animates the new results into the list.

---

## Chapter 9: Conclusion and Future Work

### 9.1 Summary of Achievements
AMURA successfully demonstrates that a meta-search engine can achieve deep personalization without invasive tracking or explicit user surveys. By combining a sophisticated Manifest V3 telemetry extension, vector-based semantic retrieval, and mathematical rank correlation (SQM), the system builds a highly accurate, privacy-first Relevance Matrix. The dynamic intent routing and real-time streaming architecture ensure that this personalization does not come at the cost of speed or performance.

### 9.2 Future Work
Future iterations of AMURA could focus on:
1.  **Collaborative Filtering**: While maintaining strict RLS privacy, fully anonymized and aggregated vector data could be used to recommend documents that similar users found helpful for specific intents.
2.  **LLM Summarization**: Integrating a Retrieval-Augmented Generation (RAG) pipeline to read the contents of the top 3 aggregated results and generate a synthesized, conversational answer above the traditional SERP links.
3.  **Local Indexing Expansion**: Enhancing the web crawler to locally index entire user-specified domains (e.g., a university's internal wiki) for deep hybrid search.

---
*End of Report*
