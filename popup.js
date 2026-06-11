document.addEventListener("DOMContentLoaded", () => {
    // Load and calculate stats
    chrome.storage.local.get(['profilesViewed', 'apiUsage'], (res) => {
        if (res.profilesViewed !== undefined) {
            document.getElementById('profilesViewed').textContent = res.profilesViewed;
        }
        if (res.apiUsage) {
            const r = res.apiUsage.reddit || 0;
            const a = res.apiUsage.arctic || 0;
            const p = res.apiUsage.pullpush || 0;
            
            const total = r + a + p;

            // Helper to calculate percentages
            const calcPct = (val) => total > 0 ? ((val / total) * 100).toFixed(1) + "%" : "0%";

            document.getElementById('redditCount').textContent = calcPct(r);
            document.getElementById('arcticCount').textContent = calcPct(a);
            document.getElementById('pullpushCount').textContent = calcPct(p);
        }
    });

    // Detect Firefox and unhide the rating link
    // (The Source Code link is now visible by default in the HTML)
    if (navigator.userAgent.includes("Firefox")) {
        document.getElementById('firefoxRateLink').style.display = 'block';
    }
});