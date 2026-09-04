/**
 * Hark for MS Teams - Popup Controller
 * Manages user settings, sync state, and API connectivity checks.
 */

const DEFAULT_API_URL = 'http://localhost:3000/api/ingest';

// Safe storage wrapper (falls back to localStorage if chrome.storage is not available)
const storage = {
  get: (keys, callback) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(keys, callback);
    } else {
      const result = {};
      keys.forEach((key) => {
        const item = localStorage.getItem(`hark_${key}`);
        result[key] = item ? JSON.parse(item) : undefined;
      });
      callback(result);
    }
  },
  set: (items, callback) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(items, callback);
    } else {
      Object.entries(items).forEach(([k, v]) => {
        localStorage.setItem(`hark_${k}`, JSON.stringify(v));
      });
      if (callback) callback();
    }
  },
};

// DOM Elements
const apiUrlInput = document.getElementById('apiUrl');
const userIdInput = document.getElementById('userId');
const syncToggle = document.getElementById('syncToggle');
const scanNowBtn = document.getElementById('scanNowBtn');
const scanCountBadge = document.getElementById('scanCountBadge');
const scanStatusMsg = document.getElementById('scanStatusMsg');
const testBtn = document.getElementById('testBtn');
const saveBtn = document.getElementById('saveBtn');
const resetCacheBtn = document.getElementById('resetCacheBtn');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const toast = document.getElementById('toast');

let toastTimeout = null;

/**
 * Updates the visual status badge
 * @param {'connected' | 'disconnected' | 'testing'} status
 */
function updateStatus(status) {
  statusBadge.className = 'status-badge';

  if (status === 'connected') {
    statusBadge.classList.add('status-connected');
    statusText.textContent = 'Connected';
  } else if (status === 'testing') {
    statusBadge.classList.add('status-testing');
    statusText.textContent = 'Testing...';
  } else {
    statusBadge.classList.add('status-disconnected');
    statusText.textContent = 'Disconnected';
  }
}

/**
 * Shows an ephemeral toast notification
 * @param {string} message
 * @param {'success' | 'error'} type
 */
function showToast(message, type = 'success') {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  toast.style.display = 'flex';

  toastTimeout = setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

/**
 * Loads stored settings and initializes the UI
 */
function loadSettings() {
  storage.get(
    ['apiUrl', 'userId', 'syncEnabled', 'connectionStatus'],
    (data) => {
      apiUrlInput.value = data.apiUrl || DEFAULT_API_URL;
      userIdInput.value = data.userId || '';
      syncToggle.checked = data.syncEnabled !== false; // Default true

      if (data.connectionStatus) {
        updateStatus(data.connectionStatus);
      } else {
        updateStatus('disconnected');
      }

      // Load previous scan activity if saved
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['hark_last_scan_stats'], (res) => {
          const stats = res?.hark_last_scan_stats;
          if (stats && scanCountBadge && scanStatusMsg) {
            scanCountBadge.className = 'status-badge status-connected';
            scanCountBadge.textContent = `${stats.captured || 0} captured`;
            const details = [];
            if (stats.created > 0) details.push(`${stats.created} new`);
            if (stats.updated > 0) details.push(`${stats.updated} updated`);
            const detailText = details.length > 0 ? ` (${details.join(', ')})` : '';
            scanStatusMsg.textContent = `Last run at ${stats.timestamp || 'recently'}: ${stats.captured || 0} captured${detailText}.`;
          }
        });
      }
    }
  );
}

/**
 * Persists current settings to storage
 * @param {boolean} notify - Whether to display a toast confirmation
 */
function saveSettings(notify = true) {
  const apiUrl = (apiUrlInput.value || '').trim() || DEFAULT_API_URL;
  const userId = (userIdInput.value || '').trim();
  const syncEnabled = syncToggle.checked;

  storage.set({ apiUrl, userId, syncEnabled, isAutoIngestEnabled: syncEnabled }, () => {
    if (notify) {
      showToast('Settings saved successfully.', 'success');
    }
  });
}

/**
 * Tests connection to the ingest endpoint
 */
