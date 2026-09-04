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
const testBtn = document.getElementById('testBtn');
const saveBtn = document.getElementById('saveBtn');
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

  storage.set({ apiUrl, userId, syncEnabled }, () => {
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
  storage.set({ syncEnabled: syncToggle.checked }, () => {
    showToast(
      syncToggle.checked ? 'Sync enabled.' : 'Sync paused.',
      'success'
    );
  });
});
