/**
 * PersonaSearch Tracker — Content Script v2
 *
 * Injected on all pages. Tracks extended feedback signals:
 * - Page size (for T normalization)
 * - Copy events (C)
 * - Scroll depth (0.0–1.0 max reached)
 * - Highlight count (distinct text selections)
 * - Quick bounce detection (< 8s on page)
 * - Repeat visit detection (via localStorage)
 * - Hover time (passive, via mouse movement activity)
 *
 * Flushes state to background every 5 seconds while active,
 * plus a final flush on page unload.
 */

(() => {
  // ─── State ───────────────────────────────────────────────────────
  let maxScrollDepth = 0;
  let highlightCount = 0;
  let hoverTimeMs = 0;
  let lastMouseMoveAt = null;
  let mouseIsOver = false;
  const pageLoadedAt = Date.now();
  let flushInterval = null;

  // ─── Repeat Visit Detection ──────────────────────────────────────
  function isRepeatVisit() {
    try {
      const key = "ps_visited_" + btoa(location.href.slice(0, 200));
      const prev = localStorage.getItem(key);
      localStorage.setItem(key, Date.now().toString());
      return prev !== null;
    } catch {
      return false;
    }
  }
  const repeatVisit = isRepeatVisit();

  // ─── Page Size Estimation ────────────────────────────────────────
  function estimatePageSize() {
    const text = document.body?.innerText || "";
    return new Blob([text]).size;
  }

  // ─── Scroll Depth ────────────────────────────────────────────────
  function updateScrollDepth() {
    const scrolled = window.scrollY + window.innerHeight;
    const total = Math.max(document.body.scrollHeight, 1);
    const depth = Math.min(scrolled / total, 1.0);
    if (depth > maxScrollDepth) maxScrollDepth = depth;
  }

  window.addEventListener("scroll", updateScrollDepth, { passive: true });
  // Initial measurement
  setTimeout(updateScrollDepth, 500);

  // ─── Highlight / Text Selection Count ───────────────────────────
  document.addEventListener("selectionchange", () => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      highlightCount++;
    }
  });

  // ─── Mouse Hover Time (passive, low CPU) ────────────────────────
  document.addEventListener("mousemove", () => {
    const now = Date.now();
    if (!mouseIsOver) {
      mouseIsOver = true;
      lastMouseMoveAt = now;
    } else if (lastMouseMoveAt) {
      hoverTimeMs += now - lastMouseMoveAt;
      lastMouseMoveAt = now;
    }
  }, { passive: true });

  document.addEventListener("mouseleave", () => {
    mouseIsOver = false;
    lastMouseMoveAt = null;
  });

  // ─── Copy Events (C signal) ──────────────────────────────────────
  document.addEventListener("copy", () => {
    const sel = window.getSelection();
    const text = sel?.toString() || "";
    if (text.length > 0) {
      chrome.runtime.sendMessage({
        type: "PERSONASEARCH_COPY",
        charCount: text.length,
      }).catch(() => {});
    }
  });

  // ─── Current State Snapshot ──────────────────────────────────────
  function buildSnapshot() {
    updateScrollDepth();
    const timeOnPage = Date.now() - pageLoadedAt;
    const quickBounce = timeOnPage < 8000; // < 8 seconds = quick bounce
    return {
      pageSizeBytes: estimatePageSize(),
      scrollDepth: maxScrollDepth,
      highlightCount,
      hoverTimeMs: Math.round(hoverTimeMs),
      quickBounce,
      repeatVisit,
    };
  }

  // ─── Periodic Flush (every 5s) ───────────────────────────────────
  flushInterval = setInterval(() => {
    chrome.runtime.sendMessage({
      type: "PERSONASEARCH_STATE_UPDATE",
      ...buildSnapshot(),
    }).catch(() => {});
  }, 5000);

  // ─── Final flush on unload ───────────────────────────────────────
  window.addEventListener("beforeunload", () => {
    clearInterval(flushInterval);
    // sendBeacon-style: fire and forget
    chrome.runtime.sendMessage({
      type: "PERSONASEARCH_STATE_UPDATE",
      ...buildSnapshot(),
      isFinal: true,
    }).catch(() => {});
  });

  // ─── Initial page info report (after render) ─────────────────────
  setTimeout(() => {
    chrome.runtime.sendMessage({
      type: "PERSONASEARCH_PAGE_INFO",
      pageSizeBytes: estimatePageSize(),
      repeatVisit,
    }).catch(() => {});
  }, 1000);

  // ─── Messages from background / PersonaSearch web app ───────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "GET_PAGE_INFO") {
      const snap = buildSnapshot();
      chrome.runtime.sendMessage({
        type: "PERSONASEARCH_PAGE_INFO",
        pageSizeBytes: snap.pageSizeBytes,
        repeatVisit,
      }).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
  });

  // ─── Web app messages (PostMessage bridge) ───────────────────────
  window.addEventListener("message", (event) => {
    const t = event.data?.type;
    if (t === "PERSONASEARCH_TRACK_START" || t === "PERSONASEARCH_FLUSH_DWELL") {
      chrome.runtime.sendMessage(event.data).catch(() => {});
    }
    if (t === "PERSONASEARCH_PING") {
      window.postMessage({ type: "PERSONASEARCH_PONG", version: "2.0.0" }, "*");
    }
  });
})();