async function testConnection() {
  const apiUrl = (apiUrlInput.value || '').trim();
  const userId = (userIdInput.value || '').trim();

  if (!apiUrl) {
    showToast('Please specify a valid Ingest API URL.', 'error');
    apiUrlInput.focus();
    return;
  }

  if (!userId) {
    showToast('Please enter your User ID.', 'error');
    userIdInput.focus();
    return;
  }

  // Update UI to testing state
  updateStatus('testing');
  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';

  // Send an empty message probe to test network reachability & user authentication
  const probePayload = {
    userId: userId,
    channelName: 'extension-ping-test',
    messages: [],
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(probePayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      updateStatus('connected');
      storage.set({ connectionStatus: 'connected' });
      showToast('Connection verified! API is online.', 'success');
    } else {
      const errText = await response.text();
      let message = `Server returned status ${response.status}`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error) message = parsed.error;
      } catch {
        // Use default message
      }

      updateStatus('disconnected');
      storage.set({ connectionStatus: 'disconnected' });
      showToast(`Connection failed: ${message}`, 'error');
    }
  } catch (err) {
    updateStatus('disconnected');
    storage.set({ connectionStatus: 'disconnected' });

    const isAbort = err.name === 'AbortError';
    showToast(
      isAbort
        ? 'Connection timed out. Check your URL.'
        : 'Cannot reach server. Ensure Next.js is running.',
      'error'
    );
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', loadSettings);

saveBtn.addEventListener('click', () => saveSettings(true));

testBtn.addEventListener('click', async () => {
  saveSettings(false);
  await testConnection();
});

syncToggle.addEventListener('change', () => {
  storage.set(
    { syncEnabled: syncToggle.checked, isAutoIngestEnabled: syncToggle.checked },
    () => {
      showToast(
        syncToggle.checked ? 'Sync enabled.' : 'Sync paused.',
        'success'
      );
    }
  );
});

// Force Scan Current Channel Button Handler
if (scanNowBtn) {
  scanNowBtn.addEventListener('click', async () => {
    scanNowBtn.disabled = true;
    const originalText = scanNowBtn.innerHTML;
    scanNowBtn.innerHTML = 'Scanning Channel...';

    if (scanCountBadge) {
      scanCountBadge.className = 'status-badge status-testing';
      scanCountBadge.textContent = 'Scanning...';
    }
    if (scanStatusMsg) {
      scanStatusMsg.textContent = 'Scanning visible DOM for Assignment Bot cards...';
    }

    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
      showToast('Chrome extension environment not detected.', 'error');
      scanNowBtn.disabled = false;
      scanNowBtn.innerHTML = originalText;
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab || !activeTab.id) {
        showToast('No active tab found. Please navigate to MS Teams.', 'error');
        scanNowBtn.disabled = false;
        scanNowBtn.innerHTML = originalText;
        return;
      }

      chrome.tabs.sendMessage(
        activeTab.id,
        { action: 'scanNow', forceBypassDedup: true },
        (response) => {
          scanNowBtn.disabled = false;
          scanNowBtn.innerHTML = originalText;

          if (chrome.runtime.lastError || !response) {
            if (scanCountBadge) {
              scanCountBadge.className = 'status-badge status-disconnected';
              scanCountBadge.textContent = 'Not Ready';
            }
            if (scanStatusMsg) {
              scanStatusMsg.textContent = 'Please make sure Microsoft Teams is open in this tab and refresh the page.';
            }
            showToast('Please open MS Teams and refresh the tab.', 'error');
            return;
          }

          if (response.success) {
            const captured = response.capturedCount || 0;
            const created = response.tasksCreated || 0;
            const updated = response.tasksUpdated || 0;

            if (scanCountBadge) {
              scanCountBadge.className = 'status-badge status-connected';
              scanCountBadge.textContent = `${captured} captured`;
            }
            if (scanStatusMsg) {
              const details = [];
              if (created > 0) details.push(`${created} new`);
              if (updated > 0) details.push(`${updated} updated`);
              const detailText = details.length > 0 ? ` (${details.join(', ')})` : '';
              scanStatusMsg.textContent = `${captured} assignment(s) found on screen${detailText}.`;
            }

            if (chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({
                hark_last_scan_stats: {
                  captured,
                  created,
                  updated,
                  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                },
              });
            }

            const toastParts = [];
            if (created > 0) toastParts.push(`${created} new`);
            if (updated > 0) toastParts.push(`${updated} updated`);
            const toastMsg = toastParts.length > 0 ? toastParts.join(', ') : 'All assignments up to date';
            showToast(`Scan complete! ${captured} captured (${toastMsg}).`, 'success');
          } else {
            if (scanCountBadge) {
              scanCountBadge.className = 'status-badge status-disconnected';
              scanCountBadge.textContent = 'Error';
            }
            if (scanStatusMsg) {
              scanStatusMsg.textContent = response.error || 'Scan encountered an error.';
            }
            showToast(`Scan failed: ${response.error || 'Unknown error'}`, 'error');
          }
        }
      );
    });
  });
}

// Reset Sync Cache Button Handler
if (resetCacheBtn) {
  resetCacheBtn.addEventListener('click', () => {
    resetCacheBtn.disabled = true;
    resetCacheBtn.textContent = 'Clearing Cache...';

    const onComplete = () => {
      // Notify active MS Teams tab to reset its in-memory Set
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(
              tabs[0].id,
              { action: 'clearCache', type: 'HARK_FORCE_RESCAN' },
              () => {
                if (chrome.runtime.lastError) {
                  // Suppress error if active tab is not MS Teams
                }
              }
            );
          }
        });
      }

      if (scanCountBadge) {
        scanCountBadge.className = 'status-badge';
        scanCountBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        scanCountBadge.style.color = '#fca5a5';
        scanCountBadge.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        scanCountBadge.textContent = 'Cache Cleared';
      }
      if (scanStatusMsg) {
        scanStatusMsg.textContent = 'Sync cache reset. You can now re-scan all visible items.';
      }

      showToast('Sync cache reset! Missed items can now be re-indexed.', 'success');
      resetCacheBtn.disabled = false;
      resetCacheBtn.textContent = 'Reset Sync Cache';
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(
        ['syncedMessageIds', 'hark_synced_ids', 'hark_last_scan_stats'],
        onComplete
      );
    } else {
      localStorage.removeItem('syncedMessageIds');
      localStorage.removeItem('hark_synced_ids');
      localStorage.removeItem('hark_last_scan_stats');
      onComplete();
    }
  });
}
