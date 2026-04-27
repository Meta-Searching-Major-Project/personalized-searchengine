/**
 * PersonaSearch Tracker — Background Service Worker v2
 *
 * Tracks dwell time (T) and extended feedback signals for pages
 * opened from PersonaSearch results.
 *
 * Dwell time counted only when:
 *   1. The tracked tab is the active tab in its window
 *   2. The browser window has focus
 *   3. The tab's page is visible (not hidden)
 *
 * Signals tracked per result:
 *   T  = active dwell time (ms)
 *   C  = copy-paste chars
 *   + scroll_depth, highlight_count, hover_time_ms, quick_bounce, repeat_visit
 *
 * Flush strategy:
 *   - Periodic: every 5 seconds for all active tabs
 *   - On tab close / URL change / window blur: immediate flush
 *   - On explicit PERSONASEARCH_FLUSH_DWELL message from web app
 */

// ─── Tracking Entry Structure ────────────────────────────────────────
// {
//   url, searchResultId, windowId,
//   activeStart: number | null,  // when current active period started
//   totalMs: number,             // accumulated active dwell time
//   pageSizeBytes: number,
//   copyPasteChars: number,
//   scrollDepth: number,         // 0.0–1.0
//   highlightCount: number,
//   hoverTimeMs: number,
//   quickBounce: boolean,
//   repeatVisit: boolean,
// }

const trackedTabs = new Map();
let focusedWindowId = chrome.windows.WINDOW_ID_NONE;
let supabaseUrl = "";
let authToken = "";

// ─── Initialization ──────────────────────────────────────────────────

chrome.windows.getLastFocused((win) => {
  if (win?.id) focusedWindowId = win.id;
});

chrome.storage.local.get(["supabaseUrl", "authToken"], (result) => {
  supabaseUrl = result.supabaseUrl || "";
  authToken = result.authToken || "";
});

// ─── Periodic 5-second flush ─────────────────────────────────────────

setInterval(() => {
  for (const [tabId, entry] of trackedTabs) {
    if (entry.activeStart !== null) {
      // Temporarily pause to get accurate totalMs, then resume
      const now = Date.now();
      entry.totalMs += now - entry.activeStart;
      entry.activeStart = now;
      reportCurrentState(tabId);
    }
  }
}, 5000);

// ─── Message Handling ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case "PERSONASEARCH_TRACK_START": {
      const { url, searchResultId, supabaseUrl: sbUrl, authToken: token } = msg;
      console.log(`[PersonaSearch] Tracking requested for: ${url}`, { searchResultId });
      if (sbUrl) { supabaseUrl = sbUrl; chrome.storage.local.set({ supabaseUrl: sbUrl }); }
      if (token) { authToken = token;   chrome.storage.local.set({ authToken: token }); }

      chrome.storage.local.get("pendingTracks", (result) => {
        const pending = result.pendingTracks || {};
        const key = normalizeUrl(url);
        pending[key] = { searchResultId, timestamp: Date.now() };
        chrome.storage.local.set({ pendingTracks: pending });
      });
      sendResponse({ ok: true });
      return true;
    }

    case "PERSONASEARCH_PAGE_INFO": {
      const tabId = sender.tab?.id;
      if (!tabId) break;
      const entry = trackedTabs.get(tabId);
      if (entry) {
        if (msg.pageSizeBytes) entry.pageSizeBytes = msg.pageSizeBytes;
        if (msg.repeatVisit !== undefined) entry.repeatVisit = msg.repeatVisit;
      }
      sendResponse({ ok: true });
      return true;
    }

    case "PERSONASEARCH_STATE_UPDATE": {
      // Periodic or final state update from content script
      const tabId = sender.tab?.id;
      if (!tabId) break;
      const entry = trackedTabs.get(tabId);
      if (entry) {
        if (msg.scrollDepth !== undefined)   entry.scrollDepth    = Math.max(entry.scrollDepth, msg.scrollDepth);
        if (msg.highlightCount !== undefined) entry.highlightCount = Math.max(entry.highlightCount, msg.highlightCount);
        if (msg.hoverTimeMs !== undefined)    entry.hoverTimeMs    = Math.max(entry.hoverTimeMs, msg.hoverTimeMs);
        if (msg.quickBounce !== undefined)    entry.quickBounce    = msg.quickBounce;
        if (msg.repeatVisit !== undefined)    entry.repeatVisit    = msg.repeatVisit;
        if (msg.pageSizeBytes)                entry.pageSizeBytes  = msg.pageSizeBytes;
        if (msg.isFinal) reportCurrentState(tabId);
      }
      sendResponse({ ok: true });
      return true;
    }

    case "PERSONASEARCH_COPY": {
      const tabId = sender.tab?.id;
      if (!tabId) break;
      const entry = trackedTabs.get(tabId);
      if (entry) entry.copyPasteChars += (msg.charCount || 0);
      sendResponse({ ok: true });
      return true;
    }

    case "PERSONASEARCH_FLUSH_DWELL": {
      for (const [id, entry] of trackedTabs) {
        const wasActive = entry.activeStart !== null;
        if (wasActive) pauseTimer(id);
        reportCurrentState(id);
        if (wasActive) entry.activeStart = Date.now();
      }
      sendResponse({ ok: true });
      return true;
    }

    case "PERSONASEARCH_PING":
      sendResponse({ ok: true, version: "2.0.0" });
      return true;

    case "PERSONASEARCH_GET_STATUS":
      sendResponse({ trackedCount: trackedTabs.size, connected: !!authToken });
      return true;
  }
});

