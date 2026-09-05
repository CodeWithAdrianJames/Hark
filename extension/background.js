/**
 * Hark for MS Teams - Background Service Worker
 * Handles external pairing messages from the Hark web dashboard,
 * sync state coordination, and extension lifecycle events.
 */

console.log('[Hark Background] Service worker initialized.');

// Default API endpoint
const DEFAULT_API_ENDPOINT = 'http://localhost:3000/api/ingest';

// Initialize defaults on install
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[Hark Background] Extension installed/updated: ${details.reason}`);

  chrome.storage.sync.get(['apiUrl', 'syncEnabled'], (result) => {
    if (!result.apiUrl) {
      chrome.storage.sync.set({
        apiUrl: DEFAULT_API_ENDPOINT,
        syncEnabled: true,
        isAutoIngestEnabled: true,
      });
    }
  });
});

// External web messaging listener for web dashboard pairing
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('[Hark Background] Received external message from:', sender.url, message);

  if (!message || typeof message !== 'object') {
    sendResponse({ error: 'Invalid message payload' });
    return false;
  }

  // 1. Health check / Installation ping
  if (message.type === 'HARK_PING') {
    const manifest = chrome.runtime.getManifest();
    sendResponse({
      status: 'installed',
      name: manifest.name,
      version: manifest.version,
    });
    return false;
  }

  // 2. Zero-config user pairing event
  if (message.type === 'HARK_SET_USER' && message.userId) {
    const rawUserId = String(message.userId).trim();
    const targetEndpoint =
      message.apiEndpoint ||
      message.apiUrl ||
      DEFAULT_API_ENDPOINT;

    const payload = {
      userId: rawUserId,
      apiUrl: targetEndpoint,
      apiEndpoint: targetEndpoint,
      syncEnabled: true,
      isAutoIngestEnabled: true,
      lastPairedAt: new Date().toISOString(),
    };

    // Save to chrome.storage.local
    chrome.storage.local.set(payload, () => {
      // Also mirror to chrome.storage.sync so popup.js and content.js have immediate access
      if (chrome.storage.sync) {
        chrome.storage.sync.set(payload, () => {
          console.log('[Hark Background] Successfully paired user to storage:', rawUserId);
          sendResponse({
            success: true,
            savedUserId: rawUserId,
            apiEndpoint: targetEndpoint,
            version: chrome.runtime.getManifest().version,
          });
        });
      } else {
        console.log('[Hark Background] Successfully saved to local storage:', rawUserId);
        sendResponse({
          success: true,
          savedUserId: rawUserId,
          apiEndpoint: targetEndpoint,
          version: chrome.runtime.getManifest().version,
        });
      }
    });

    return true; // Keep message channel open for async response
  }

  // 3. Query current extension pairing status
  if (message.type === 'HARK_GET_STATUS') {
    chrome.storage.local.get(['userId', 'apiUrl', 'lastPairedAt'], (localData) => {
      chrome.storage.sync.get(['userId', 'apiUrl'], (syncData) => {
        const effectiveUserId = localData.userId || syncData.userId || null;
        const effectiveApiUrl = localData.apiUrl || syncData.apiUrl || DEFAULT_API_ENDPOINT;
        sendResponse({
          status: 'ready',
          version: chrome.runtime.getManifest().version,
          userId: effectiveUserId,
          apiUrl: effectiveApiUrl,
          lastPairedAt: localData.lastPairedAt || null,
        });
      });
    });
    return true; // Keep channel open for async response
  }

  // Unknown message type
  sendResponse({ error: `Unknown message type: ${message.type}` });
  return false;
});
