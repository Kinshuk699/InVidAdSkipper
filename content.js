/**
 * SponsorJumper AI - Content Script
 * Detects sponsor segments using transcript + heatmap analysis
 */

(function() {
    'use strict';

    const DEBUG = true;
    const log = (...args) => DEBUG && console.log('[SponsorJumper]', ...args);

    const CONFIG = {
        WINDOW_SIZE: 10,
        DENSITY_THRESHOLD: 5,
        MIN_SPONSOR_DURATION: 15,
        MAX_SPONSOR_DURATION: 120
    };

    const KEYWORDS = {
        tier1: ['link in description', 'link below', 'use code', 'coupon code', 'promo code',
                'discount', 'percent off', '% off', 'free trial', 'first month free'],
        tier2: ['sponsor', 'sponsored', 'brought to you', 'thanks to', 'check out', 
                'go to', 'visit', 'head to', 'before we continue', 'quick word from',
                'want to tell you about', 'this video is brought', 'shoutout to',
                'take back', 'personal data', 'privacy', 'annual plan'],
        tier3: ['nordvpn', 'expressvpn', 'surfshark', 'raid shadow legends', 'raycon',
                'manscaped', 'ridge wallet', 'hellofresh', 'squarespace', 'skillshare',
                'brilliant', 'audible', 'betterhelp', 'honey', 'incogni', 'aura',
                'ground news', 'nebula', 'athletic greens', 'ag1', 'established titles']
    };
    const WEIGHTS = { tier1: 5, tier2: 3, tier3: 10 };

    let currentVideoId = null;
    let analysisComplete = false;
    let skipButton = null;

    // ========================================
    // TRANSCRIPT EXTRACTION
    // ========================================

    async function getTranscript() {
        log('Getting transcript...');
        
        // Method 1: Extract from page initial data (embedded in HTML)
        let segments = extractFromInitialData();
        if (segments.length > 0) {
            log('Got', segments.length, 'segments from initial data');
            return segments;
        }

        // Method 2: Open transcript panel and scrape
        segments = await extractFromTranscriptPanel();
        if (segments.length > 0) {
            log('Got', segments.length, 'segments from UI panel');
            return segments;
        }

        // Method 3: Fetch via background script
        segments = await fetchFromCaptionUrl();
        if (segments.length > 0) {
            log('Got', segments.length, 'segments from caption URL');
            return segments;
        }

        return [];
    }

    function extractFromInitialData() {
        log('Trying initial data extraction...');
        
        // YouTube embeds transcript data in the page for some videos
        // Look for it in script tags
        const scripts = document.querySelectorAll('script');
        
        for (const script of scripts) {
            const text = script.textContent || '';
            
            // Method A: Look for transcript segments in ytInitialPlayerResponse
            if (text.includes('playerCaptionsTracklistRenderer')) {
                // Try to find transcript cues if they're embedded
                const cueMatch = text.match(/"cueGroups":\s*\[([\s\S]*?)\]\s*,\s*"(?:actions|trackingParams)/);
                if (cueMatch) {
                    try {
                        const cueData = JSON.parse('[' + cueMatch[1] + ']');
                        const segments = [];
                        for (const group of cueData) {
                            if (group.cues) {
                                for (const cue of group.cues) {
                                    if (cue.startTime && cue.text) {
                                        segments.push({
                                            start: parseFloat(cue.startTime),
                                            duration: parseFloat(cue.durationTime || 5),
                                            text: cue.text
                                        });
                                    }
                                }
                            }
                        }
                        if (segments.length > 0) return segments;
                    } catch (e) {
                        log('Cue parsing failed:', e.message);
                    }
                }
            }
            
            // Method B: Look for engagement panel transcript data
            if (text.includes('transcriptSearchPanel')) {
                const bodyMatch = text.match(/"transcriptSearchPanelRenderer":\s*(\{[\s\S]*?\})\s*,\s*"(?:trackingParams|videoId)/);
                if (bodyMatch) {
                    try {
                        // This is complex nested JSON, try regex approach
                        const segments = [];
                        const segmentRegex = /"startMs":\s*"(\d+)"[\s\S]*?"snippet":\s*\{[\s\S]*?"text":\s*"([^"]+)"/g;
                        let match;
                        while ((match = segmentRegex.exec(text)) !== null) {
                            segments.push({
                                start: parseInt(match[1]) / 1000,
                                duration: 5,
                                text: match[2].replace(/\\n/g, ' ')
                            });
                        }
                        if (segments.length > 0) return segments;
                    } catch (e) {
                        log('Transcript panel parsing failed:', e.message);
                    }
                }
            }
        }
        
        log('No transcript in initial data');
        return [];
    }

    async function extractFromTranscriptPanel() {
        log('Trying transcript panel extraction...');
        
        // First expand the description
        const expandBtn = document.querySelector('tp-yt-paper-button#expand') ||
                         document.querySelector('#description-inline-expander #expand');
        if (expandBtn && expandBtn.offsetParent) {
            expandBtn.click();
            await sleep(600);
        }

        // Find transcript button
        let transcriptBtn = null;
        
        // Look in structured description
        const sections = document.querySelectorAll('ytd-video-description-transcript-section-renderer');
        if (sections.length > 0) {
            transcriptBtn = sections[0].querySelector('button');
        }
        
        // Also try finding by text content
        if (!transcriptBtn) {
            const allBtns = document.querySelectorAll('ytd-button-renderer button, yt-button-shape button');
            for (const btn of allBtns) {
                if (btn.textContent?.toLowerCase().includes('transcript')) {
                    transcriptBtn = btn;
                    break;
                }
            }
        }

        if (!transcriptBtn) {
            log('No transcript button found');
            return [];
        }

        log('Clicking transcript button...');
        transcriptBtn.click();
        await sleep(3000);

        // Find the transcript panel
        const panel = document.querySelector('ytd-transcript-renderer') ||
                     document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
        
        if (!panel) {
            log('Transcript panel not found after click');
            return [];
        }

        // Wait for segments to appear
        await sleep(1000);

        // Try to find segment elements
        const segments = [];
        
        // Try modern selectors
        const segmentEls = panel.querySelectorAll('ytd-transcript-segment-renderer');
        log('Found', segmentEls.length, 'ytd-transcript-segment-renderer elements');

        for (const el of segmentEls) {
            // Get all text content and try to parse
            const allText = el.innerText || '';
            const lines = allText.split('\n').filter(l => l.trim());
            
            // Usually first line is time, second is text
            if (lines.length >= 2) {
                const timeStr = lines[0].trim();
                const text = lines.slice(1).join(' ').trim();
                const start = parseTime(timeStr);
                
                if (!isNaN(start) && text) {
                    segments.push({ start, duration: 5, text });
                }
            }
        }

        // Fallback: parse entire panel text
        if (segments.length === 0) {
            log('Trying full panel text parsing...');
            const panelText = panel.innerText || '';
            const lines = panelText.split('\n').filter(l => l.trim());
            
            for (let i = 0; i < lines.length; i++) {
                const timeMatch = lines[i].match(/^(\d{1,2}:\d{2}(?::\d{2})?)$/);
                if (timeMatch && lines[i + 1] && !lines[i + 1].match(/^\d{1,2}:/)) {
                    const start = parseTime(timeMatch[1]);
                    const text = lines[i + 1].trim();
                    if (!isNaN(start) && text.length > 0) {
                        segments.push({ start, duration: 5, text });
                    }
                }
            }
            log('Full panel parsing found', segments.length, 'segments');
        }

        // Close the panel
        const closeBtn = document.querySelector('button[aria-label*="Close"]') ||
                        document.querySelector('#visibility-button');
        if (closeBtn) closeBtn.click();

        return segments;
    }

    async function fetchFromCaptionUrl() {
        log('Trying caption URL fetch...');
        
        // Find caption URL in page scripts
        const scripts = document.querySelectorAll('script');
        let captionUrl = null;

        for (const script of scripts) {
            const text = script.textContent || '';
            
            // Look for baseUrl in captionTracks
            const match = text.match(/"captionTracks":\s*\[\s*\{[^}]*"baseUrl":\s*"([^"]+)"/);
            if (match) {
                captionUrl = match[1]
                    .replace(/\\u0026/g, '&')
                    .replace(/\\u003d/g, '=');
                break;
            }
        }

        if (!captionUrl) {
            log('No caption URL found in page');
            return [];
        }

        log('Found caption URL:', captionUrl.substring(0, 80) + '...');

        // Try fetching via background script
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'FETCH_TRANSCRIPT', url: captionUrl }, (response) => {
                if (chrome.runtime.lastError) {
                    log('Background error:', chrome.runtime.lastError.message);
                    resolve([]);
                } else {
                    log('Background response:', response?.segments?.length || 0, 'segments');
                    resolve(response?.segments || []);
                }
            });
        });
    }

    function parseTime(str) {
        if (!str) return NaN;
        const cleaned = str.replace(/\s/g, '');
        const parts = cleaned.split(':').map(Number);
        if (parts.some(isNaN)) return NaN;
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return NaN;
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    // ========================================
    // KEYWORD ANALYSIS
    // ========================================

    function analyzeKeywords(segments) {
        if (!segments.length) return { windows: [], maxScore: 0 };

        const duration = segments[segments.length - 1].start + 10;
        const windows = [];

        for (let start = 0; start < duration; start += 5) {
            const end = start + CONFIG.WINDOW_SIZE;
            const text = segments
                .filter(s => s.start >= start && s.start < end)
                .map(s => s.text.toLowerCase())
                .join(' ');

            let score = 0;
            const matches = [];

            for (const [tier, keywords] of Object.entries(KEYWORDS)) {
                for (const kw of keywords) {
                    if (text.includes(kw)) {
                        score += WEIGHTS[tier];
                        matches.push(kw);
                    }
                }
            }

            if (score > 0) {
                windows.push({ start, end, score, matches });
            }
        }

        windows.sort((a, b) => b.score - a.score);
        return { windows, maxScore: windows[0]?.score || 0 };
    }

    // ========================================
    // HEATMAP ANALYSIS
    // ========================================

    function analyzeHeatmap(videoDuration) {
        const container = document.querySelector('.ytp-heat-map-container');
        if (!container) {
            log('No heatmap container');
            return { maxSlope: 0, maxSlopeTime: 0 };
        }

        const path = container.querySelector('path');
        if (!path) {
            log('No heatmap path');
            return { maxSlope: 0, maxSlopeTime: 0 };
        }

        const d = path.getAttribute('d') || '';
        const points = [];
        const regex = /([MLCQ])\s*([-\d.,\s]+)/gi;
        let match;
        
        while ((match = regex.exec(d)) !== null) {
            const coords = match[2].trim().split(/[\s,]+/).map(parseFloat);
            const cmd = match[1].toUpperCase();
            if (cmd === 'M' || cmd === 'L') {
                for (let i = 0; i < coords.length - 1; i += 2) {
                    points.push({ x: coords[i], y: coords[i+1] });
                }
            } else if (cmd === 'C') {
                for (let i = 0; i < coords.length - 5; i += 6) {
                    points.push({ x: coords[i+4], y: coords[i+5] });
                }
            }
        }

        if (points.length < 2) {
            log('Not enough heatmap points');
            return { maxSlope: 0, maxSlopeTime: 0 };
        }

        const svg = container.querySelector('svg');
        const width = svg?.viewBox?.baseVal?.width || svg?.clientWidth || 1000;

        let maxSlope = 0, maxSlopeTime = 0;

        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i-1].x;
            if (dx === 0) continue;
            // Negate because Y is inverted in SVG
            const slope = -(points[i].y - points[i-1].y) / dx;
            if (slope > maxSlope) {
                maxSlope = slope;
                maxSlopeTime = (points[i-1].x / width) * videoDuration;
            }
        }

        log('Heatmap analyzed:', points.length, 'points, max slope', maxSlope.toFixed(3));
        return { maxSlope, maxSlopeTime };
    }

    // ========================================
    // SPONSOR DETECTION
    // ========================================

    function detectSponsors(keywords, heatmap, duration) {
        let candidates = keywords.windows.filter(w => w.score >= CONFIG.DENSITY_THRESHOLD);
        
        // If no high-scoring windows, use top windows anyway
        if (candidates.length === 0 && keywords.maxScore > 0) {
            candidates = keywords.windows.slice(0, 3);
        }

        const segments = [];
        for (const w of candidates) {
            let endTime = Math.min(w.start + 60, duration);
            let confidence = 'medium';

            // If heatmap slope is within range, use that as end time
            if (heatmap.maxSlopeTime > w.start && heatmap.maxSlopeTime < w.start + 90) {
                endTime = heatmap.maxSlopeTime;
                confidence = 'high';
            }

            const len = endTime - w.start;
            if (len >= CONFIG.MIN_SPONSOR_DURATION && len <= CONFIG.MAX_SPONSOR_DURATION) {
                segments.push({
                    start: w.start,
                    end: endTime,
                    confidence,
                    score: w.score,
                    keywords: w.matches
                });
            }
        }

        // Merge overlapping segments
        segments.sort((a, b) => a.start - b.start);
        const merged = [];
        for (const seg of segments) {
            const last = merged[merged.length - 1];
            if (last && seg.start <= last.end + 10) {
                last.end = Math.max(last.end, seg.end);
                last.keywords = [...new Set([...last.keywords, ...seg.keywords])];
            } else {
                merged.push(seg);
            }
        }

        return merged;
    }

    // ========================================
    // SKIP BUTTON
    // ========================================

    function showSkipButton(segment) {
        removeSkipButton();
        const video = document.querySelector('video');
        if (!video) return;

        skipButton = document.createElement('div');
        skipButton.id = 'sponsorjumper-skip-btn';
        skipButton.innerHTML = '<div class="sj-content"><span class="sj-icon">⏭️</span><span class="sj-text">Skip Sponsor</span></div>';
        skipButton.onclick = () => {
            log('Skipping to', formatTime(segment.end));
            video.currentTime = segment.end;
            removeSkipButton();
        };

        const player = document.querySelector('.html5-video-player');
        if (player) player.appendChild(skipButton);

        const checkVisibility = () => {
            if (!skipButton) return;
            const t = video.currentTime;
            const visible = t >= segment.start - 2 && t < segment.end;
            skipButton.classList.toggle('visible', visible);
            if (t < segment.end) {
                requestAnimationFrame(checkVisibility);
            } else {
                removeSkipButton();
            }
        };
        checkVisibility();
    }

    function removeSkipButton() {
        if (skipButton) {
            skipButton.remove();
            skipButton = null;
        }
    }

    function formatTime(s) {
        if (isNaN(s) || s < 0) return '0:00';
        const mins = Math.floor(s / 60);
        const secs = Math.floor(s % 60);
        return mins + ':' + String(secs).padStart(2, '0');
    }

    // ========================================
    // MAIN ANALYSIS
    // ========================================

    async function analyze() {
        const videoId = new URLSearchParams(location.search).get('v');
        if (!videoId) return;
        
        if (videoId === currentVideoId && analysisComplete) return;

        currentVideoId = videoId;
        analysisComplete = false;
        removeSkipButton();

        log('');
        log('=' .repeat(50));
        log('SponsorJumper analyzing:', videoId);
        log('=' .repeat(50));

        const video = document.querySelector('video');
        const duration = video?.duration || 0;
        log('Video duration:', formatTime(duration));

        // Get transcript
        const segments = await getTranscript();
        log('Transcript segments:', segments.length);

        if (segments.length === 0) {
            log('❌ No transcript available');
            analysisComplete = true;
            return;
        }

        // Show sample transcript
        log('Sample:');
        segments.slice(0, 3).forEach(s => {
            log('  [' + formatTime(s.start) + '] ' + s.text.substring(0, 60));
        });

        // Keyword analysis
        const keywords = analyzeKeywords(segments);
        log('Keyword analysis: max score =', keywords.maxScore);
        if (keywords.windows.length > 0) {
            const top = keywords.windows[0];
            log('  Top window: ' + formatTime(top.start) + '-' + formatTime(top.end));
            log('  Matches:', top.matches.join(', '));
        }

        // Heatmap analysis
        const heatmap = analyzeHeatmap(duration);
        if (heatmap.maxSlope > 0) {
            log('Heatmap: max slope at', formatTime(heatmap.maxSlopeTime));
        }

        // Detect sponsors
        const sponsors = detectSponsors(keywords, heatmap, duration);

        if (sponsors.length > 0) {
            log('');
            log('✅ SPONSOR DETECTED!');
            sponsors.forEach((s, i) => {
                log('  Segment ' + (i+1) + ': ' + formatTime(s.start) + ' → ' + formatTime(s.end) + ' [' + s.confidence + ']');
                log('    Keywords: ' + s.keywords.join(', '));
            });
            showSkipButton(sponsors[0]);
        } else {
            log('No sponsors detected');
        }

        analysisComplete = true;
        log('=' .repeat(50));
    }

    // YouTube SPA navigation handler
    document.addEventListener('yt-navigate-finish', () => {
        log('Navigation detected');
        currentVideoId = null;
        analysisComplete = false;
        removeSkipButton();
        setTimeout(analyze, 3500);
    });

    // Initial run
    log('SponsorJumper AI v1.0 loaded');
    setTimeout(analyze, 4000);

})();
