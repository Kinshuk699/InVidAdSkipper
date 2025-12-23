/**
 * background.js
 * 
 * SponsorJumper AI - Service Worker
 * 
 * Handles transcript fetching with proper CORS handling.
 */

// Extension installation/update handler
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('SponsorJumper AI installed successfully');
  } else if (details.reason === 'update') {
    console.log('SponsorJumper AI updated');
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_TRANSCRIPT') {
    // Fetch transcript in background (has different CORS policy)
    fetchTranscript(message.url)
      .then(segments => sendResponse({ segments }))
      .catch(err => sendResponse({ error: err.message, segments: [] }));
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'SPONSOR_DETECTED') {
    chrome.action.setBadgeText({ text: '!', tabId: sender.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: '#4a9eff', tabId: sender.tab?.id });
  }
  
  return true;
});

async function fetchTranscript(url) {
  console.log('[SponsorJumper BG] Fetching transcript:', url);
  
  try {
    // Try JSON format first
    let fetchUrl = url;
    if (!fetchUrl.includes('fmt=')) {
      fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'fmt=json3';
    }
    
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const text = await response.text();
    console.log('[SponsorJumper BG] Response length:', text.length);
    
    if (text.length === 0) {
      throw new Error('Empty response');
    }
    
    // Try JSON parsing
    if (text.trim().startsWith('{')) {
      const json = JSON.parse(text);
      if (json.events) {
        return json.events
          .filter(e => e.segs && e.tStartMs !== undefined)
          .map(e => ({
            start: e.tStartMs / 1000,
            duration: (e.dDurationMs || 0) / 1000,
            text: e.segs.map(s => s.utf8 || '').join('')
          }))
          .filter(s => s.text.trim());
      }
    }
    
    // Try XML parsing
    return parseXML(text);
    
  } catch (err) {
    console.error('[SponsorJumper BG] Fetch error:', err);
    
    // Try without format parameter
    try {
      const baseUrl = url.split('&fmt=')[0].split('?fmt=')[0];
      const response = await fetch(baseUrl);
      const text = await response.text();
      return parseXML(text);
    } catch (e) {
      console.error('[SponsorJumper BG] Fallback also failed:', e);
      return [];
    }
  }
}

function parseXML(text) {
  const segments = [];
  const regex = /<text[^>]*start=["']?([\d.]+)["']?[^>]*(?:dur=["']?([\d.]+)["']?)?[^>]*>([\s\S]*?)<\/text>/gi;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const decoded = match[3]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, '')
      .trim();
    
    if (decoded) {
      segments.push({
        start: parseFloat(match[1]),
        duration: parseFloat(match[2] || 0),
        text: decoded
      });
    }
  }
  
  console.log('[SponsorJumper BG] Parsed', segments.length, 'XML segments');
  return segments;
}
