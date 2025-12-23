# Coding Rules for SponsorJumper AI

1. **Manifest V3 Strictness:**

   - No remote code execution.
   - Use `action` in `manifest.json`, not `browser_action`.
   - `content_scripts` cannot access page variables directly; rely on the injected bridge.
2. **YouTube SPA Handling:**

   - YouTube is a Single Page App. You MUST use `yt-navigate-finish` to detect video changes.
   - Do not rely on `window.onload`.
3. **Error Handling:**

   - Wrap all `JSON.parse` and transcript fetching in `try/catch`.
   - Fail silently: If no sponsor is found, show nothing. Do not clutter the console.
4. **Code Style:**

   - Use modern ES6+ (async/await, arrow functions).
   - Add comments explaining the "Slope Calculation" math.
