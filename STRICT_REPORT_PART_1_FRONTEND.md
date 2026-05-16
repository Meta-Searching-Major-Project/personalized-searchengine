# AMUSE (PersonaSearch): Strict Codebase Report - Part 1: Frontend & UI

*This is Part 1 of an exhaustive, file-by-file technical breakdown of the AMUSE Meta-Search engine. This section focuses strictly on the React/Vite implementation.*

---

## 1. Core Architecture and Contexts

### 1.1 `src/main.tsx` and `src/App.tsx`
The application initializes using standard React 18 `createRoot`. The `<App />` component wraps the entire routing tree in several foundational providers:
*   **Routing**: Uses `BrowserRouter` from `react-router-dom` with routes for `/` (Index), `/settings` (SettingsPage), `/auth` (Auth), and `/analytics` (AnalyticsPage).
*   **State Providers**: Wraps the router in the custom `<AuthProvider>` and the Shadcn `<Toaster />` for global UI notifications.

### 1.2 `src/contexts/AuthContext.tsx`
This file implements a React Context (`AuthContext`) to manage global authentication state via the Supabase Client.
*   **State Variables**: Maintains `user` (Supabase User object or null), `session` (Supabase Session or null), and `loading` (boolean).
*   **Lifecycle**: Mounts a `useEffect` that calls `supabase.auth.getSession()` to read the current token from local storage. It simultaneously attaches an event listener `supabase.auth.onAuthStateChange()`.
*   **Subscription Handling**: If a user logs in via another tab, `onAuthStateChange` captures the `SIGNED_IN` event and updates the context, propagating the new `user` object down the React tree. It explicitly returns a cleanup function `subscription.unsubscribe()` to prevent memory leaks on unmount.

---

## 2. Main Search Interface

### 2.1 `src/pages/Index.tsx`
This is the primary 339-line orchestrator for the search UI.

#### State Management
*   `query`: The raw string inputted by the user in the `<Input />` field.
*   `results`: An array of `ResultWithId` objects containing the merged URLs, titles, and snippets.
*   `engineSummary`: An array of `EngineSummary` showing hit counts and cache status per upstream engine.
*   `queryIntent`: A string (e.g., 'generic', 'coding') returned by the backend Edge Function.
*   `aggregationMethod`: Retrieved dynamically from the user's `profiles` row using a `useEffect` hook.

#### Search Execution (`handleSearch`)
When the `<form>` is submitted, `handleSearch` is invoked:
1.  **Validation**: Trims the query string. If empty, the function aborts.
2.  **State Reset**: Sets `loading` to true, clears `results`, `engineSummary`, and `richBlocks`.
3.  **Cross-Session Telemetry Flush**: If `prevHistoryIdRef.current` exists (meaning the user just finished a previous search), it executes a cleanup sequence:
    *   Issues `window.postMessage({ type: "PERSONASEARCH_FLUSH_DWELL" })` to force the Chrome Extension to dump its current timers into the database immediately.
    *   Initiates an `await Promise.all([ updateLearningIndex(), computeSQM() ])` to calculate the mathematical weights of the *previous* search session before processing the new one.
4.  **API Call**: Executes `await multiSearch(trimmed, aggregationMethod)`. This is a blocking, standard REST/RPC call (not WebSocket streaming).
5.  **Persistence**: For signed-in users, the frontend explicitly manages database history:
    *   Executes `supabase.from("search_history").insert()`.
    *   Executes `supabase.from("search_results").insert(resultRows)` in a massive bulk insert, mapping every aggregated document to the `search_history_id`.
    *   It extracts the newly generated `search_result_id` UUIDs and maps them to the `ResultWithId` objects so the child components know exactly which UUID to track for telemetry.

#### Cleanup Hooks
*   A `useEffect` hook attaches an event listener to `window.addEventListener("beforeunload", handleUnload)`.
*   If the user closes the browser tab entirely, `handleUnload` fires `updateLearningIndex` and `computeSQM` without `await`ing them, relying on browser background execution to finalize the machine learning indexes.

---

## 3. Configuration & UI Components

### 3.1 `src/pages/SettingsPage.tsx`
Provides the UI to interact with the database `profiles` table.
*   **Initialization**: Uses a `useEffect` hooked to `user.id`. Calls `supabase.from("profiles").select(...)` requesting metrics like `weight_v`, `reading_speed`, `default_aggregation_method`, and `preferred_engines`.
*   **Feedback Weights**: Renders seven Shadcn `<Slider>` components. Each maps to a variable like $w_V$ (Click Order), $w_T$ (Dwell Time), and $w_C$ (Copy-Paste). The `onValueChange` event merges the new float value into the local `profile` state object.
*   **Engine Overrides**: Renders an array of 10 `<Checkbox>` components corresponding to engines like Baidu, Naver, Brave, etc.
*   **Commit**: The `<Button onClick={handleSave}>` executes `supabase.from("profiles").update(profile).eq("id", user.id)`, committing the entire JSON object back to PostgreSQL.

### 3.2 `src/components/SearchResultCard.tsx`
Renders an individual search result row and acts as the crucial bridge to the telemetry extension.
*   **Props**: Accepts a `ResultWithId` object containing the `title`, `url`, `snippet`, and an array of `engines` detailing which providers sourced the link.
*   **Extension Activation**: When the user clicks the `<a href={result.url}>`, the `handleLinkClick` callback fires.
    *   It executes a `window.postMessage()` containing the string `"PERSONASEARCH_TRACK_START"`.
    *   It passes the destination `url`, the database `searchResultId`, and the user's `authToken` directly to the extension content script.
*   **Fallback Behaviors**: If the extension is missing, the component relies on native browser events. It attaches a `copy` event listener to the snippet paragraph. It also attaches a `visibilitychange` listener to the document to approximate Dwell Time when the user navigates back to the SERP.

### 3.3 `src/components/EngineStatusBar.tsx`
A purely presentational component that maps over the `EngineSummary` array returned by the Edge Function.
*   Displays the total result count and the backend query resolution time in seconds (`(queryTime / 1000).toFixed(1)s`).
*   Renders a `<Badge>` for the `queryIntent` (e.g., changing text to "ðŸ’» Coding" if `queryIntent === 'coding'`).
*   Maps through each upstream engine. If `e.error` exists, it renders a red `<AlertCircle>`. If `e.cached` is true, it renders a "âš¡" icon indicating the result bypassed SerpAPI and was served from the Supabase edge cache.
