chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchAPI") {
        fetch(request.url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => sendResponse({ data: data, success: true }))
            .catch(error => sendResponse({ error: error.message, success: false }));
        
        // Return true to indicate we will send a response asynchronously
        return true; 
    }
});