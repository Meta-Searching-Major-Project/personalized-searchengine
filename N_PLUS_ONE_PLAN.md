# N+1 Engine Implementation Plan

The goal is to implement the "Web Search by Feedback Learning" (N+1 Engine) described in the Sufyan architecture. This involves updating the database schema to act as a strict Relevance Matrix, applying exact mathematical updates based on user interaction (or lack thereof), and injecting these learned results back into the multi-search pipeline.

## 1. Establish the Relevance Matrix (Database Schema)

We will update the existing `feedback_learning_index` table to function strictly as the Relevance Matrix ($R$).

### [NEW] Migration: `20260418030000_relevance_matrix.sql`
- Add column `query_normalized` (TEXT) to `feedback_learning_index`.
- Add column `ignored_count` (INT DEFAULT 0) to `feedback_learning_index`.
- Create a unique constraint on `(user_id, query_normalized, url)` to ensure a strict 1:1 mapping between a user's query and a document.
- *Data Migration:* For existing rows, we will backfill `query_normalized` using the first element of `query_matches`, then drop the `query_matches` column as it is no longer needed.

## 2. Implement Feedback Learning Logic (`update-learning-index`)

### [MODIFY] `supabase/functions/update-learning-index/index.ts`
We will rewrite the core logic to apply the exact mathematical models from the paper.

**A. Process Interacted Documents (Clicked/Tracked):**
- Fetch the user's implicit feedback (7-tuple).
- Calculate the Document Importance Weight ($\sigma_j$).
- Apply the exact Relevance Update equation:
  `New Score = (Old Score + (0.1 * sigma_j)) / (1 + (0.1 * sigma_j))`
- Upsert into `feedback_learning_index` using the `(user_id, query_normalized, url)` conflict target. Reset `ignored_count` to 0.

**B. Process Ignored Documents (Penalization):**
- Documents that were returned in the `search_results` for the session but *have no corresponding `user_feedback`* are considered ignored.
- For these documents, increment `ignored_count`.
- Apply an exponential penalty to reduce their `learned_score` (e.g., multiply by `0.9 ^ ignored_count`) so they gradually fade out if consistently ignored. Score bottoms out at 0.

## 3. Inject N+1 Engine into Search Flow (`multi-search`)

### [MODIFY] `supabase/functions/multi-search/index.ts`
Currently, the multi-search function uses vector embeddings to find learned documents. We will update this to query the Relevance Matrix directly by keyword.

- **Query Execution:** Before calling SerpApi, query `feedback_learning_index` for:
  `user_id = authUser.id` AND `query_normalized = current_query` AND `learned_score > 0.2`.
- **Formatting:** Map these results to the `MergedResult` type.
- **Injection:** Push these results into the `engineResults` array as an independent engine source (e.g., `engine: "learned"`).
- **Rank Aggregation:** Because they are formatted identically to SerpApi results, they will automatically flow into the chosen rank aggregation algorithm (Borda, Biased, etc.) alongside Google, Bing, etc.

## Open Questions for Review

1. **Vector Embeddings:** The `feedback_learning_index` currently stores a 768-dimensional `embedding` for semantic search. By moving to a strict `(query, url)` Relevance Matrix, do you want to keep generating embeddings for these documents? I will keep the embedding logic intact for now unless instructed otherwise.
2. **Initial Score:** When a document is interacted with for the very first time (Old Score = 0), the equation gives it a relatively low initial score (~0.1 * sigma_j). Is this intended, or should the first interaction establish a higher baseline?
