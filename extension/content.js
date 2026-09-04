/**
 * Hark for MS Teams - Content Script
 * Injected into https://teams.microsoft.com/* to observe announcements and messages.
 */

console.log('[Hark] MS Teams companion content script initialized.');

// Check sync status from storage before observing
chrome.storage.sync.get(['syncEnabled', 'userId', 'apiUrl'], (config) => {
  if (!config.syncEnabled) {
    console.log('[Hark] Ingestion sync is currently disabled.');
    return;
  }

  console.log('[Hark] Sync active for user:', config.userId || '(unspecified)');
});
