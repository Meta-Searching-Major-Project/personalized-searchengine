

# Personalized Web Search System
**Based on: "Web search enhancement by mining user actions" (Beg & Ahmad, 2007)**

## Overview
A personalized meta-search engine that queries multiple search engines in parallel, aggregates results using fuzzy rank aggregation methods, tracks user behavior to build search quality profiles, and improves results over time through feedback learning.

---

## Phase 1: Core Infrastructure & Authentication

### User Authentication & Profiles
- Sign up / login system with Supabase Auth
- User profile creation with customizable feedback weights (wV, wT, wP, wS, wB, wE, wC)
- Default weight values of 1, with user ability to customize based on their habits (e.g., lower wP if no printer)
- User reading speed preference (default: 10 bytes/sec as per paper)

### Database Schema
- **User profiles** table with feedback weight preferences
- **User roles** table (admin, user)
- **Search history** table (queries, timestamps)
- **Search results** table (query → results from each engine)
- **User feedback** table (the 7-tuple: click order V, time T, print P, save S, bookmark B, email E, copy-paste C)
- **Search quality measures (SQM)** table (per-user, per-engine quality scores)
- **Feedback learning index** table (documents learned from user behavior)

---

## Phase 2: Multi-Engine Search & Query Handler

### Query Handler
- Accept user query Q and distribute to N search engines in parallel
- Normalize and deduplicate results across engines

### Search Engine Integration (via Edge Functions)
- **Google Custom Search API** — results from Google
- **Bing Web Search API** — results from Bing  
- **DuckDuckGo** — results via scraping/API proxy
- Each engine returns ranked document lists with title, URL, snippet
- Track which position each document appeared in for each engine

### Search Results Display
- Clean, unified results page showing aggregated ranked results
- Each result shows: title, URL, snippet, source engines, aggregated rank position
- Results are interactive — all 7 feedback signals are tracked

---

## Phase 3: Implicit Feedback Collection (7-Tuple)

### All 7 Signals Tracked Within the App
1. **Click order (V)** — sequence in which user clicks on results
2. **Dwell time (T)** — time spent viewing each document (tracked via page visibility API)
3. **Print (P)** — detect when user prints a document page
4. **Save (S)** — in-app "save for later" button on each result
5. **Bookmark (B)** — in-app bookmark functionality
6. **Email (E)** — in-app "share via email" button
7. **Copy-paste (C)** — detect text selection and copy events, track word count

### Document Importance Weight Calculation
- Compute rⱼ = wV·(2/(vⱼ+1)) + wT·(tⱼ/tⱼ_max) + wP·pⱼ + wS·sⱼ + wB·bⱼ + wE·eⱼ + wC·(cⱼ/cⱼ_total)
- Sort documents by descending rⱼ to get user's "true" preference ranking R

---

## Phase 4: Search Quality Measure (SQM)

### Per-User, Per-Engine Quality Scores
- Compare user preference ranking R against each engine's original ranking q
- Compute Spearman rank-order correlation coefficient (rₛ) between R and q
- Average rₛ over multiple queries = SQM for that engine for that user
- Store and update SQM values in user profile
- Display SQM dashboard showing how well each engine serves the user

---

## Phase 5: Rank Aggregation Methods (All Methods)

### Implemented Algorithms
1. **Borda's Method** — positional scoring baseline
2. **Shimura's Fuzzy Ordering** — fuzzy preference membership functions
3. **Modal Value Method** — equivalent to Borda (for verification)
4. **Membership Function Ordering (MFO)** — Gaussian subnormal membership with modal + spread
5. **Mean-by-Variance (MBV)** — ratio of modal value to variance, ascending sort
6. **OWA-improved Shimura** — replacing min with OWA operator to reduce ties
7. **Biased Rank Aggregation** — weight each engine's contribution by its SQM score

### Comparison Dashboard
- Side-by-side comparison of aggregation methods on same query
- Metrics: Spearman footrule distance, Condorcet compliance, computation time
- Visual charts showing how different methods rank the same documents

---

## Phase 6: Feedback Learning Module

### Web Search by Feedback Learning
- Maintain an internal index of documents learned from user behavior
- Documents consistently preferred by users get improved rankings
- Acts as an (N+1)th search engine alongside the N public engines
- Index R updated after each search session based on user feedback
- Learning improves over time as more feedback accumulates

---

## Phase 7: Dashboard & Analytics

### User Dashboard
- Search history with ability to re-run queries
- Personal SQM scores per engine (visualized as charts)
- Feedback weight configuration panel
- Saved/bookmarked documents library

### Admin Dashboard
- Aggregate SQM statistics across all users
- System-wide search quality trends
- Rank aggregation method performance comparison
- User activity analytics

---

## UI Design

### Search Page
- Clean search bar (Google-style) as the main entry point
- Results page with ranked results, source indicators, and action buttons (save, bookmark, email, print)
- Real-time feedback tracking (unobtrusive to user)

### Settings Page
- Feedback weight sliders (wV through wC)
- Reading speed preference
- Default aggregation method selection

### Analytics Page
- Charts showing SQM per engine over time (using Recharts)
- Aggregation method comparison visualizations
- Search quality improvement trends

