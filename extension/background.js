/**
 * Hark for MS Teams - Background Service Worker
 * Handles external pairing messages from the Hark web dashboard,
 * sync state coordination, iframe assignment ingestion relaying, and extension lifecycle events.
 */

console.log('[Hark Background] Service worker initialized.');

// Default API endpoint
const DEFAULT_API_ENDPOINT = 'http://localhost:3000/api/ingest';

// Allowed external origins for dashboard pairing (SEC-01)
const ALLOWED_EXTERNAL_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://your-production-domain.com',
];

function isAllowedExternalOrigin(sender) {
  let origin = sender?.origin;
  if (!origin && sender?.url) {
    try {
      origin = new URL(sender.url).origin;
    } catch {
      return false;
    }
  }
  return origin ? ALLOWED_EXTERNAL_ORIGINS.includes(origin) : false;
}

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

    // Retrieve pending sync from session storage (survives Service Worker termination - REL-01)
    const retrieveSession = new Promise((resolve) => {
      if (chrome.storage.session) {
        chrome.storage.session.get(['pendingSync'], (d) => resolve(d?.pendingSync || {}));
      } else {
        resolve({});
      }
    });

    retrieveSession.then((pendingSync) => {
      chrome.storage.local.get(['userId', 'apiUrl', 'apiKey'], (localData) => {
        chrome.storage.sync.get(['userId', 'apiUrl', 'apiKey'], async (syncData) => {
          const effectiveUserId =
            message.userId ||
            pendingSync.userId ||
            localData.userId ||
            syncData.userId ||
            '';

          const effectiveApiUrl =
            message.apiEndpoint ||
            pendingSync.apiEndpoint ||
            localData.apiUrl ||
            syncData.apiUrl ||
            DEFAULT_API_ENDPOINT;

          const effectiveApiKey =
            message.apiKey ||
            pendingSync.apiKey ||
            localData.apiKey ||
            syncData.apiKey ||
            '';

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

            const headers = {
              'Content-Type': 'application/json',
            };
            if (effectiveApiKey) {
              headers['Authorization'] = `Bearer ${effectiveApiKey}`;
            }

            const res = await fetch(effectiveApiUrl, {
              method: 'POST',
              headers,
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

            // Clear pending sync in session storage
            if (chrome.storage.session) {
              try {
                await chrome.storage.session.remove('pendingSync');
              } catch {
                // Ignore removal error
              }
            }

            const totalProcessed = (data.inserted ?? 0) + (data.updated ?? 0);
            const responsePayload = {
              status: 'SUCCESS',
              count: totalProcessed || rawAssignments.length,
              inserted: data.inserted ?? 0,
              updated: data.updated ?? 0,
              message: `Synced ${totalProcessed || rawAssignments.length} upcoming assignments across all classes`,
            };

            // Proactively broadcast resolution to active Hark dashboard tabs (REL-01)
            chrome.tabs.query(
              {
                url: [
                  'http://localhost:3000/*',
                  'http://127.0.0.1:3000/*',
                  'https://your-production-domain.com/*',
                ],
              },
              (dashTabs) => {
                if (dashTabs && dashTabs.length > 0) {
                  dashTabs.forEach((tab) => {
                    chrome.tabs.sendMessage(
                      tab.id,
                      {
                        type: 'HARK_SYNC_COMPLETED',
                        status: 'SUCCESS',
                        count: totalProcessed || rawAssignments.length,
                        inserted: data.inserted ?? 0,
                        updated: data.updated ?? 0,
                        message: responsePayload.message,
                        data,
                      },
                      () => {
                        if (chrome.runtime.lastError) {
                          // Ignore if listener not yet registered in tab
                        }
                      }
                    );
                  });
                }
              }
            );

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
    });

    return true; // Keep message channel open for async response
  }

  // 2. Relay NAVIGATE_TO_ASSIGNMENT from internal components
  if (message?.type === 'NAVIGATE_TO_ASSIGNMENT') {
    handleNavigateToAssignment(message, sendResponse);
    return true;
  }

  return false;
});

// External web messaging listener for web dashboard pairing
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('[Hark Background] Received external message from:', sender.origin || sender.url, message);

  // 0. Strict external origin validation (SEC-01)
  if (!isAllowedExternalOrigin(sender)) {
    console.warn(
      '[Hark Background] Blocked unauthorized external message from origin:',
      sender?.origin || sender?.url
    );
    sendResponse({ error: 'Unauthorized: External origin is not allowed.' });
    return false;
  }

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
    const effectiveApiKey =
      message.apiKey ||
      message.token ||
      '';

    const payload = {
      userId: rawUserId,
      apiUrl: targetEndpoint,
      apiEndpoint: targetEndpoint,
      apiKey: effectiveApiKey,
      syncEnabled: true,
      isAutoIngestEnabled: true,
      lastPairedAt: new Date().toISOString(),
    };

    // Save to chrome.storage.local
    chrome.storage.local.set(payload, () => {
      // Also mirror to chrome.storage.sync so popup.js and content.js have immediate access
      if (chrome.storage.sync) {
        chrome.storage.sync.set(payload, () => {
          console.log('[Hark Background] Successfully paired user and API key to storage:', rawUserId);
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

  // 4. Cross-tab trigger for global assignments hub auto-sync (REL-01)
  if (message.type === 'HARK_TRIGGER_AUTO_SYNC') {
    chrome.storage.local.get(['userId', 'apiUrl', 'apiKey'], (localData) => {
      chrome.storage.sync.get(['userId', 'apiUrl', 'apiKey'], (syncData) => {
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
        const effectiveApiKey =
          message.apiKey ||
          localData.apiKey ||
          syncData.apiKey ||
          '';

        // Query open browser tabs for Teams
        chrome.tabs.query({ url: '*://teams.microsoft.com/*' }, async (tabs) => {
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
            `[Hark Background] Found ${tabs.length} Teams tab(s). Relaying SCAN_ASSIGNMENTS_HUB to Tab ${activeTab.id}...`
          );

          // Persist pending sync state in session storage so it survives SW termination (REL-01)
          const syncId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const syncState = {
            syncId,
            userId: effectiveUserId,
            apiEndpoint: targetEndpoint,
            apiKey: effectiveApiKey,
            tabId: activeTab.id,
            startedAt: Date.now(),
          };

          if (chrome.storage.session) {
            try {
              await chrome.storage.session.set({ pendingSync: syncState });
            } catch (err) {
              console.warn('[Hark Background] Could not set pendingSync in storage.session:', err);
            }
          }

          let hasReplied = false;
          const replyOnce = (res) => {
            if (!hasReplied) {
              hasReplied = true;
              sendResponse(res);
            }
          };

          // Relay trigger to Teams tab
          chrome.tabs.sendMessage(
            activeTab.id,
            {
              type: 'SCAN_ASSIGNMENTS_HUB',
              userId: effectiveUserId,
              apiEndpoint: targetEndpoint,
              syncId,
            },
            (contentResponse) => {
              if (chrome.runtime.lastError) {
                console.warn(
                  '[Hark Background] Content script communication note:',
                  chrome.runtime.lastError.message
                );
              }

              // If the content script already found items directly in this scan
              if (contentResponse && contentResponse.status === 'SUCCESS') {
                replyOnce(contentResponse);
              }
            }
          );

          // Safety timeout to ensure response channel concludes cleanly
          setTimeout(() => {
            replyOnce({
              status: 'SUCCESS',
              count: 0,
              message: 'Sync dispatched to Teams.',
            });
          }, 7000);
        });
      });
    });

    return true; // Keep message channel open for async response
  }

  // 5. Extension-driven tab & card focus bridge
  if (message.type === 'NAVIGATE_TO_ASSIGNMENT') {
    handleNavigateToAssignment(message, sendResponse);
    return true;
  }

  // Unknown message type
  sendResponse({ error: `Unknown message type: ${message.type}` });
  return false;
});

/**
 * Background Worker Navigation Bridge:
 * Query existing tabs for URL patterns matching: "*://teams.microsoft.com/*".
 * If Teams tab exists:
 *   1. Activate and focus tab & window.
 *   2. Send HARK_FOCUS_ASSIGNMENT message to Teams content script.
 *   3. Respond with { success: true, method: "tab_focus" }.
 * If no Teams tab exists:
 *   1. Open new tab to "https://teams.microsoft.com/v2/".
 *   2. Store pending navigation target in chrome.storage.local.
 *   3. Respond with { success: true, method: "tab_created" }.
 */
async function handleNavigateToAssignment(request, sendResponse) {
  console.log('[Hark Background] Navigating to assignment:', request);
  const assignmentId = request.assignmentId || request.id || null;
  const classId = request.classId || request.course_id || null;
  const title = request.title || '';

  try {
    const tabs = await chrome.tabs.query({
      url: ['*://teams.microsoft.com/*'],
    });

    if (tabs && tabs.length > 0) {
      // Prioritize active tab, then tabs with assignments in URL
      const teamsTab =
        tabs.find((t) => t.active) ||
        tabs.find((t) => t.url && t.url.includes('assignments')) ||
        tabs[0];

      console.log(
        `[Hark Background] Found open Teams tab (${teamsTab.id}: ${teamsTab.url}). Activating and focusing...`
      );

      // 1. Activate tab and focus window
      await chrome.tabs.update(teamsTab.id, { active: true });
      if (teamsTab.windowId) {
        await chrome.windows.update(teamsTab.windowId, { focused: true });
      }

      // 2. Send HARK_FOCUS_ASSIGNMENT to content script
      chrome.tabs.sendMessage(
        teamsTab.id,
        {
          type: 'HARK_FOCUS_ASSIGNMENT',
          assignmentId,
          classId,
          title,
        },
        (contentResponse) => {
          if (chrome.runtime.lastError) {
            console.warn(
              '[Hark Background] Note delivering HARK_FOCUS_ASSIGNMENT to tab:',
              chrome.runtime.lastError.message
            );
          } else {
            console.log('[Hark Background] Content response from Teams tab:', contentResponse);
          }
        }
      );

      sendResponse({ success: true, method: 'tab_focus' });
    } else {
      // No Teams tab open: store pending navigation target and open https://teams.microsoft.com/v2/
      console.log(
        '[Hark Background] No open Teams tab found. Saving pending target and opening https://teams.microsoft.com/v2/...'
      );

      await chrome.storage.local.set({
        pendingNavigationTarget: {
          assignmentId,
          classId,
          title,
          timestamp: Date.now(),
        },
      });

      await chrome.tabs.create({
        url: 'https://teams.microsoft.com/v2/',
        active: true,
      });

      sendResponse({ success: true, method: 'tab_created' });
    }
  } catch (err) {
    console.error('[Hark Background] Error handling NAVIGATE_TO_ASSIGNMENT:', err);
    sendResponse({ success: false, error: err.message });
  }
}
