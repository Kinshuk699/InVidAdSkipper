/**
 * Main World Script - Extracts player data from YouTube's context
 * This runs in the page's context and can access window.ytInitialPlayerResponse
 */

(function() {
    'use strict';
    
    const log = (...args) => console.log('[SponsorJumper-MW]', ...args);

    function extractAndPost() {
        const data = {
            videoId: null,
            duration: null,
            captionsUrl: null
        };

        try {
            // Get from ytInitialPlayerResponse
            if (window.ytInitialPlayerResponse) {
                const pr = window.ytInitialPlayerResponse;
                data.videoId = pr.videoDetails?.videoId;
                data.duration = parseFloat(pr.videoDetails?.lengthSeconds || 0);
                
                const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                if (tracks && tracks.length > 0) {
                    // Prefer English
                    const track = tracks.find(t => t.languageCode === 'en') ||
                                  tracks.find(t => t.languageCode?.startsWith('en')) ||
                                  tracks[0];
                    data.captionsUrl = track?.baseUrl;
                }
            }

            // Fallback: ytplayer.config
            if (!data.captionsUrl && window.ytplayer?.config?.args) {
                const args = window.ytplayer.config.args;
                if (args.raw_player_response?.captions) {
                    const tracks = args.raw_player_response.captions.playerCaptionsTracklistRenderer?.captionTracks;
                    if (tracks && tracks.length > 0) {
                        data.captionsUrl = tracks[0].baseUrl;
                    }
                }
            }

        } catch (e) {
            log('Error extracting data:', e);
        }

        if (data.captionsUrl || data.videoId) {
            window.postMessage({ type: 'SPONSORJUMPER_PLAYER_DATA', data }, '*');
            log('Posted player data:', data.videoId, 'captions:', !!data.captionsUrl);
        }
    }

    // Run multiple times to catch async loading
    setTimeout(extractAndPost, 500);
    setTimeout(extractAndPost, 2000);
    setTimeout(extractAndPost, 4000);
})();
