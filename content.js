let hoverTimer;
let zIndexCounter = 999999;
const activeUsers = new Set(); // Prevent opening duplicates of the same user

document.addEventListener('mouseover', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href) return;

    const match = href.match(/\/(?:u|user)\/([^\/\?]+)/);
    if (match) {
        const username = match[1];
        
        // Don't open a new window if this user's window is already open
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

    // State isolated to this specific window
    const state = {
        id: tooltipId,
        username: username,
        activeTab: 'posts',
        posts: [],
        comments: [],
        lastPostDate: null,
        lastCommentDate: null
    };

    const tooltip = document.createElement('div');
    tooltip.id = tooltipId;
    tooltip.className = 'reddit-history-window';
    tooltip.style.zIndex = ++zIndexCounter;
    
    // Set initial position
    let leftPos = event.clientX + 15;
    let topPos = event.clientY + 15;
    if (leftPos + 350 > window.innerWidth) leftPos = window.innerWidth - 360;
    if (topPos + 400 > window.innerHeight) topPos = window.innerHeight - 410;
    tooltip.style.left = `${leftPos}px`;
    tooltip.style.top = `${topPos}px`;

    // Window UI Structure
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

    // Fetch the actual Reddit avatar
    fetchAvatar(username, tooltipId);

    // --- DRAG AND DROP LOGIC ---
    const header = tooltip.querySelector('.tooltip-header');
    header.addEventListener('mousedown', (e) => {
        // Prevent dragging if clicking the close button
        if (e.target.tagName.toLowerCase() === 'button') return;
        
        tooltip.style.zIndex = ++zIndexCounter; // Bring to front when clicked
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

    // --- BRING TO FRONT ON CLICK ---
    tooltip.addEventListener('mousedown', () => {
        tooltip.style.zIndex = ++zIndexCounter;
    });

    // --- EVENT LISTENERS FOR THIS WINDOW ---
    tooltip.querySelector('.close-tooltip').addEventListener('click', () => {
        tooltip.remove();
        activeUsers.delete(username); // Allow reopening later
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

    // Initial Data Fetch
    await fetchMoreData(tooltip, state, 'posts');
    await fetchMoreData(tooltip, state, 'comments');
    renderList(tooltip, state);
}

// Fetch user's actual profile avatar
async function fetchAvatar(username, tooltipId) {
    const imgElement = document.getElementById(`avatar-${tooltipId}`);
    try {
        const res = await fetch(`https://www.reddit.com/user/${username}/about.json`);
        const json = await res.json();
        let avatarUrl = json.data.icon_img;
        
        if (avatarUrl) {
            // Fix HTML encoding issues common in Reddit avatar URLs
            avatarUrl = avatarUrl.replace(/&amp;/g, '&');
            imgElement.src = avatarUrl;
        }
    } catch (e) {
        // Silently fail and keep the default extension icon if fetch fails
        console.log("Could not fetch avatar for", username);
    }
}

async function fetchMoreData(tooltip, state, specificTab = null) {
    const targetTab = specificTab || state.activeTab;
    const isPosts = targetTab === 'posts';
    const cursor = isPosts ? state.lastPostDate : state.lastCommentDate;
    
    const contentDiv = tooltip.querySelector('.history-content');
    const loadMoreBtn = tooltip.querySelector('.load-more');
    
    contentDiv.innerHTML = "<div class='loading-text'>Fetching data from Arctic Shift...</div>";
    loadMoreBtn.style.display = "none";

    let url = `https://arctic-shift.photon-reddit.com/api/${isPosts ? 'posts' : 'comments'}/search?author=${state.username}&limit=10&sort=desc`;
    if (cursor) {
        url += `&before=${cursor}`;
    }

    try {
        // --- NEW CODE: Send message to background.js instead of fetching directly ---
        const response = await chrome.runtime.sendMessage({ action: "fetchAPI", url: url });
        
        if (!response || !response.success) {
            throw new Error(response ? response.error : "Failed to communicate with background script");
        }

        const data = response.data;
        const items = Array.isArray(data) ? data : (data.data || []);

        if (items.length > 0) {
            const lastItemTime = items[items.length - 1].created_utc;
            if (isPosts) {
                state.posts.push(...items);
                state.lastPostDate = lastItemTime;
            } else {
                state.comments.push(...items);
                state.lastCommentDate = lastItemTime;
            }
        }
    } catch (error) {
        console.error("API Error", error);
        
        contentDiv.innerHTML = `
            <div class='empty-state' style='color: #ff585b;'>
                <strong>Connection Blocked</strong><br><br>
                Firefox requires host permissions to fetch data.<br><br>
                Go to <em>about:addons</em> > Click this extension > <em>Permissions</em> > Toggle on access for arctic-shift.
            </div>`;
        loadMoreBtn.style.display = "none";
        return; 
    }
    
    if (targetTab === state.activeTab || !specificTab) {
        renderList(tooltip, state);
    }
}
function renderList(tooltip, state) {
    const container = tooltip.querySelector('.history-content');
    const loadMoreBtn = tooltip.querySelector('.load-more');
    const isPosts = state.activeTab === 'posts';
    const items = isPosts ? state.posts : state.comments;

    container.innerHTML = "";

    if (items.length === 0) {
        container.innerHTML = "<p class='empty-state'>No activity found.</p>";
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