// ─── Tab Lifecycle ───────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  const normalizedUrl = normalizeUrl(tab.url);

  // Check if this is a pending tracked URL
  chrome.storage.local.get("pendingTracks", (result) => {
    const pending = result.pendingTracks || {};
    const match = pending[normalizedUrl];
    if (match && Date.now() - match.timestamp < 30000) {
      const isActive = tab.active && tab.windowId === focusedWindowId;
      trackedTabs.set(tabId, {
        url: tab.url,
        searchResultId: match.searchResultId,
        windowId: tab.windowId,
        activeStart: isActive ? Date.now() : null,
        totalMs: 0,
        pageSizeBytes: 0,
        copyPasteChars: 0,
        scrollDepth: 0,
        highlightCount: 0,
        hoverTimeMs: 0,
        quickBounce: false,
        repeatVisit: false,
      });
      delete pending[normalizedUrl];
      chrome.storage.local.set({ pendingTracks: pending });
      // Ask content script for page info
      chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_INFO" }).catch(() => {});
    }
  });

  // If a tracked tab navigated away, finalize it
  const entry = trackedTabs.get(tabId);
  if (entry && normalizeUrl(entry.url) !== normalizedUrl) {
    pauseTimer(tabId);
    reportAndRemove(tabId);
  }
});

// Tab becomes active → resume its timer, pause others in the same window
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  for (const [id, entry] of trackedTabs) {
    if (id !== tabId && entry.windowId === windowId && entry.activeStart !== null) {
      pauseTimer(id);
    }
  }
  const entry = trackedTabs.get(tabId);
  if (entry && windowId === focusedWindowId && entry.activeStart === null) {
    entry.activeStart = Date.now();
  }
});

// Tab closed → final report
chrome.tabs.onRemoved.addListener((tabId) => {
  if (trackedTabs.has(tabId)) {
    pauseTimer(tabId);
    reportAndRemove(tabId);
  }
});

// ─── Window Focus ────────────────────────────────────────────────────

chrome.windows.onFocusChanged.addListener((windowId) => {
  const prev = focusedWindowId;
  focusedWindowId = windowId;

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus — pause ALL tracked tabs
    for (const [id] of trackedTabs) pauseTimer(id);
    return;
  }

  // Pause tabs from previously focused window
  if (prev !== chrome.windows.WINDOW_ID_NONE) {
    for (const [id, entry] of trackedTabs) {
      if (entry.windowId === prev) pauseTimer(id);
    }
  }

  // Resume active tab in newly focused window
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab?.id && trackedTabs.has(activeTab.id)) {
      trackedTabs.get(activeTab.id).activeStart = Date.now();
    }
  });
});

// ─── Timer Helpers ───────────────────────────────────────────────────

function pauseTimer(tabId) {
  const entry = trackedTabs.get(tabId);
  if (entry && entry.activeStart !== null) {
    entry.totalMs += Date.now() - entry.activeStart;
    entry.activeStart = null;
  }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Keep hostname, pathname, and search params (stripping common UTM junk)
    let search = u.search;
    if (search) {
      const params = new URLSearchParams(search);
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach(p => params.delete(p));
      search = params.toString();
      if (search) search = "?" + search;
    }
    const norm = (u.hostname + u.pathname).replace(/\/+$/, "").toLowerCase() + search;
    console.log(`[PersonaSearch] Normalized: ${url} -> ${norm}`);
    return norm;
  } catch {
    return url.replace(/\/+$/, "").toLowerCase();
  }
}

// ─── Report to Supabase ──────────────────────────────────────────────

async function reportCurrentState(tabId) {
  const entry = trackedTabs.get(tabId);
  if (!entry?.searchResultId) return;
  if (entry.totalMs < 1000) return; // < 1s is noise

  if (!supabaseUrl || !authToken) {
    const stored = await chrome.storage.local.get(["supabaseUrl", "authToken"]);
    supabaseUrl = stored.supabaseUrl || "";
    authToken = stored.authToken || "";
  }
  if (!supabaseUrl || !authToken) return;

  try {
    await fetch(`${supabaseUrl}/functions/v1/track-dwell`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        search_result_id: entry.searchResultId,
        dwell_time_ms:    Math.round(entry.totalMs),
        page_size_bytes:  entry.pageSizeBytes,
        copy_paste_chars: entry.copyPasteChars,
        scroll_depth:     entry.scrollDepth,
        highlight_count:  entry.highlightCount,
        hover_time_ms:    entry.hoverTimeMs,
        quick_bounce:     entry.quickBounce,
        repeat_visit:     entry.repeatVisit,
      }),
    });
  } catch (e) {
    console.error("PersonaSearch: report error", e);
  }
}

async function reportAndRemove(tabId) {
  await reportCurrentState(tabId);
  trackedTabs.delete(tabId);
}
