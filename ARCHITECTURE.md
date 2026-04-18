# PersonaSearch — Architecture & File Guide

A personalized meta-search engine that queries multiple search engines in parallel via SerpApi, aggregates results with fuzzy rank-aggregation algorithms, learns from user behavior, and serves rich answer widgets (weather, dictionary, images, knowledge graph, answer box).

---

## Tech stack
- **Frontend**: React 18 + Vite + TypeScript + Tailwind + shadcn/ui
- **Routing**: React Router
- **State**: React Query + local React state
- **Backend (Lovable Cloud)**: Supabase Postgres + Auth + Edge Functions (Deno)
- **Search provider**: SerpApi (Google, Bing, DuckDuckGo, Yahoo, Yandex, Baidu, Naver, Brave, Google Scholar, Google News)
- **Embeddings / AI**: Google Generative Language API (gemini-embedding-001, 768-dim vectors via MRL)

---

## Top-level files

| File | Purpose |
|---|---|
| `index.html` | HTML shell — `<head>` SEO tags + `<div id="root">` mount point |
| `vite.config.ts` | Vite bundler config, dev server, path aliases (`@/` → `src/`) |
| `tailwind.config.ts` | Tailwind theme — semantic color tokens, fonts, animations |
| `postcss.config.js` | PostCSS pipeline (Tailwind + Autoprefixer) |
| `tsconfig*.json` | TypeScript compiler options |
| `eslint.config.js` | Linter rules |
| `components.json` | shadcn/ui generator config |
| `package.json` | Dependencies + npm scripts |
| `vitest.config.ts` | Unit-test runner config |
| `README.md` | Project quick-start |
| `.env` | Auto-generated Supabase URL/anon key (DO NOT EDIT) |

---

## `src/` — Frontend application

### `src/main.tsx`
React entry point — renders `<App />` into `#root`.

### `src/App.tsx`
Top-level component. Sets up:
- `QueryClientProvider` (React Query)
- `TooltipProvider`, toast renderers
- `BrowserRouter` + route table
- `AuthProvider` wrapper

### `src/App.css`, `src/index.css`
- `index.css` — global Tailwind layer + **HSL design tokens** (`--background`, `--primary`, etc.). All theming lives here.
- `App.css` — minor app-level overrides.

### `src/vite-env.d.ts`
TypeScript ambient types for Vite env vars.

---

### `src/pages/` — Route components

| File | Route | Description |
|---|---|---|
| `Index.tsx` | `/` | Main search page. Handles guest + signed-in users, calls `multi-search`, renders `RichWidgets` + `SearchResultCard` list, persists history for signed-in users. |
| `Auth.tsx` | `/auth` | Sign-up / sign-in form (email + Google OAuth). |
| `SettingsPage.tsx` | `/settings` | Lets signed-in users tune feedback weights (wV…wC), reading speed, default aggregation method. |
| `AnalyticsPage.tsx` | `/analytics` | Charts of per-engine SQM scores, search history, ability to re-run queries. |
| `NotFound.tsx` | `*` | 404 page. |

---

### `src/components/` — Reusable UI

| File | Description |
|---|---|
| `AppHeader.tsx` | Top nav bar — logo, links to Settings/Analytics, sign-in/out button. |
| `EngineStatusBar.tsx` | Below the search box: shows result count, query time, aggregation method badge, and per-engine status pill (✅/❌, count, cached?). |
| `RichWidgets.tsx` | **NEW** — renders SerpApi answer blocks: Weather card, Dictionary entry, Images carousel, Knowledge Graph card, Answer Box. Shown above the result list. |
| `SearchResultCard.tsx` | One result row — title, URL, snippet, source-engine badges, action buttons (save, bookmark, email, print), tracks dwell time + copy events. |
| `NavLink.tsx` | Header link styling helper. |
| `ProtectedRoute.tsx` | Redirects to `/auth` if user not signed in. Wraps Settings + Analytics. |
| `ui/*` | shadcn/ui primitives (Button, Card, Input, Dialog, …). Generated — usually don't edit directly. |

