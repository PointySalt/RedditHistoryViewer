chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['profilesViewed', 'apiUsage'], (res) => {
        if (res.profilesViewed === undefined) {
            chrome.storage.local.set({
                profilesViewed: 0,
                apiUsage: { reddit: 0, arctic: 0, pullpush: 0 }
            });
        }
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchUserHistory") {
        fetchFastHistory(request).then(sendResponse);
        return true; 
    } else if (request.action === "checkProfileStatus") {
        checkRedditStatus(request).then(sendResponse);
        return true;
    } else if (request.action === "trackProfileView") {
        chrome.storage.local.get(['profilesViewed'], (res) => {
            chrome.storage.local.set({ profilesViewed: (res.profilesViewed || 0) + 1 });
        });
    }
});

// Returns the FASTEST API that has data
async function fetchFastHistory({ username, type, cursor }) {
    const isPosts = type === 'posts';
    
    const urls = {
        reddit: `https://www.reddit.com/user/${username}/${isPosts ? 'submitted' : 'comments'}.json?limit=10${cursor && cursor.reddit ? `&after=${cursor.reddit}` : ''}`,
        arctic: `https://arctic-shift.photon-reddit.com/api/${type}/search?author=${username}&limit=10${cursor && cursor.arctic ? `&before=${cursor.arctic}` : ''}`,
        pullpush: `https://api.pullpush.io/reddit/search/${isPosts ? 'submission' : 'comment'}/?author=${username}&size=10${cursor && cursor.pullpush ? `&before=${cursor.pullpush}` : ''}`
    };

    const promises = {
        reddit: fetchAPI('reddit', urls.reddit),
        arctic: fetchAPI('arctic', urls.arctic),
        pullpush: fetchAPI('pullpush', urls.pullpush)
    };

    // Custom race: Resolves immediately on the FIRST successful non-empty data return
    const result = await new Promise((resolve) => {
        let failures = 0;
        const checkDone = () => { if (failures === 3) resolve(null); }; // All 3 failed or empty

        const handleResponse = (api, res) => {
            if (res && res.data && res.data.length > 0) {
                // Ensure cursors are scoped to the winning API
                let cursorObj = {};
                cursorObj[api] = res.after;
                resolve({ apiUsed: api, data: res.data, cursors: cursorObj }); 
            } else {
                failures++;
                checkDone();
            }
        };

        promises.arctic.then(res => handleResponse('arctic', res));
        promises.pullpush.then(res => handleResponse('pullpush', res));
        promises.reddit.then(res => handleResponse('reddit', res));
    });

    if (result) {
        chrome.storage.local.get(['apiUsage'], (res) => {
            const usage = res.apiUsage || { reddit: 0, arctic: 0, pullpush: 0 };
            usage[result.apiUsed]++;
            chrome.storage.local.set({ apiUsage: usage });
        });
        return { success: true, ...result };
    }

    return { success: false, data: [] };
}


// Dedicated async status checker
async function checkRedditStatus({ username }) {
    try {
        // Check official Reddit API for ANY public activity (just asking for 1 item to be fast)
        const [postsRes, commentsRes] = await Promise.allSettled([
            fetch(`https://www.reddit.com/user/${username}/submitted.json?limit=1`).then(r => {
                if (!r.ok) throw new Error('Blocked/Shadowbanned');
                return r.json();
            }),
            fetch(`https://www.reddit.com/user/${username}/comments.json?limit=1`).then(r => {
                if (!r.ok) throw new Error('Blocked/Shadowbanned');
                return r.json();
            })
        ]);

        let hasPublicActivity = false;

        // If Reddit returns at least 1 post or comment, the history is Public
        if (postsRes.status === 'fulfilled' && postsRes.value?.data?.children?.length > 0) {
            hasPublicActivity = true;
        }
        if (commentsRes.status === 'fulfilled' && commentsRes.value?.data?.children?.length > 0) {
            hasPublicActivity = true;
        }

        return { status: hasPublicActivity ? 'Public' : 'Hidden/Deleted' };
    } catch (e) {
        // Network failures or total account nukes
        return { status: 'Hidden/Deleted' };
    }
}
async function fetchAPI(apiName, url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        
        let normalizedData = [];
        let afterCursor = null;

        if (apiName === 'reddit' && json.data && json.data.children) {
            normalizedData = json.data.children.map(child => child.data);
            afterCursor = json.data.after;
        } else if (apiName === 'arctic' || apiName === 'pullpush') {
            normalizedData = Array.isArray(json) ? json : (json.data || []);
            if (normalizedData.length > 0) {
                afterCursor = normalizedData[normalizedData.length - 1].created_utc;
            }
        }

        return { data: normalizedData, after: afterCursor };
    } catch (e) {
        return null; 
    }
}
