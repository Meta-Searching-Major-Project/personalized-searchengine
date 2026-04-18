/**
 * PersonaSearch Tracker — Background Service Worker
 *
 * Tracks dwell time (T) and copy-paste (C) for pages opened from PersonaSearch.
 * Uses chrome.tabs API to accurately measure active viewing time.
 *
 * Dwell time is only accumulated when:
 *   1. The tracked tab is the active tab in its window
 *   2. The browser window is focused (not minimized/behind other apps)
 *
 * Per the paper: T = t_j / t_j_max where t_j_max = page_size_bytes / reading_speed
 */

// Map<tabId, TrackingEntry>
const trackedTabs = new Map();

// Currently focused window ID (-1 = none)
let focusedWindowId = chrome.windows.WINDOW_ID_NONE;

// Supabase config (set by web app when user signs in)
let supabaseUrl = "";
let authToken = "";

// ─── Tracking Entry Structure ──────────────────────────────────────
// {
//   url: string,
//   searchResultId: string,
//   activeStart: number | null,   // timestamp when timer started (null = paused)
//   totalMs: number,              // accumulated active dwell time
//   pageSizeBytes: number,        // page content size for T normalization
//   copyPasteChars: number,       // total characters copied from this page
//   windowId: number,             // which window this tab belongs to
// }

// ─── Message Handling ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PERSONASEARCH_TRACK_START") {
    // Web app tells us to start tracking a URL
    const { url, searchResultId, supabaseUrl: sbUrl, authToken: token } = msg;
    supabaseUrl = sbUrl;
    authToken = token;

    // Store in chrome.storage for persistence across service worker restarts
    chrome.storage.local.set({ supabaseUrl: sbUrl, authToken: token });

    // Find the tab that will open this URL (it opens in a new tab)
    // We'll match it when the tab finishes loading
    chrome.storage.local.get("pendingTracks", (result) => {
      const pending = result.pendingTracks || {};
      const normalizedUrl = normalizeUrl(url);
      pending[normalizedUrl] = { searchResultId, timestamp: Date.now() };
      chrome.storage.local.set({ pendingTracks: pending });
    });

    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "PERSONASEARCH_PAGE_INFO") {
    // Content script reports page size and confirms URL
    const tabId = sender.tab?.id;
    if (!tabId) return;

    const entry = trackedTabs.get(tabId);
    if (entry) {
      entry.pageSizeBytes = msg.pageSizeBytes || 0;
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "PERSONASEARCH_COPY") {
    // Content script reports a copy event
    const tabId = sender.tab?.id;
    if (!tabId) return;

    const entry = trackedTabs.get(tabId);
    if (entry) {
      entry.copyPasteChars += (msg.charCount || 0);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "PERSONASEARCH_PING") {
    sendResponse({ ok: true, version: "1.0.0" });
    return true;
  }

  if (msg.type === "PERSONASEARCH_GET_STATUS") {
    sendResponse({
      trackedCount: trackedTabs.size,
      connected: !!authToken,
    });
    return true;
  }

  if (msg.type === "PERSONASEARCH_FLUSH_DWELL") {
    // Pause all timers temporarily to ensure totalMs is accurate
    for (const [id, entry] of trackedTabs) {
      const wasActive = entry.activeStart !== null;
      if (wasActive) pauseTimer(id);
      reportCurrentState(id);
      if (wasActive) entry.activeStart = Date.now(); // resume
    }
    sendResponse({ ok: true });
    return true;
  }
});

// ─── Tab Events ────────────────────────────────────────────────────