---

### `src/contexts/`

| File | Description |
|---|---|
| `AuthContext.tsx` | Wraps Supabase auth — exposes `user`, `session`, `signOut()`. Listens to `onAuthStateChange`. |

---

### `src/hooks/`

| File | Description |
|---|---|
| `useFeedbackTracker.ts` | Tracks the 7-tuple per result: click order (V), dwell time (T), print (P), save (S), bookmark (B), email (E), copy-paste (C). Persists each signal to `user_feedback`. |
| `use-mobile.tsx` | Returns `true` if viewport < md breakpoint. |
| `use-toast.ts` | Re-export of shadcn toast hook. |

---

### `src/lib/`

| File | Description |
|---|---|
| `lib/utils.ts` | `cn()` helper — merges Tailwind classes. |
| `lib/api/search.ts` | TypeScript client for `multi-search` edge function. Defines `MergedResult`, `EngineSummary`, `RichBlocks`, `SearchResponse`. |
| `lib/api/learningIndex.ts` | Calls `update-learning-index` and `compute-sqm` edge functions after each search session. |

---

### `src/integrations/supabase/`
**DO NOT EDIT — auto-generated.**

| File | Description |
|---|---|
| `client.ts` | Pre-configured Supabase JS client — import via `import { supabase } from "@/integrations/supabase/client"`. |
| `types.ts` | TypeScript types generated from the live database schema. |

### `src/test/`
- `setup.ts` — Vitest global setup.
- `example.test.ts` — Sample test.

---

## `supabase/` — Backend

### `supabase/config.toml`
Project ID + per-function settings (`verify_jwt`). Auto-managed.

### `supabase/migrations/`
**Read-only.** Append-only SQL history of every schema change. Created by the migration tool.

### `supabase/functions/` — Edge Functions (Deno)

| Function | Description |
|---|---|
| `multi-search/index.ts` | **The core**. Accepts `{ query, aggregation_method }`. For each of 10 web engines: checks `search_cache` (7-day TTL); on miss, calls SerpApi and upserts cache. Extracts rich blocks. For signed-in users, embeds the query and pulls personalized docs. Queries the local `web_pages` index (if ≥100 crawled pages) as an additional engine. Deduplicates, runs rank aggregation, returns results. After responding, **fire-and-forget queues** all result URLs into `crawl_queue` and triggers `crawl-page`. |
| `generate-embedding/index.ts` | Calls Google Generative Language API (gemini-embedding-001) → returns 768-dim embedding for arbitrary text. Supports `task_type` (RETRIEVAL_QUERY / RETRIEVAL_DOCUMENT) and exponential backoff retry. |
| `update-learning-index/index.ts` | After a search session, computes per-document importance score `r_j` from the 7-tuple feedback, then upserts into `feedback_learning_index` using exponential moving average (α=0.3). Chunks long texts (>2000 chars) before embedding. |
| `compute-sqm/index.ts` | Computes Spearman rank-order correlation between user's preference ranking R and each engine's original ranking q. Updates `search_quality_measures` with running average. |
| **`crawl-page/index.ts`** | **NEW** — Processes the `crawl_queue`: fetches pages (10s timeout, browser UA), extracts clean text (strips HTML/scripts/styles), computes SHA-256 content hash for dedup, generates 768-dim embeddings, upserts into `web_pages`. Processes batches of 5–10 URLs with politeness delays. |
| **`search-local-index/index.ts`** | **NEW** — Hybrid search over the local `web_pages` index. Embeds the query, runs vector similarity (60%) + full-text tsvector search (40%), returns results in SerpResult format. |

---

## Database tables (public schema)

