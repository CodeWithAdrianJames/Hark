/**
 * Hark for MS Teams - Page-Context Network Interceptor (injected.js)
 * Intercepts window.fetch and XMLHttpRequest in the main execution world
 * to capture internal Teams chat/channel payloads and forward them to content.js.
 */

(function () {
  const INTERCEPT_LOG_STYLE =
    'color: #818cf8; font-weight: bold; background: #0f172a; padding: 2px 6px; border-radius: 3px;';

  function logIntercept(msg, ...args) {
    console.log(`%c[Hark Network Intercept]%c ${msg}`, INTERCEPT_LOG_STYLE, 'color: inherit;', ...args);
  }

  logIntercept('Network interceptor initialized in Teams execution context.');

  /**
   * Helper: Strips HTML tags and normalizes whitespace from Teams rich-text messages
   */
  function stripHtml(html) {
    if (!html || typeof html !== 'string') return '';
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    } catch {
      return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  /**
   * Helper: Determines if a network URL corresponds to Teams chat or conversation service
   * Matches any endpoint containing 'conversations', 'messages', 'threads', or 'chatsvc' regardless of subdomain.
   */
  function isTeamsChatUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('conversations') ||
      lower.includes('messages') ||
      lower.includes('threads') ||
      lower.includes('chatsvc')
    );
  }

  /**
   * Helper: Extracts standard message objects from various Teams JSON structures
   */
  function extractMessagesFromJson(data) {
    if (!data || typeof data !== 'object') return [];

    const rawCandidates = [];

    // Format 1: Standard Chat Service list ({ messages: [...] })
    if (Array.isArray(data.messages)) {
      rawCandidates.push(...data.messages);
    }

    // Format 2: OData / Graph / Middle-tier responses ({ value: [...] } or { items: [...] })
    if (Array.isArray(data.value)) {
      rawCandidates.push(...data.value);
    }
    if (Array.isArray(data.items)) {
      rawCandidates.push(...data.items);
    }

    // Format 3: Nested threads or conversations
    if (Array.isArray(data.conversations)) {
      for (const conv of data.conversations) {
        if (Array.isArray(conv.messages)) rawCandidates.push(...conv.messages);
      }
    }

    // Format 4: Single message object
    if (data.id && (data.content || data.body)) {
      rawCandidates.push(data);
    }

    // Parse and normalize candidates
    const normalized = [];
    const seenIds = new Set();

    for (const item of rawCandidates) {
      if (!item || typeof item !== 'object') continue;

      // Filter out system events (member added, call started, read receipts, etc.)
      const msgType = item.messagetype || item.messageType || item.type;
      if (
        msgType &&
        typeof msgType === 'string' &&
        (msgType.startsWith('Event/') || msgType.includes('Call') || msgType.includes('ReadReceipt'))
      ) {
        continue;
      }

      // Extract raw body or content
      let rawText = '';
      if (typeof item.content === 'string') {
        rawText = item.content;
      } else if (item.body && typeof item.body.content === 'string') {
        rawText = item.body.content;
      } else if (typeof item.text === 'string') {
        rawText = item.text;
      } else if (typeof item.properties?.body === 'string') {
        rawText = item.properties.body;
      }

      // Also inspect attachments for bot cards or adaptive cards
      if (Array.isArray(item.attachments)) {
        for (const att of item.attachments) {
          if (att && att.content) {
            if (typeof att.content === 'string') {
              rawText += ' ' + att.content;
            } else if (typeof att.content === 'object') {
              try {
                const card = att.content;
                if (card.title) rawText += ' ' + card.title;
                if (card.text) rawText += ' ' + card.text;
                if (Array.isArray(card.body)) {
                  for (const b of card.body) {
                    if (b.text) rawText += ' ' + b.text;
                  }
                }
              } catch {
                // Ignore parsing errors
              }
            }
          }
        }
      }

      const text = stripHtml(rawText);
      if (!text || text.length < 5) continue;

      // Extract message ID
      const id = String(
        item.id ||
        item.clientmessageid ||
        item.clientMessageId ||
        item.messageid ||
        item.sequenceId ||
        ''
      ).trim();

      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);

      // Extract sender displayName
      let sender = 'Unknown';
      if (item.imdisplayname) {
        sender = item.imdisplayname;
      } else if (item.from?.user?.displayName) {
        sender = item.from.user.displayName;
      } else if (item.sender?.displayName) {
        sender = item.sender.displayName;
      } else if (item.author) {
        sender = typeof item.author === 'string' ? item.author : item.author.name || 'Unknown';
      }

      // Extract timestamp
      const timestamp =
        item.composetime ||
        item.originalarrivaltime ||
        item.createdDateTime ||
        item.timestamp ||
        new Date().toISOString();

      // Build exact message deep link if conversationId/threadId is available in network payload
      let messageUrl = window.location.href;
      const conversationId = item.conversationId || item.conversationLink || data.id;
      if (conversationId && id && typeof conversationId === 'string' && conversationId.includes('@thread')) {
        try {
          const urlObj = new URL(window.location.href);
          const tenantId = urlObj.searchParams.get('tenantId');
          const groupId = urlObj.searchParams.get('groupId');
          let link = `https://teams.microsoft.com/l/message/${encodeURIComponent(conversationId)}/${encodeURIComponent(id)}`;
          const q = [];
          if (tenantId) q.push(`tenantId=${encodeURIComponent(tenantId)}`);
          if (groupId) q.push(`groupId=${encodeURIComponent(groupId)}`);
          if (q.length > 0) link += `?${q.join('&')}`;
          messageUrl = link;
        } catch {
          messageUrl = window.location.href;
        }
      }

      normalized.push({
        id,
        text,
        sender: sender || 'Unknown',
        timestamp,
        url: messageUrl,
        source: 'network_intercept',
      });
    }

    return normalized;
  }

  /**
   * Dispatches extracted messages to window for content script consumption
   */
  function dispatchCapturedMessages(messages, endpoint) {
    if (!messages || messages.length === 0) return;

    logIntercept(`Captured ${messages.length} message(s) from endpoint:`, endpoint);

    window.postMessage(
      {
        type: 'HARK_CAPTURED_MESSAGES',
        source: 'hark-network-interceptor',
        endpoint,
        messages,
      },
      '*'
    );
  }

  // ==========================================
  // 1. Intercept window.fetch
  // ==========================================
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    let response;
    try {
      response = await originalFetch.apply(this, args);
    } catch (err) {
      throw err;
    }

    if (isTeamsChatUrl(requestUrl)) {
      console.log('[Hark Network Intercept] Intercepted endpoint:', requestUrl);
      if (response && response.ok) {
        // Clone response to avoid consuming the original body stream
        try {
          const cloned = response.clone();
          cloned
            .json()
            .then((data) => {
              const extracted = extractMessagesFromJson(data);
              if (extracted.length > 0) {
                dispatchCapturedMessages(extracted, requestUrl);
              }
            })
            .catch(() => {
              // Ignore non-JSON responses
            });
        } catch {
          // Safe fail-through without disrupting Teams UI
        }
      }
    }

    return response;
  };

  // ==========================================
  // 2. Intercept XMLHttpRequest
  // ==========================================
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._harkUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this._harkUrl && isTeamsChatUrl(this._harkUrl)) {
      const url = this._harkUrl;
      console.log('[Hark Network Intercept] Intercepted endpoint:', url);
      this.addEventListener('load', function () {
        if (this.status >= 200 && this.status < 300 && this.responseText) {
          try {
            const data = JSON.parse(this.responseText);
            const extracted = extractMessagesFromJson(data);
            if (extracted.length > 0) {
              dispatchCapturedMessages(extracted, url);
            }
          } catch {
            // Not a JSON payload or parsing error
          }
        }
      });
    }

    return originalSend.apply(this, args);
  };
})();
