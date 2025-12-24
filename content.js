/**
 * SponsorJumper AI v2.1 - Content Script
 * 
 * FIXES:
 * - Remove ambiguous brand names that are common words
 * - Require multi-signal validation (START + BRAND + END)
 * - Different confidence formulas for heatmap vs no-heatmap
 * - Much higher thresholds to reduce false positives
 */

(function() {
    'use strict';

    const DEBUG = true;
    const log = (...args) => DEBUG && console.log('[SponsorJumper]', ...args);

    const CONFIG = {
        MIN_SPONSOR_DURATION: 30,
        MAX_SPONSOR_DURATION: 150,
        LOOKBACK_MAX: 120,
        LOOKBACK_DEFAULT: 75,
        CTA_PADDING: 15,
        
        // Confidence thresholds (different for heatmap vs no-heatmap)
        MIN_SCORE_WITH_HEATMAP: 15,
        MIN_SCORE_NO_HEATMAP: 25,      // Much higher without heatmap validation
        MIN_SIGNAL_TYPES: 2,            // Need at least 2 different signal types
        MIN_KEYWORDS_IN_CLUSTER: 3      // Need at least 3 keyword matches
    };

    // Keywords that appear at START of sponsor segments (weight: 10)
    const START_MARKERS = [
        'before we continue', 'before we get into', 'before i continue',
        'quick word from', 'word from our sponsor', 'message from',
        'this video is sponsored', 'this video is brought', 'sponsored by',
        'want to tell you about', 'want to talk about', 'partnered with',
        'thanks to our sponsor', 'thank you to our sponsor',
        'speaking of which', 'let me tell you about', 'i want to mention',
        'brought to you by', 'and now a word', 'todays sponsor',
        'this portion', 'this segment', 'pause for a second'
    ];

    // Keywords that appear at END of sponsor segments - CTA (weight: 8)
    const END_MARKERS = [
        'link in description', 'link in the description', 'link below',
        'use code', 'use my code', 'coupon code', 'promo code',
        'first month free', 'free trial',
        'click the link', 'check them out at',
        'percent off', '% off'
    ];

    // UNAMBIGUOUS brand names only (weight: 12)
    // Removed: keeps, brilliant, honey, aura, factor (common English words)
    const BRANDS = [
        'nordvpn', 'expressvpn', 'surfshark', 'raid shadow legends', 'raycon',
        'manscaped', 'ridge wallet', 'hellofresh', 'squarespace', 'skillshare',
        'audible', 'betterhelp', 'incogni',
        'ground news', 'nebula', 'athletic greens', 'ag1', 'established titles',
        'curiositystream', 'private internet access', 'delete me',
        'function of beauty', 'casetify', 'bespoke post', 'masterclass'
    ];

    // Topic keywords - only count if combined with other signals (weight: 3)
    const TOPIC_MARKERS = [
        'personal data', 'data brokers', 'online privacy',
        'subscription box', 'annual plan', 'monthly subscription'
    ];

    // Weak CTA words - common in normal speech, need other signals (weight: 2)
    const WEAK_CTA = [
        'go to', 'check out', 'visit', 'head over to', 'discount'
    ];

    let currentVideoId = null;
    let analysisComplete = false;
    let detectedSponsors = [];
    let currentNotificationIndex = 0;
    let notificationElement = null;

    // ========================================
    // TRANSCRIPT EXTRACTION
    // ========================================

    async function getTranscript() {
        log('Getting transcript...');
        
        let segments = extractFromInitialData();
        if (segments.length > 0) {
            log('Got', segments.length, 'segments from initial data');
            return segments;
        }

        segments = await extractFromTranscriptPanel();
        if (segments.length > 0) {
            log('Got', segments.length, 'segments from UI panel');
            return segments;
        }

        segments = await fetchFromCaptionUrl();
        if (segments.length > 0) {
            log('Got', segments.length, 'segments from caption URL');
            return segments;
        }

        return [];
    }

    function extractFromInitialData() {
        const scripts = document.querySelectorAll('script');
        
        for (const script of scripts) {
            const text = script.textContent || '';
            
            if (text.includes('playerCaptionsTracklistRenderer')) {
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
                    } catch (e) {}
                }
            }
        }
        return [];
    }

    async function extractFromTranscriptPanel() {
        const expandBtn = document.querySelector('tp-yt-paper-button#expand') ||
                         document.querySelector('#description-inline-expander #expand');
        if (expandBtn && expandBtn.offsetParent) {
            expandBtn.click();
            await sleep(600);
        }

        let transcriptBtn = null;
        const sections = document.querySelectorAll('ytd-video-description-transcript-section-renderer');
        if (sections.length > 0) {
            transcriptBtn = sections[0].querySelector('button');
        }
        
        if (!transcriptBtn) {
            const allBtns = document.querySelectorAll('ytd-button-renderer button, yt-button-shape button');
            for (const btn of allBtns) {
                if (btn.textContent?.toLowerCase().includes('transcript')) {
                    transcriptBtn = btn;
                    break;
                }
            }
        }

        if (!transcriptBtn) return [];

        transcriptBtn.click();
        await sleep(3000);

        const panel = document.querySelector('ytd-transcript-renderer') ||
                     document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
        
        if (!panel) return [];

        await sleep(1000);
        const segments = [];
        const segmentEls = panel.querySelectorAll('ytd-transcript-segment-renderer');

        for (const el of segmentEls) {
            const allText = el.innerText || '';
            const lines = allText.split('\n').filter(l => l.trim());
            
            if (lines.length >= 2) {
                const timeStr = lines[0].trim();
                const text = lines.slice(1).join(' ').trim();
                const start = parseTime(timeStr);
                
                if (!isNaN(start) && text) {
                    segments.push({ start, duration: 5, text });
                }
            }
        }

        if (segments.length === 0) {
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
        }

        const closeBtn = document.querySelector('button[aria-label*="Close"]') ||
                        document.querySelector('#visibility-button');
        if (closeBtn) closeBtn.click();

        return segments;
    }

    async function fetchFromCaptionUrl() {
        const scripts = document.querySelectorAll('script');
        let captionUrl = null;

        for (const script of scripts) {
            const text = script.textContent || '';
            const match = text.match(/"captionTracks":\s*\[\s*\{[^}]*"baseUrl":\s*"([^"]+)"/);
            if (match) {
                captionUrl = match[1].replace(/\\u0026/g, '&').replace(/\\u003d/g, '=');
                break;
            }
        }

        if (!captionUrl) return [];

        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'FETCH_TRANSCRIPT', url: captionUrl }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve([]);
                } else {
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
    // IMPROVED SPONSOR DETECTION v2.1
    // ========================================

    function detectSponsorSegments(segments, videoDuration, heatmap) {
        if (!segments.length) return [];

        const hasHeatmap = heatmap && heatmap.valleys && heatmap.valleys.length > 0;
        const minScore = hasHeatmap ? CONFIG.MIN_SCORE_WITH_HEATMAP : CONFIG.MIN_SCORE_NO_HEATMAP;
        
        log('Detection mode:', hasHeatmap ? 'WITH HEATMAP' : 'NO HEATMAP');
        log('Minimum score required:', minScore);

        // Build timeline of all keyword matches
        const matches = [];

        for (const seg of segments) {
            const text = seg.text.toLowerCase();
            const time = seg.start;

            // Check START markers (high confidence)
            for (const phrase of START_MARKERS) {
                if (text.includes(phrase)) {
                    matches.push({ time, type: 'start', phrase, weight: 10 });
                }
            }

            // Check END markers / strong CTA (high confidence)
            for (const phrase of END_MARKERS) {
                if (text.includes(phrase)) {
                    matches.push({ time, type: 'end', phrase, weight: 8 });
                }
            }

            // Check BRANDS (high confidence - only unambiguous names)
            for (const brand of BRANDS) {
                if (text.includes(brand)) {
                    matches.push({ time, type: 'brand', phrase: brand, weight: 12 });
                }
            }

            // Check TOPICS (medium confidence)
            for (const topic of TOPIC_MARKERS) {
                if (text.includes(topic)) {
                    matches.push({ time, type: 'topic', phrase: topic, weight: 3 });
                }
            }

            // Check weak CTA (low confidence - need other signals)
            for (const phrase of WEAK_CTA) {
                if (text.includes(phrase)) {
                    matches.push({ time, type: 'weak_cta', phrase, weight: 2 });
                }
            }
        }

        if (matches.length === 0) {
            log('No sponsor keywords found');
            return [];
        }

        log('Found', matches.length, 'keyword matches');
        
        // Log matches for debugging
        const byType = {};
        matches.forEach(m => {
            byType[m.type] = (byType[m.type] || 0) + 1;
        });
        log('  By type:', JSON.stringify(byType));

        // Sort by time
        matches.sort((a, b) => a.time - b.time);

        // Find sponsor clusters using sliding window approach
        const sponsorSegments = findSponsorClusters(matches, videoDuration, heatmap, minScore);

        // Merge overlapping segments
        return mergeOverlapping(sponsorSegments);
    }

    function findSponsorClusters(matches, videoDuration, heatmap, minScore) {
        const sponsors = [];
        const windowSize = 90; // 90-second sliding window
        const stepSize = 15;   // Step by 15 seconds

        for (let windowStart = 0; windowStart < videoDuration - 30; windowStart += stepSize) {
            const windowEnd = windowStart + windowSize;
            
            // Get matches in this window
            const windowMatches = matches.filter(m => 
                m.time >= windowStart && m.time < windowEnd
            );

            if (windowMatches.length < CONFIG.MIN_KEYWORDS_IN_CLUSTER) continue;

            // Calculate score and signal diversity
            const score = windowMatches.reduce((sum, m) => sum + m.weight, 0);
            const signalTypes = new Set(windowMatches.map(m => m.type));
            
            // Count high-value signals (not weak_cta or topic)
            const strongSignals = windowMatches.filter(m => 
                m.type === 'start' || m.type === 'end' || m.type === 'brand'
            );

            // VALIDATION: Need minimum score
            if (score < minScore) continue;

            // VALIDATION: Need at least 2 different signal types
            if (signalTypes.size < CONFIG.MIN_SIGNAL_TYPES) continue;

            // VALIDATION: Need at least one strong signal
            if (strongSignals.length === 0) continue;

            // VALIDATION: If no heatmap, require stricter criteria
            if (!heatmap) {
                // Without heatmap, must have either:
                // 1. A brand mention + CTA, OR
                // 2. A start marker + CTA
                const hasBrand = windowMatches.some(m => m.type === 'brand');
                const hasStart = windowMatches.some(m => m.type === 'start');
                const hasCTA = windowMatches.some(m => m.type === 'end');
                
                if (!((hasBrand && hasCTA) || (hasStart && hasCTA) || (hasStart && hasBrand))) {
                    continue;
                }
            }

            // Calculate precise boundaries
            const times = windowMatches.map(m => m.time);
            let sponsorStart = Math.min(...times);
            let sponsorEnd = Math.max(...times) + CONFIG.CTA_PADDING;

            // If we have a start marker, use that as the beginning
            const startMarker = windowMatches.find(m => m.type === 'start');
            if (startMarker) {
                sponsorStart = startMarker.time;
            } else {
                // Look back a bit from first keyword
                sponsorStart = Math.max(0, sponsorStart - 10);
            }

            // If we have heatmap, refine using valley data
            if (heatmap && heatmap.valleys) {
                for (const valley of heatmap.valleys) {
                    // If a valley overlaps with our detected segment
                    if (valley.start <= sponsorEnd && valley.end >= sponsorStart) {
                        // Use valley boundaries for better precision
                        sponsorStart = Math.min(sponsorStart, valley.start);
                        sponsorEnd = Math.max(sponsorEnd, valley.end);
                        log('Refined with heatmap valley:', formatTime(valley.start), '->', formatTime(valley.end));
                        break;
                    }
                }
            }

            // Validate duration
            const duration = sponsorEnd - sponsorStart;
            if (duration < CONFIG.MIN_SPONSOR_DURATION || duration > CONFIG.MAX_SPONSOR_DURATION) {
                continue;
            }

            // Calculate confidence level
            let confidence = 'low';
            if (score >= 30 && signalTypes.size >= 3) {
                confidence = 'high';
            } else if (score >= 20 && signalTypes.size >= 2) {
                confidence = 'medium';
            }

            sponsors.push({
                start: sponsorStart,
                end: sponsorEnd,
                score,
                signalTypes: signalTypes.size,
                confidence,
                keywords: [...new Set(windowMatches.map(m => m.phrase))]
            });
        }

        return sponsors;
    }

    function mergeOverlapping(segments) {
        if (segments.length <= 1) return segments;

        segments.sort((a, b) => a.start - b.start);
        const merged = [];

        for (const seg of segments) {
            const last = merged[merged.length - 1];
            if (last && seg.start <= last.end + 20) {
                // Merge: take best attributes
                last.end = Math.max(last.end, seg.end);
                last.keywords = [...new Set([...last.keywords, ...seg.keywords])];
                last.score = Math.max(last.score, seg.score);
                last.signalTypes = Math.max(last.signalTypes, seg.signalTypes);
                if (seg.confidence === 'high') last.confidence = 'high';
                else if (seg.confidence === 'medium' && last.confidence === 'low') last.confidence = 'medium';
            } else {
                merged.push({ ...seg });
            }
        }

        return merged;
    }

    // ========================================
    // HEATMAP ANALYSIS
    // ========================================

    async function analyzeHeatmap(videoDuration) {
        log('Checking for heatmap...');

        const progressBar = document.querySelector('.ytp-progress-bar');
        if (progressBar) {
            progressBar.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            await sleep(800);
        }

        const svg = document.querySelector('svg.ytp-heat-map-svg') ||
                   document.querySelector('.ytp-heat-map-container svg');
        
        if (!svg) {
            log('No heatmap available (video needs 50k+ views)');
            return null;
        }

        const path = svg.querySelector('path');
        if (!path) {
            log('No heatmap path');
            return null;
        }

        const d = path.getAttribute('d') || '';
        const points = parseSVGPath(d);

        if (points.length < 2) {
            log('Not enough heatmap points');
            return null;
        }

        const viewBox = svg.getAttribute('viewBox') || '0 0 1000 100';
        const vbParts = viewBox.split(' ').map(Number);
        const width = vbParts[2] || 1000;
        const height = vbParts[3] || 100;

        // Find valleys (engagement dips) and slopes
        const valleys = [];
        const slopes = [];
        let inValley = false;
        let valleyStart = 0;
        const valleyThreshold = 65; // Y > 65 = low engagement

        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i - 1].x;
            if (dx === 0) continue;

            const dy = points[i].y - points[i - 1].y;
            const slope = -dy / dx;
            const time = (points[i - 1].x / width) * videoDuration;
            const engagement = 100 - points[i].y; // Convert to engagement %

            slopes.push({ time, slope, engagement });

            if (points[i].y > valleyThreshold && !inValley) {
                inValley = true;
                valleyStart = time;
            } else if (points[i].y <= valleyThreshold && inValley) {
                inValley = false;
                const valleyEnd = time;
                // Only count valleys that are at least 20 seconds long
                if (valleyEnd - valleyStart >= 20) {
                    valleys.push({ start: valleyStart, end: valleyEnd });
                }
            }
        }

        let maxSlope = 0;
        let maxSlopeTime = 0;
        for (const s of slopes) {
            if (s.slope > maxSlope) {
                maxSlope = s.slope;
                maxSlopeTime = s.time;
            }
        }

        log('Heatmap analyzed:', points.length, 'points');
        log('  Valleys found:', valleys.length);
        valleys.forEach((v, i) => log('    Valley', i + 1 + ':', formatTime(v.start), '->', formatTime(v.end)));

        return { points, slopes, valleys, maxSlope, maxSlopeTime, width, height };
    }

    function parseSVGPath(d) {
        const points = [];
        const regex = /([MLCQ])\s*([-\d.,\s]+)/gi;
        let match;

        while ((match = regex.exec(d)) !== null) {
            const coords = match[2].trim().split(/[\s,]+/).map(parseFloat);
            const cmd = match[1].toUpperCase();

            if (cmd === 'M' || cmd === 'L') {
                for (let i = 0; i < coords.length - 1; i += 2) {
                    points.push({ x: coords[i], y: coords[i + 1] });
                }
            } else if (cmd === 'C') {
                for (let i = 0; i < coords.length - 5; i += 6) {
                    points.push({ x: coords[i + 4], y: coords[i + 5] });
                }
            }
        }

        return points;
    }

    // ========================================
    // NOTIFICATION UI
    // ========================================

    function showNotification(segment, index, total) {
        removeNotification();

        const notification = document.createElement('div');
        notification.id = 'sponsorjumper-notification';
        
        const countText = total > 1 ? ' (' + (index + 1) + '/' + total + ')' : '';
        const confidenceEmoji = segment.confidence === 'high' ? '🎯' : 
                               segment.confidence === 'medium' ? '🔍' : '❓';
        const confidenceText = segment.confidence.charAt(0).toUpperCase() + segment.confidence.slice(1);
        
        notification.innerHTML = '<div class="sj-notif-content">' +
            '<div class="sj-notif-header">' +
                '<span class="sj-notif-icon">' + confidenceEmoji + '</span>' +
                '<span class="sj-notif-title">Sponsor Detected!' + countText + '</span>' +
                '<button class="sj-notif-close" title="Dismiss">✕</button>' +
            '</div>' +
            '<div class="sj-notif-body">' +
                '<p class="sj-notif-time">Found from <strong>' + formatTime(segment.start) + '</strong> to <strong>' + formatTime(segment.end) + '</strong></p>' +
                '<p class="sj-notif-confidence">Confidence: ' + confidenceText + ' (Score: ' + segment.score + ')</p>' +
                '<p class="sj-notif-keywords">Keywords: ' + segment.keywords.slice(0, 4).join(', ') + '</p>' +
            '</div>' +
            '<div class="sj-notif-actions">' +
                '<button class="sj-notif-skip">⏭️ Skip to ' + formatTime(segment.end) + '</button>' +
            '</div>' +
        '</div>';

        if (!document.getElementById('sponsorjumper-styles')) {
            const style = document.createElement('style');
            style.id = 'sponsorjumper-styles';
            style.textContent = '@keyframes sjSlideIn { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } } ' +
                '@keyframes sjSlideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(120%); opacity: 0; } } ' +
                '#sponsorjumper-notification { position: fixed; top: 80px; right: 20px; z-index: 2147483647; font-family: "YouTube Sans", "Segoe UI", Roboto, Arial, sans-serif; animation: sjSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1); } ' +
                '#sponsorjumper-notification.closing { animation: sjSlideOut 0.3s ease-in forwards; } ' +
                '.sj-notif-content { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border: 1px solid #4a9eff; border-radius: 12px; padding: 0; box-shadow: 0 8px 32px rgba(74, 158, 255, 0.35), 0 2px 8px rgba(0,0,0,0.4); min-width: 300px; max-width: 360px; overflow: hidden; } ' +
                '.sj-notif-header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: rgba(74, 158, 255, 0.15); border-bottom: 1px solid rgba(74, 158, 255, 0.2); } ' +
                '.sj-notif-icon { font-size: 20px; } ' +
                '.sj-notif-title { flex: 1; font-size: 14px; font-weight: 600; color: #4a9eff; } ' +
                '.sj-notif-close { background: transparent; border: none; color: #666; font-size: 16px; cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: all 0.2s; } ' +
                '.sj-notif-close:hover { background: rgba(255,255,255,0.1); color: #fff; } ' +
                '.sj-notif-body { padding: 12px 14px; } ' +
                '.sj-notif-time { margin: 0 0 6px 0; font-size: 13px; color: #e0e0e0; } ' +
                '.sj-notif-time strong { color: #fff; font-weight: 600; } ' +
                '.sj-notif-confidence { margin: 0 0 6px 0; font-size: 12px; color: #4a9eff; } ' +
                '.sj-notif-keywords { margin: 0; font-size: 11px; color: #888; font-style: italic; } ' +
                '.sj-notif-actions { padding: 10px 14px 14px; } ' +
                '.sj-notif-skip { width: 100%; background: linear-gradient(135deg, #4a9eff 0%, #3a7bd5 100%); color: white; border: none; padding: 10px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.2s; box-shadow: 0 2px 8px rgba(74, 158, 255, 0.3); } ' +
                '.sj-notif-skip:hover { background: linear-gradient(135deg, #5aafff 0%, #4a8be5 100%); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(74, 158, 255, 0.4); } ' +
                '.sj-notif-skip:active { transform: translateY(0); }';
            document.head.appendChild(style);
        }

        const closeBtn = notification.querySelector('.sj-notif-close');
        const skipBtn = notification.querySelector('.sj-notif-skip');

        closeBtn.onclick = function() {
            closeNotification(function() {
                currentNotificationIndex++;
                if (currentNotificationIndex < detectedSponsors.length) {
                    showNotification(
                        detectedSponsors[currentNotificationIndex],
                        currentNotificationIndex,
                        detectedSponsors.length
                    );
                }
            });
        };

        skipBtn.onclick = function() {
            const video = document.querySelector('video');
            if (video) {
                log('Skipping to', formatTime(segment.end));
                video.currentTime = segment.end;
            }
            closeNotification(function() {
                currentNotificationIndex++;
                if (currentNotificationIndex < detectedSponsors.length) {
                    showNotification(
                        detectedSponsors[currentNotificationIndex],
                        currentNotificationIndex,
                        detectedSponsors.length
                    );
                }
            });
        };

        document.body.appendChild(notification);
        notificationElement = notification;
    }

    function closeNotification(callback) {
        if (notificationElement) {
            notificationElement.classList.add('closing');
            setTimeout(function() {
                removeNotification();
                if (callback) callback();
            }, 300);
        } else if (callback) {
            callback();
        }
    }

    function removeNotification() {
        if (notificationElement) {
            notificationElement.remove();
            notificationElement = null;
        }
        const existing = document.getElementById('sponsorjumper-notification');
        if (existing) existing.remove();
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
        detectedSponsors = [];
        currentNotificationIndex = 0;
        removeNotification();

        log('');
        log('='.repeat(50));
        log('SponsorJumper AI v2.1 analyzing:', videoId);
        log('='.repeat(50));

        const video = document.querySelector('video');
        const duration = video?.duration || 0;
        log('Video duration:', formatTime(duration));

        const segments = await getTranscript();
        log('Transcript segments:', segments.length);

        if (segments.length === 0) {
            log('No transcript available');
            analysisComplete = true;
            return;
        }

        log('Sample:');
        segments.slice(0, 3).forEach(function(s) {
            log('  [' + formatTime(s.start) + '] ' + s.text.substring(0, 60));
        });

        const heatmap = await analyzeHeatmap(duration);

        const sponsors = detectSponsorSegments(segments, duration, heatmap);

        if (sponsors.length > 0) {
            log('');
            log('SPONSOR' + (sponsors.length > 1 ? 'S' : '') + ' DETECTED!');
            sponsors.forEach(function(s, i) {
                log('  Segment ' + (i + 1) + ': ' + formatTime(s.start) + ' -> ' + formatTime(s.end));
                log('    Confidence: ' + s.confidence + ', Score: ' + s.score + ', Signal types: ' + s.signalTypes);
                log('    Keywords: ' + s.keywords.slice(0, 5).join(', '));
            });
            
            detectedSponsors = sponsors;
            currentNotificationIndex = 0;
            showNotification(sponsors[0], 0, sponsors.length);
        } else {
            log('No sponsors detected (thresholds not met)');
        }

        analysisComplete = true;
        log('='.repeat(50));
    }

    document.addEventListener('yt-navigate-finish', function() {
        log('Navigation detected');
        currentVideoId = null;
        analysisComplete = false;
        detectedSponsors = [];
        currentNotificationIndex = 0;
        removeNotification();
        setTimeout(analyze, 3500);
    });

    log('SponsorJumper AI v2.1 loaded');
    setTimeout(analyze, 4000);

})();