| Table | Purpose |
|---|---|
| `profiles` | Per-user feedback weights (wV…wC), reading speed, default aggregation method. |
| `user_roles` | Role assignments (`admin` / `user`) — used by `has_role()` SQL function for RLS. |
| `search_history` | One row per search query a signed-in user makes. |
| `search_results` | Raw per-engine result rows for each `search_history` entry — the source-of-truth for feedback joins. |
| `user_feedback` | The 7-tuple recorded per `search_result_id`: click_order, dwell_time_ms, printed, saved, bookmarked, emailed, copy_paste_chars. |
| `search_quality_measures` | Per-user, per-engine SQM score (rolling Spearman ρ) + query count. |
| `feedback_learning_index` | The "world wide web index built from your behavior" — URL + title + snippet + 768-dim embedding + learned_score + matching queries. Acts as the (N+1)-th search engine. |
| `search_cache` | Global shared cache of raw SerpApi results per (query, engine). 7-day TTL. Indexed on `query_normalized`. |
| **`web_pages`** | **NEW** — The local web index. Stores URL, domain, extracted text, meta description, content hash (SHA-256 dedup), 768-dim embedding, tsvector (full-text), word count, crawl metadata. HNSW + GIN indexed. Grows with every search as URLs are crawled. |
| **`crawl_queue`** | **NEW** — Lightweight job queue for pages to crawl. URLs are inserted by `multi-search` after each search, processed by `crawl-page`. Tracks priority (more engines = higher), attempt count, and status. |

### Database functions
- `has_role(user_id, role)` — security-definer role check, used in RLS policies.
- `match_learned_documents(query_embedding, user_id, threshold, count)` — vector cosine search over `feedback_learning_index`.
- `search_local_index(query_embedding, query_text, match_count)` — hybrid vector + full-text search over `web_pages`.
- `handle_new_user()` — trigger that creates a `profiles` + `user_roles` row when a new auth user signs up.
- `update_updated_at_column()` — generic timestamp trigger.
- `web_pages_tsv_trigger()` — auto-updates tsvector column on `web_pages` insert/update.

### RLS posture
- `search_history`, `user_feedback`, `feedback_learning_index`, `search_quality_measures`, `profiles`, `user_roles` → users see their own rows; admins see all.
- `search_results` → users see rows linked to their own `search_history`.
- `search_cache`, `web_pages` → readable by anyone (shared resources); writes locked to service role.
- `crawl_queue` → service role only (no client-side access).

---

## Request flow (one search)

```
User types query in Index.tsx
        │
        ▼
multiSearch(query, method)  (src/lib/api/search.ts)
        │
        ▼
Edge function: multi-search
        │
        ├─► For each of 6 engines:
        │       ├─ check search_cache (Postgres, indexed)
        │       │     ├─ HIT  → use cached organic_results + rich_blocks
        │       │     └─ MISS → fetch SerpApi → upsert cache
        │       └─ extract rich blocks (weather/dict/images/KG/answer box)
        │
        ├─► (if signed in) embed query → match_learned_documents()
        │       → adds personalized "learned" engine
        │
        ├─► dedupe by URL
        ├─► aggregate (Borda / Shimura / … / Biased)
        │
        ▼
Response { merged, richBlocks, engineResults }
        │
        ▼
Index.tsx
        ├─► RichWidgets renders weather/dictionary/images/KG/answer
        ├─► SearchResultCard list renders ranked results
        └─► (signed-in) writes search_history + search_results
                Then useFeedbackTracker collects the 7-tuple
                On next search → updateLearningIndex + computeSQM
```

---

## How to extend

- **Add another search engine**: add an `EngineConfig` entry to the `WEB_ENGINES` array in `multi-search/index.ts` with optional `queryParam`, `extraParams`, `resultsKey`, and `parseResult` fields. SerpApi engine names: `youtube`, `google_shopping`, `ecosia` (mirrors Bing), etc.
- **Add a new rich widget**: add the field in `extractRichBlocks()` in the edge function + update `RichBlocks` type in `src/lib/api/search.ts` + add a renderer in `src/components/RichWidgets.tsx`.
- **Add a new aggregation method**: add a function in `multi-search/index.ts` and a case in `rankResults()` + label in `src/components/EngineStatusBar.tsx`.
- **Tune cache TTL**: change `CACHE_TTL_MS` in `multi-search/index.ts` (currently 7 days).
- **Theme colors**: edit HSL tokens in `src/index.css`.
