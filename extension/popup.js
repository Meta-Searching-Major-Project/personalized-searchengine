// PersonaSearch Tracker — Popup Script
chrome.runtime.sendMessage({ type: "PERSONASEARCH_GET_STATUS" }, (response) => {
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  const count = document.getElementById("trackedCount");

  if (chrome.runtime.lastError || !response) {
    dot.className = "dot red";
    text.textContent = "Extension error";
    return;
  }

  if (response.connected) {
    dot.className = "dot green";
    text.textContent = "Connected to PersonaSearch";
  } else {
    dot.className = "dot amber";
    text.textContent = "Sign in to PersonaSearch to start";
  }

  count.textContent = response.trackedCount || 0;
});