// When a tab finishes loading, check if it matches a pending track
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  const normalizedUrl = normalizeUrl(tab.url);

  // Check if this is a URL we should track
  chrome.storage.local.get("pendingTracks", (result) => {
    const pending = result.pendingTracks || {};
    const match = pending[normalizedUrl];

    if (match && Date.now() - match.timestamp < 30000) {
      // Start tracking this tab
      const isActive = tab.active && tab.windowId === focusedWindowId;
      trackedTabs.set(tabId, {
        url: tab.url,
        searchResultId: match.searchResultId,
        activeStart: isActive ? Date.now() : null,
        totalMs: 0,
        pageSizeBytes: 0,
        copyPasteChars: 0,
        windowId: tab.windowId,
      });

      // Remove from pending
      delete pending[normalizedUrl];
      chrome.storage.local.set({ pendingTracks: pending });

      // Ask content script for page size
      chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_INFO" }).catch(() => {});
    }
  });

  // If a tracked tab navigates to a different URL, finalize tracking
  const entry = trackedTabs.get(tabId);
  if (entry && normalizeUrl(entry.url) !== normalizedUrl) {
    pauseTimer(tabId);
    reportAndRemove(tabId);
  }
});

// Tab becomes active → start its timer, pause previous active tab in that window
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  // Pause all other tracked tabs in this window
  for (const [id, entry] of trackedTabs) {
    if (id !== tabId && entry.windowId === windowId && entry.activeStart !== null) {
      pauseTimer(id);
    }
  }

  // Start timer for newly active tab if it's tracked and window is focused
  const entry = trackedTabs.get(tabId);
  if (entry && windowId === focusedWindowId) {
    entry.activeStart = Date.now();
  }
});

// Tab closed → finalize and report
chrome.tabs.onRemoved.addListener((tabId) => {
  if (trackedTabs.has(tabId)) {
    pauseTimer(tabId);
    reportAndRemove(tabId);
  }
});

// ─── Window Focus Events ───────────────────────────────────────────

chrome.windows.onFocusChanged.addListener((windowId) => {
  const previousFocused = focusedWindowId;
  focusedWindowId = windowId;

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus — pause ALL tracked tabs
    for (const [id] of trackedTabs) {
      pauseTimer(id);
    }
  } else {
    // Pause tabs in previously focused window
    if (previousFocused !== chrome.windows.WINDOW_ID_NONE) {
      for (const [id, entry] of trackedTabs) {
        if (entry.windowId === previousFocused) {
          pauseTimer(id);
        }
      }
    }

    // Resume the active tab in the newly focused window
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      if (tabs[0] && trackedTabs.has(tabs[0].id)) {
        trackedTabs.get(tabs[0].id).activeStart = Date.now();
      }
    });
  }
});

// ─── Timer Helpers ─────────────────────────────────────────────────

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
    return (u.origin + u.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return url.replace(/\/+$/, "").toLowerCase();
  }
}

// ─── Report Dwell Time to Supabase ─────────────────────────────────

async function reportCurrentState(tabId) {
  const entry = trackedTabs.get(tabId);
  if (!entry || !entry.searchResultId) return;

  // Minimum 1 second to count as a real visit
  if (entry.totalMs < 1000) return;

  // Restore auth config if service worker restarted
  if (!supabaseUrl || !authToken) {
    const stored = await chrome.storage.local.get(["supabaseUrl", "authToken"]);
    supabaseUrl = stored.supabaseUrl || "";
    authToken = stored.authToken || "";
  }

  if (!supabaseUrl || !authToken) {
    console.warn("PersonaSearch: No auth config, cannot report dwell time");
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/track-dwell`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        search_result_id: entry.searchResultId,
        dwell_time_ms: Math.round(entry.totalMs),
        page_size_bytes: entry.pageSizeBytes,
        copy_paste_chars: entry.copyPasteChars,
      }),
    });

    if (!response.ok) {
      console.error("PersonaSearch: Failed to report dwell:", await response.text());
    }
  } catch (e) {
    console.error("PersonaSearch: Report error:", e);
  }
}

async function reportAndRemove(tabId) {
  await reportCurrentState(tabId);
  trackedTabs.delete(tabId);
}

// ─── Initialization ────────────────────────────────────────────────

// Restore config and get initial focused window
chrome.windows.getLastFocused((win) => {
  if (win) focusedWindowId = win.id;
});

chrome.storage.local.get(["supabaseUrl", "authToken"], (result) => {
  supabaseUrl = result.supabaseUrl || "";
  authToken = result.authToken || "";
});
