/**
 * PersonaSearch Tracker — Content Script
 *
 * Injected on all pages. Responsibilities:
 * 1. Listen for tracking instructions from PersonaSearch web app (via postMessage)
 * 2. Measure page content size (for T normalization: t_max = size / reading_speed)
 * 3. Track copy events (for C signal)
 * 4. Relay data to the background service worker
 */

(() => {
  // ─── Listen for messages from the PersonaSearch web app ──────────
  // The web app uses window.postMessage to tell us about tracked URLs
  window.addEventListener("message", (event) => {
    // Only accept messages from the PersonaSearch app
    if (event.data?.type === "PERSONASEARCH_TRACK_START" || event.data?.type === "PERSONASEARCH_FLUSH_DWELL") {
      chrome.runtime.sendMessage(event.data).catch(() => {});
    }

    if (event.data?.type === "PERSONASEARCH_PING") {
      // Respond so the web app knows the extension is installed
      window.postMessage({ type: "PERSONASEARCH_PONG", version: "1.0.0" }, "*");
    }
  });

  // ─── Listen for background asking for page info ──────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "GET_PAGE_INFO") {
      const pageSizeBytes = estimatePageSize();
      chrome.runtime.sendMessage({
        type: "PERSONASEARCH_PAGE_INFO",
        pageSizeBytes,
      }).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
  });

  // ─── Track Copy Events ───────────────────────────────────────────
  document.addEventListener("copy", () => {
    const selection = window.getSelection();
    const text = selection?.toString() || "";
    if (text.length > 0) {
      chrome.runtime.sendMessage({
        type: "PERSONASEARCH_COPY",
        charCount: text.length,
      }).catch(() => {});
    }
  });

  // ─── Page Size Estimation ────────────────────────────────────────
  function estimatePageSize() {
    // Get the text content of the page body (excluding scripts, styles, etc.)
    const bodyText = document.body?.innerText || "";
    // Use Blob to get accurate byte size (handles multi-byte characters)
    const byteSize = new Blob([bodyText]).size;
    return byteSize;
  }

  // ─── Auto-report page size on load ───────────────────────────────
  // Small delay to let the page fully render
  setTimeout(() => {
    const pageSizeBytes = estimatePageSize();
    chrome.runtime.sendMessage({
      type: "PERSONASEARCH_PAGE_INFO",
      pageSizeBytes,
    }).catch(() => {});
  }, 1000);
})();
