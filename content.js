let hoverTimer;
let zIndexCounter = 999999;
const activeUsers = new Set(); 

document.addEventListener('mouseover', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href) return;

    const match = href.match(/\/(?:u|user)\/([^\/\?]+)/);
    if (match) {
        const username = match[1];
        if (activeUsers.has(username)) return;

        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
            createTooltip(e, username);
        }, 800);
    }
});

document.addEventListener('mouseout', (e) => {
    const link = e.target.closest('a');
    if (link) clearTimeout(hoverTimer);
});

async function createTooltip(event, username) {
    activeUsers.add(username);
    const tooltipId = 'reddit-tooltip-' + Date.now();

    const state = {
        id: tooltipId,
        username: username,
        activeTab: 'posts',
        posts: [],
        comments: [],
        postsCursor: null,      
        commentsCursor: null,   
        apiUsed: null,
        profileStatus: 'Checking...' // Default async state
    };

    const tooltip = document.createElement('div');
    tooltip.id = tooltipId;
    tooltip.className = 'reddit-history-window';
    tooltip.style.zIndex = ++zIndexCounter;
    
    let leftPos = event.clientX + 15;
    let topPos = event.clientY + 15;
    if (leftPos + 350 > window.innerWidth) leftPos = window.innerWidth - 360;
    if (topPos + 400 > window.innerHeight) topPos = window.innerHeight - 410;
    tooltip.style.left = `${leftPos}px`;
    tooltip.style.top = `${topPos}px`;

    tooltip.innerHTML = `
        <div class="tooltip-header" title="Click and drag to move">
            <div class="header-title">
                <img id="avatar-${tooltipId}" src="${chrome.runtime.getURL('icon16.png')}" alt="avatar">
                <h3>u/${username}</h3>
            </div>
            <button class="close-tooltip" data-id="${tooltipId}">X</button>
        </div>
        <div class="tooltip-tabs">
            <button class="tab-btn active" data-target="posts">Posts</button>
            <button class="tab-btn" data-target="comments">Comments</button>
        </div>
        <div class="history-content">Loading...</div>
        <button class="load-more" style="display: none;">Load Next 10</button>
    `;

    document.body.appendChild(tooltip);

    fetchAvatar(username, tooltipId);

    // --- ASYNC STATUS CHECK ---
    chrome.runtime.sendMessage({ action: "checkProfileStatus", username: username }, (res) => {
        if (res && res.status) {
            state.profileStatus = res.status;
            // Update the DOM text instantly without re-rendering the whole list
            const statusEl = tooltip.querySelector('.profile-status-text');
            if (statusEl) {
                statusEl.textContent = res.status;
                statusEl.style.color = res.status === 'Public' ? '#a4d68e' : '#ff585b';
            }
        }
    });

    const header = tooltip.querySelector('.tooltip-header');
    header.addEventListener('mousedown', (e) => {
        if (e.target.tagName.toLowerCase() === 'button') return;
        
        tooltip.style.zIndex = ++zIndexCounter; 
        let offsetX = e.clientX - tooltip.getBoundingClientRect().left;
        let offsetY = e.clientY - tooltip.getBoundingClientRect().top;

        function onMouseMove(event) {
            tooltip.style.left = `${event.clientX - offsetX}px`;
            tooltip.style.top = `${event.clientY - offsetY}px`;
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    tooltip.addEventListener('mousedown', () => {
        tooltip.style.zIndex = ++zIndexCounter;
    });

    tooltip.querySelector('.close-tooltip').addEventListener('click', () => {
        tooltip.remove();
        activeUsers.delete(username); 
    });

    const tabBtns = tooltip.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            tabBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            state.activeTab = e.target.getAttribute('data-target');
            renderList(tooltip, state);
        });
    });

    tooltip.querySelector('.load-more').addEventListener('click', () => fetchMoreData(tooltip, state));

    chrome.runtime.sendMessage({ action: "trackProfileView" });

    await fetchMoreData(tooltip, state, 'posts');
    await fetchMoreData(tooltip, state, 'comments');
    renderList(tooltip, state);
}

