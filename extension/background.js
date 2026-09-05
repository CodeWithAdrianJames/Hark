/**
 * Hark for MS Teams - Background Service Worker
 * Handles external pairing messages from the Hark web dashboard,
 * sync state coordination, iframe assignment ingestion relaying, and extension lifecycle events.
 */

console.log('[Hark Background] Service worker initialized.');

// Default API endpoint
const DEFAULT_API_ENDPOINT = 'http://localhost:3000/api/ingest';

// Pending auto-sync resolvers waiting for assignments extraction from Teams frames
let pendingSyncResolvers = [];

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

/**
 * Handles internal extension messages from content scripts (both top frame and assignment iframes)
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(
    '[Hark Background] Received internal runtime message:',
    message?.type,
    'from:',
    sender.url || (sender.tab ? `tab ${sender.tab.id}` : 'unknown')
  );

  // 1. Relay extracted assignments from MS Teams Assignments iframe directly to Hark backend
  if (message?.type === 'HARK_ASSIGNMENTS_FOUND') {
    const rawAssignments = Array.isArray(message.assignments) ? message.assignments : [];
    console.log(
      `[Hark Background] Processing HARK_ASSIGNMENTS_FOUND (${rawAssignments.length} item(s)) from ${sender.url || 'iframe'}`
    );

    if (rawAssignments.length === 0) {
      sendResponse({ status: 'EMPTY', count: 0 });
      return false;
    }

    // Resolve userId and apiUrl from storage or active pairing
    chrome.storage.local.get(['userId', 'apiUrl'], (localData) => {
      chrome.storage.sync.get(['userId', 'apiUrl'], async (syncData) => {
        const effectiveUserId =
          message.userId ||
          pendingSyncResolvers[0]?.userId ||
          localData.userId ||
          syncData.userId ||
          '';

        const effectiveApiUrl =
          message.apiEndpoint ||
          pendingSyncResolvers[0]?.apiEndpoint ||
          localData.apiUrl ||
          syncData.apiUrl ||
          DEFAULT_API_ENDPOINT;

        if (!effectiveUserId) {
          console.warn(
            '[Hark Background] Cannot ingest assignments: No userId configured in storage or message.'
          );
          sendResponse({
            status: 'ERROR',
            error: 'No userId configured. Please pair Hark dashboard with the extension.',
          });
          return;
        }

        try {
          console.log(
            `[Hark Background] Relaying ${rawAssignments.length} assignments to ${effectiveApiUrl} for user: ${effectiveUserId}...`
          );

          const res = await fetch(effectiveApiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userId: effectiveUserId,
              timezone: 'Asia/Manila',
              assignments: rawAssignments,
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Ingest HTTP ${res.status}: ${errText}`);
          }

          const data = await res.json();
          console.log('[Hark Background] Assignments successfully ingested into Neon:', data);

          const totalProcessed = (data.inserted ?? 0) + (data.updated ?? 0);
          const responsePayload = {
            status: 'SUCCESS',
            count: totalProcessed || rawAssignments.length,
            inserted: data.inserted ?? 0,
            updated: data.updated ?? 0,
            message: `Synced ${totalProcessed || rawAssignments.length} upcoming assignments across all classes`,
          };

          // Resolve any pending web dashboard auto-sync requests
          if (pendingSyncResolvers.length > 0) {
            console.log(
              `[Hark Background] Resolving ${pendingSyncResolvers.length} pending dashboard auto-sync requests.`
            );
            const resolversToCall = [...pendingSyncResolvers];
            pendingSyncResolvers = [];
            resolversToCall.forEach((r) => r.resolve(responsePayload));
          }

          sendResponse({
            status: 'SUCCESS',
            count: totalProcessed,
            data,
          });
        } catch (err) {
          console.error('[Hark Background] Error posting assignments to /api/ingest:', err);
          sendResponse({
            status: 'ERROR',
            error: err.message,
          });
        }
      });
    });

    return true; // Keep message channel open for async response
  }

  return false;
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

  // 4. Cross-tab trigger for global assignments hub auto-sync
  if (message.type === 'HARK_TRIGGER_AUTO_SYNC') {
    chrome.storage.local.get(['userId', 'apiUrl'], (localData) => {
      chrome.storage.sync.get(['userId', 'apiUrl'], (syncData) => {
        const effectiveUserId =
          message.userId ||
          localData.userId ||
          syncData.userId ||
          '';
        const targetEndpoint =
          message.apiEndpoint ||
          localData.apiUrl ||
          syncData.apiUrl ||
          DEFAULT_API_ENDPOINT;

        // Query open browser tabs for Teams
        chrome.tabs.query({ url: '*://teams.microsoft.com/*' }, (tabs) => {
          if (!tabs || tabs.length === 0) {
            console.log('[Hark Background] No open MS Teams tabs found.');
            sendResponse({
              status: 'NO_TEAMS',
              message: 'Teams not open (Open Teams to sync)',
            });
            return;
          }

          // Prioritize active or focused tab, otherwise use first tab
          const activeTab = tabs.find((t) => t.active) || tabs[0];
          console.log(
            `[Hark Background] Found ${tabs.length} Teams tab(s). Registering auto-sync listener and relaying SCAN_ASSIGNMENTS_HUB to Tab ${activeTab.id}...`
          );

          // Track this pending auto-sync resolver
          let isResolved = false;
          const syncTimeout = setTimeout(() => {
            if (!isResolved) {
              isResolved = true;
              pendingSyncResolvers = pendingSyncResolvers.filter((r) => r.id !== resolverEntry.id);
              console.log('[Hark Background] Auto-sync wait period concluded.');
              sendResponse({
                status: 'SUCCESS',
                count: 0,
                message: 'Sync complete. No new assignments found.',
              });
            }
          }, 8000);

          const resolverEntry = {
            id: Date.now() + Math.random(),
            userId: effectiveUserId,
            apiEndpoint: targetEndpoint,
            resolve: (res) => {
              if (!isResolved) {
                isResolved = true;
                clearTimeout(syncTimeout);
                sendResponse(res);
              }
            },
          };

          pendingSyncResolvers.push(resolverEntry);

          // Relay trigger to Teams tab
          chrome.tabs.sendMessage(
            activeTab.id,
            {
              type: 'SCAN_ASSIGNMENTS_HUB',
              userId: effectiveUserId,
              apiEndpoint: targetEndpoint,
            },
            (contentResponse) => {
              if (chrome.runtime.lastError) {
                console.warn(
                  '[Hark Background] Content script communication note:',
                  chrome.runtime.lastError.message
                );
                // Don't immediately fail; iframe might report HARK_ASSIGNMENTS_FOUND independently
                return;
              }

              console.log(
                '[Hark Background] Immediate content response from Tab:',
                contentResponse
              );

              // If the content script already found items directly in this scan
              if (contentResponse && contentResponse.count > 0 && contentResponse.status === 'SUCCESS') {
                resolverEntry.resolve(contentResponse);
              }
            }
          );
        });
      });
    });

    return true; // Keep message channel open for async response
  }

  // Unknown message type
  sendResponse({ error: `Unknown message type: ${message.type}` });
  return false;
});
