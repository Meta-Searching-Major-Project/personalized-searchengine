# PersonaSearch Tracker Extension

To accurately track "Dwell Time" (T) and "Copy-Paste" (C) metrics for the 7-tuple feedback system, you must install the local Chrome Extension.

### How to Install the Extension:

1. Open Google Chrome (or any Chromium-based browser like Brave or Edge).
2. Navigate to `chrome://extensions/` in your address bar.
3. In the top right corner, toggle **Developer mode** to ON.
4. Click the **Load unpacked** button in the top left.
5. Select the `extension` folder located inside this project directory:
   `<path-to-project>\extension`
6. The extension will appear in your list. You can click the puzzle piece icon next to your URL bar and "pin" the PersonaSearch Tracker so its icon is visible.

### How to Use:

1. Start your local server and go to `http://localhost:8080`.
2. Make sure you are **signed in**.
3. Click the extension icon in your browser toolbar. It should say **"Connected to PersonaSearch"** with a green dot.
4. Perform a search and click any result.
5. The extension will now silently and accurately track your active time on that page and automatically report it back to the database!