async function fetchAvatar(username, tooltipId) {
    const imgElement = document.getElementById(`avatar-${tooltipId}`);
    try {
        const res = await fetch(`https://www.reddit.com/user/${username}/about.json`);
        const json = await res.json();
        let avatarUrl = json.data.icon_img;
        
        if (avatarUrl) {
            avatarUrl = avatarUrl.replace(/&amp;/g, '&');
            imgElement.src = avatarUrl;
        }
    } catch (e) {
        console.log("Could not fetch avatar for", username);
    }
}

async function fetchMoreData(tooltip, state, specificTab = null) {
    const targetTab = specificTab || state.activeTab;
    const isPosts = targetTab === 'posts';
    
    const cursor = isPosts ? state.postsCursor : state.commentsCursor; 
    
    const contentDiv = tooltip.querySelector('.history-content');
    const loadMoreBtn = tooltip.querySelector('.load-more');
    
    if (itemsCount(state, targetTab) === 0) {
        contentDiv.innerHTML = "<div class='loading-text'>Fetching profile data...</div>";
    }
    loadMoreBtn.style.display = "none";

    try {
        const response = await chrome.runtime.sendMessage({ 
            action: "fetchUserHistory", 
            username: state.username, 
            type: targetTab, 
            cursor: cursor || null
        });
        
        if (!response || !response.success) {
            throw new Error("Failed to communicate with background script");
        }

        const newItems = response.data || [];
        state.apiUsed = response.apiUsed;

        if (newItems.length > 0) {
            if (isPosts) {
                state.posts = (state.posts || []).concat(newItems);
                state.postsCursor = response.cursors;
            } else {
                state.comments = (state.comments || []).concat(newItems);
                state.commentsCursor = response.cursors;
            }
        }
    } catch (error) {
        console.error("API Error", error);
        contentDiv.innerHTML = `<div class='empty-state' style='color: #ff585b;'>Failed to fetch data.</div>`;
        return; 
    }
    
    if (targetTab === state.activeTab || !specificTab) {
        renderList(tooltip, state);
    }
}

function itemsCount(state, tab) {
    return tab === 'posts' ? (state.posts || []).length : (state.comments || []).length;
}

function renderList(tooltip, state) {
    const container = tooltip.querySelector('.history-content');
    const loadMoreBtn = tooltip.querySelector('.load-more');
    const isPosts = state.activeTab === 'posts';
    const items = isPosts ? (state.posts || []) : (state.comments || []);

    container.innerHTML = "";

    if (state.apiUsed) {
        const statsHeader = document.createElement('div');
        statsHeader.style.padding = '8px 15px';
        statsHeader.style.fontSize = '11px';
        statsHeader.style.backgroundColor = '#272729';
        statsHeader.style.borderBottom = '1px solid #343536';
        statsHeader.style.color = '#a8aaab';
        statsHeader.style.display = 'flex';
        statsHeader.style.justifyContent = 'space-between';
        
        const statusColor = state.profileStatus === 'Public' ? '#a4d68e' : (state.profileStatus === 'Checking...' ? '#f6b26b' : '#ff585b');
        statsHeader.innerHTML = `
            <span>API: <strong>${state.apiUsed.toUpperCase()}</strong></span>
            <span>Status: <strong class="profile-status-text" style="color: ${statusColor}">${state.profileStatus}</strong></span>
        `;
        container.appendChild(statsHeader);
    }

    if (items.length === 0) {
        container.innerHTML += "<p class='empty-state'>No activity found.</p>";
        loadMoreBtn.style.display = "none";
        return;
    }

    items.forEach(item => {
        let url = "";
        let title = "";
        let bodyText = item.body || item.selftext || "";

        if (isPosts) {
            url = `https://redd.it/${item.id}`;
            title = `Post in r/${item.subreddit}: ${item.title || 'Untitled'}`;
        } else {
            const postId = item.link_id ? item.link_id.replace('t3_', '') : '';
            url = `https://reddit.com/comments/${postId}/_/${item.id}`;
            title = `Comment in r/${item.subreddit}`;
        }

        const a = document.createElement('a');
        a.href = url;
        a.target = "_blank";
        a.className = 'history-item';
        a.innerHTML = `
            <strong>${title}</strong>
            <p>${bodyText.substring(0, 150)}${bodyText.length > 150 ? '...' : ''}</p>
        `;
        container.appendChild(a);
    });

    loadMoreBtn.style.display = "block";
    loadMoreBtn.innerText = `Load Next 10 ${isPosts ? 'Posts' : 'Comments'}`;
}
