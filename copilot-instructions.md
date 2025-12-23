# Project: SponsorJumper AI (Manifest V3)

**Goal:** Build a Chrome Extension that automatically detects and offers to skip in-video sponsor segments by calculating a "Sponsor Probability Score" (SPS).

## Core Algorithm: The "Density & Slope" Engine

The extension must implement a **Sliding Window Analysis** (window size: 10 seconds).

### 1. The Keyword Density Function (The "Context" Check)

Assign weights to word categories found in the transcript.

- **Tier 1 (Weight 5):** "link in description", "use code", "coupon", "promo", "discount"
- **Tier 2 (Weight 3):** "sponsor", "partner", "brought to you by", "thank you to"
- **Tier 3 (Weight 10 - "The Kill Shot"):** Known brand names (e.g., NordVPN, Raid, Manscaped, Ridge, HelloFresh).

**Logic:**
For every 10s transcript window: `Score = Sum(WordWeights)`.
If `Score > 15` -> **High Probability Sponsor Segment**.

### 2. The Heatmap Slope Function (The "Behavior" Check)

Do not just look for the peak (lowest 'y' value).

- Extract the SVG path from `.ytp-heat-map-path`.
- Calculate the **derivative** (slope) between points.
- Identify the **"Max Positive Slope"**: The timestamp where viewership *increases* the most rapidly.
- This timestamp is the target "Skip To" time.

### 3. The Fusion Logic

- **IF** (Keyword Density > 15) **AND** (Max Positive Slope exists within +30s of the keywords)
- **THEN** -> Show the "Skip Sponsor" button targeting the Max Positive Slope timestamp.

## Technical Architecture

- **Injection:** Use `main_world_inject.js` to extract `window.ytInitialPlayerResponse` (captions + heatmap).
- **Messaging:** Use `window.postMessage` to send data to `content.js`.
- **Navigation:** Listen for `yt-navigate-finish` to reset and re-run.
- **UI:** A sleek, dark-mode button (z-index: 9999) overlaying the video.

## Constraints

- **Privacy:** No external API calls. All processing is local.
- **Performance:** Run analysis once per video load.
