/**
 * Hark for MS Teams - Companion Content Script (content.js)
 * Dual-layer Ingestion:
 * 1. Primary: Intercepts Teams network requests via injected.js in page execution context.
 * 2. Fallback: 2-second debounced MutationObserver scanning rendered DOM elements.
 */

(function () {
  // Styles for Chrome DevTools Console monitoring
  const LOG_STYLE =
    'color: #818cf8; font-weight: bold; background: #0f172a; padding: 2px 6px; border-radius: 3px;';
  const NETWORK_LOG_STYLE =
    'color: #38bdf8; font-weight: bold; background: #0c4a6e; padding: 2px 6px; border-radius: 3px;';
  const SUCCESS_STYLE =
    'color: #34d399; font-weight: bold; background: #0f172a; padding: 2px 6px; border-radius: 3px;';
  const WARN_STYLE =
    'color: #fbbf24; font-weight: bold; background: #0f172a; padding: 2px 6px; border-radius: 3px;';
  const ERROR_STYLE =
    'color: #f87171; font-weight: bold; background: #0f172a; padding: 2px 6px; border-radius: 3px;';

  function log(msg, ...args) {
    console.log(`%c[Hark Extension]%c ${msg}`, LOG_STYLE, 'color: inherit;', ...args);
  }

  function logNetwork(msg, ...args) {
    console.log(`%c[Hark Network Intercept]%c ${msg}`, NETWORK_LOG_STYLE, 'color: #38bdf8;', ...args);
  }

  function logSuccess(msg, ...args) {
    console.log(`%c[Hark Extension]%c ${msg}`, SUCCESS_STYLE, 'color: #34d399;', ...args);
  }

  function logWarn(msg, ...args) {
    console.log(`%c[Hark Extension]%c ${msg}`, WARN_STYLE, 'color: #fbbf24;', ...args);
  }

  function logError(msg, ...args) {
    console.log(`%c[Hark Extension]%c ${msg}`, ERROR_STYLE, 'color: #f87171;', ...args);
  }

  log('Initializing Hark dual-layer companion script on Microsoft Teams...');

  // Configuration State
  let config = {
    apiUrl: 'http://localhost:3000/api/ingest',
    userId: '',
    isAutoIngestEnabled: true,
  };

  // Synced Message ID Cache
  const syncedMessageIds = new Set();
  let isObserverActive = false;
  let observer = null;
  let debounceTimer = null;
  let isSyncing = false;

  /**
   * Generates a deterministic fallback hash ID for a message
   */
  function generateFallbackId(text, sender, timestamp) {
    const raw = `${sender}::${timestamp}::${text.trim()}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return `hark_${Math.abs(hash).toString(36)}_${text.length}`;
  }

  /**
   * Injects the main page-context script (injected.js) to intercept fetch/XHR
   */
  function injectNetworkInterceptor() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.onload = function () {
        this.remove(); // Clean up the DOM element after execution
      };
      (document.head || document.documentElement).appendChild(script);
      logNetwork('Page-context network interceptor (injected.js) successfully injected.');
    } catch (err) {
      logError('Failed to inject page-context network interceptor:', err);
    }
  }

  /**
   * 1. Retrieve Settings & Local Cache
   */
  async function loadSettingsAndCache() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['apiUrl', 'userId', 'isAutoIngestEnabled', 'syncEnabled'], (syncData) => {
        config.apiUrl = (syncData.apiUrl || 'http://localhost:3000/api/ingest').trim();
        config.userId = (syncData.userId || '').trim();

        if (syncData.isAutoIngestEnabled !== undefined) {
          config.isAutoIngestEnabled = Boolean(syncData.isAutoIngestEnabled);
        } else if (syncData.syncEnabled !== undefined) {
          config.isAutoIngestEnabled = Boolean(syncData.syncEnabled);
        } else {
          config.isAutoIngestEnabled = true;
        }

        chrome.storage.local.get(['syncedMessageIds', 'hark_synced_ids'], (localData) => {
          const storedIds = Array.isArray(localData.syncedMessageIds)
            ? localData.syncedMessageIds
            : Array.isArray(localData.hark_synced_ids)
            ? localData.hark_synced_ids
            : [];
          storedIds.forEach((id) => syncedMessageIds.add(id));
          log(`Loaded ${syncedMessageIds.size} previously synced message IDs from cache.`);
          resolve();
        });
      });
    });
  }

  /**
   * Resolves the current channel or chat name
   */
  function getChannelName() {
    const headerEl =
      document.querySelector('[data-tid="channel-name"]') ||
      document.querySelector('[data-tid="chat-header-title"]') ||
      document.querySelector('[data-tid="thread-header-title"]') ||
      document.querySelector('h2[data-tid*="header"]');

    if (headerEl && headerEl.textContent.trim()) {
      return headerEl.textContent.trim();
    }

    if (document.title) {
      return document.title.replace(/\s*\|\s*Microsoft Teams$/i, '').trim() || 'MS Teams Channel';
    }

    return 'MS Teams Channel';
  }

  /**
   * Resolves the canonical deep link and routing context of the active channel directly from the Teams DOM.
   * Does NOT rely on raw window.location.href because Teams v2 is an SPA.
   */
  function getActiveTeamsChannelContext() {
    let resolvedChannelUrl = null;
    let detectedGroupId = null;
    let detectedTenantId = null;
    let detectedChannelId = null;
    const detectedChannelName = getChannelName();

    // 1. Locate the currently active/selected channel item in the left rail sidebar
    const activeSelectors = [
      '[role="treeitem"][aria-selected="true"]',
      '[role="treeitem"][aria-current="true"]',
      '[role="treeitem"][aria-current="page"]',
      '[data-tid*="active-channel"]',
      '[data-tid*="selected-channel"]',
      '[data-tid*="channel-list-item"][aria-selected="true"]',
      '[data-tid="team-channel-item"][aria-selected="true"]',
      'a[aria-current="true"][href*="/l/channel/"]',
      'a[aria-selected="true"][href*="/l/channel/"]',
      '.ui-tree__item[aria-selected="true"]',
      '[role="listitem"][aria-selected="true"]',
      'li[aria-selected="true"]',
      'div[aria-selected="true"][data-tid*="channel"]',
    ];

    let activeNode = null;
    for (const sel of activeSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        activeNode = el;
        break;
      }
    }

    // 2. Read anchor href from that active channel node
    // Teams channel sidebar items render an anchor tag containing the exact canonical URL:
    // https://teams.microsoft.com/l/channel/<channelId>/<channelName>?groupId=<groupId>&tenantId=<tenantId>
    if (activeNode) {
      const anchor =
        activeNode.tagName === 'A' && activeNode.getAttribute('href')
          ? activeNode
          : activeNode.querySelector('a[href]');

      if (anchor) {
        const href = (anchor.getAttribute('href') || '').trim();
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          resolvedChannelUrl = href.startsWith('http') ? href : new URL(href, window.location.origin).href;
        }
      }

      // Check data-href or data-url attributes
      if (!resolvedChannelUrl) {
        const dataHref = activeNode.getAttribute('data-href') || activeNode.getAttribute('data-url');
        if (dataHref && dataHref.startsWith('http')) {
          resolvedChannelUrl = dataHref;
        }
      }

      // Extract data attributes (data-channel-id, data-team-id, data-group-id)
      detectedChannelId =
        activeNode.getAttribute('data-channel-id') ||
        activeNode.getAttribute('data-tid')?.match(/19:[a-zA-Z0-9_\-]+(?:%40|@)thread\.[a-zA-Z0-9_\-]+/i)?.[0] ||
        null;

      const teamParent = activeNode.closest('[data-team-id], [data-group-id], [data-tid*="team"]');
      detectedGroupId =
        teamParent?.getAttribute('data-group-id') ||
        teamParent?.getAttribute('data-team-id') ||
        null;
    }

    // 3. Fallback: Search channel header or breadcrumbs for canonical channel link
    if (!resolvedChannelUrl || !resolvedChannelUrl.includes('/l/channel/')) {
      const headerAnchor = document.querySelector(
        '[data-tid*="channel-header"] a[href*="/l/channel/"], [data-tid*="thread-header"] a[href*="/l/channel/"], a[href*="/l/channel/"]'
      );
      if (headerAnchor) {
        const href = (headerAnchor.getAttribute('href') || '').trim();
        if (href && !href.startsWith('#')) {
          resolvedChannelUrl = href.startsWith('http') ? href : new URL(href, window.location.origin).href;
        }
      }
    }

    // 4. Parse parameters from resolvedChannelUrl if present
    if (resolvedChannelUrl) {
      try {
        const parsed = new URL(resolvedChannelUrl);
        detectedGroupId = parsed.searchParams.get('groupId') || detectedGroupId;
        detectedTenantId = parsed.searchParams.get('tenantId') || detectedTenantId;
        const matchChannel = parsed.pathname.match(/\/l\/channel\/([^/?&#\s]+)/i);
        if (matchChannel) {
          detectedChannelId = decodeURIComponent(matchChannel[1]);
        }
      } catch {
        // ignore
      }
    }

    // 5. Fallback for tenantId / groupId from window.location if still missing
    if (!detectedTenantId || !detectedGroupId) {
      try {
        const urlObj = new URL(window.location.href);
        detectedTenantId = detectedTenantId || urlObj.searchParams.get('tenantId');
        detectedGroupId = detectedGroupId || urlObj.searchParams.get('groupId');
      } catch {
        // ignore
      }
    }

    // 6. If we have channelId and groupId, build canonical channel link
    if (
      detectedChannelId &&
      (detectedGroupId || detectedTenantId) &&
      (!resolvedChannelUrl || !resolvedChannelUrl.includes('/l/channel/'))
    ) {
      let canonical = `https://teams.microsoft.com/l/channel/${encodeURIComponent(detectedChannelId)}/${encodeURIComponent(
        detectedChannelName || 'General'
      )}`;
      const q = [];
      if (detectedGroupId) q.push(`groupId=${encodeURIComponent(detectedGroupId)}`);
      if (detectedTenantId) q.push(`tenantId=${encodeURIComponent(detectedTenantId)}`);
      if (q.length > 0) canonical += `?${q.join('&')}`;
      resolvedChannelUrl = canonical;
    }

    return {
      channelUrl: resolvedChannelUrl,
      groupId: detectedGroupId,
      tenantId: detectedTenantId,
      channelId: detectedChannelId,
      channelName: detectedChannelName,
    };
  }

  /**
   * Resolves the exact pinpoint deep link for a card, falling back to canonical channel deep link.
   * Format: https://teams.microsoft.com/l/message/${threadId}/${messageId}?groupId=${groupId}&tenantId=${tenantId}
   */
  function resolveCardDeepLink(container, activeContext) {
    // 1. Check if card has explicit assignment link
    const cardAnchors = container.querySelectorAll('a[href]');
    for (const a of cardAnchors) {
      const href = (a.getAttribute('href') || '').trim();
      if (
        href &&
        !href.startsWith('#') &&
        !href.startsWith('javascript:') &&
        (/assignment/i.test(href) || /\/l\/(?:assignment|entity)\//i.test(href))
      ) {
        return href.startsWith('http') ? href : new URL(href, window.location.origin).href;
      }
    }

    const interactiveEls = container.querySelectorAll(
      'button, a, [role="button"], [data-tid*="assignment"], .ac-actionSet'
    );
    for (const el of interactiveEls) {
      const candidateAttrs = [
        el.getAttribute('href'),
        el.getAttribute('data-href'),
        el.getAttribute('data-url'),
        el.getAttribute('data-assignment-url'),
        el.getAttribute('data-action-url'),
      ];
      for (const attr of candidateAttrs) {
        if (attr && typeof attr === 'string') {
          const trimmed = attr.trim();
          if (trimmed.startsWith('http') && (/assignment/i.test(trimmed) || /\/l\//i.test(trimmed))) {
            return trimmed;
          }
        }
      }
      const dataAction = el.getAttribute('data-action') || '';
      const urlMatch = dataAction.match(/https?:\/\/[^\s"'<>\\]+(?:teams\.microsoft\.com|assignment)[^\s"'<>\\]*/i);
      if (urlMatch) {
        return urlMatch[0].replace(/&amp;/g, '&');
      }
    }

    // 2. Check if the card container itself or the message parent ([data-mid]) contains a thread ID (19:...@thread.tacv2)
    let threadId = null;
    let curr = container;
    while (curr && curr !== document.body) {
      const combined = `${curr.getAttribute('data-thread-id') || ''} ${curr.getAttribute('data-conversation-id') || ''} ${curr.getAttribute('data-tid') || ''} ${curr.id || ''} ${curr.getAttribute('data-mid') || ''}`;
      const match = combined.match(/19:[a-zA-Z0-9_\-]+(?:%40|@)thread\.[a-zA-Z0-9_\-]+/i);
      if (match) {
        threadId = decodeURIComponent(match[0]);
        break;
      }
      curr = curr.parentElement;
    }

    if (!threadId && activeContext.channelId && activeContext.channelId.includes('@thread')) {
      threadId = activeContext.channelId;
    }

    // Extract message ID from [data-mid] or ancestors
    const msgParent =
      container.closest('[data-mid], [data-message-id], [id^="chat-message-"], [data-tid*="message"], [role="listitem"]') ||
      container;
    const rawMid =
      msgParent.getAttribute('data-mid') ||
      msgParent.getAttribute('data-message-id') ||
      msgParent.dataset?.mid ||
      container.getAttribute('data-mid');

    const cleanMessageId = rawMid ? String(rawMid).replace(/^chat-message-/i, '').trim() : null;

    // If both thread ID and message ID exist, construct pinpoint message link:
    // https://teams.microsoft.com/l/message/${threadId}/${messageId}?groupId=${groupId}&tenantId=${tenantId}
    if (threadId && cleanMessageId) {
      let pinpoint = `https://teams.microsoft.com/l/message/${encodeURIComponent(threadId)}/${encodeURIComponent(cleanMessageId)}`;
      const q = [];
      if (activeContext.groupId) q.push(`groupId=${encodeURIComponent(activeContext.groupId)}`);
      if (activeContext.tenantId) q.push(`tenantId=${encodeURIComponent(activeContext.tenantId)}`);
      if (q.length > 0) pinpoint += `?${q.join('&')}`;
      return pinpoint;
    }

    // 3. Fallback to the active channel link resolved directly from Teams DOM
    if (activeContext.channelUrl) {
      return activeContext.channelUrl;
    }

    // 4. Final fallback
    return window.location.href;
  }

  /**
   * Dispatches candidate messages to the Hark ingest API with deduplication
   * @param {Array} rawCandidates
   * @param {'network' | 'dom'} sourceLayer
   */
  /**
   * Dispatches candidate messages to the Hark ingest API with deduplication
   * @param {Array} rawCandidates
   * @param {'network' | 'dom' | 'dom_manual'} sourceLayer
   * @param {boolean} forceBypassDedup
   */
  async function dispatchMessagesToHark(rawCandidates, sourceLayer = 'network', forceBypassDedup = false) {
    if (!config.isAutoIngestEnabled && !forceBypassDedup) {
      log(`Auto-ingest is disabled. Skipping ${sourceLayer} dispatch.`);
      return [];
    }

    if (!config.userId) {
      logWarn(`User ID is not configured. Skipping ${sourceLayer} message dispatch.`);
      return [];
    }

    // Deduplicate against synced ID cache
    const newMessages = rawCandidates.filter((msg) => {
      const id =
        msg.id ||
        generateFallbackId(
          msg.text || msg.title || '',
          msg.sender || '',
          msg.timestamp || msg.rawDueString || ''
        );
      msg.id = id;
      return forceBypassDedup || !syncedMessageIds.has(id);
    });

    if (newMessages.length === 0) {
      log(`No new un-synced messages found via [${sourceLayer}].`);
      return [];
    }

    const tag = sourceLayer === 'network' ? logNetwork : log;
    tag(
      `Detected %c${newMessages.length}%c message(s) via [${sourceLayer}]. Dispatching to Hark...`,
      'font-weight: bold; color: #818cf8;',
      'font-weight: normal;'
    );

    const clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Manila';
    const payload = {
      userId: config.userId,
      channelName: getChannelName(),
      timezone: clientTimezone,
      messages: newMessages,
    };

    try {
      const response = await fetch(config.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText || response.statusText}`);
      }

      const responseData = await response.json();
      const taskList = Array.isArray(responseData) ? responseData : (responseData.tasks || []);
      const inserted = responseData.inserted ?? (Array.isArray(responseData) ? responseData.length : 0);
      const updated = responseData.updated ?? 0;
      const skipped = responseData.skipped ?? 0;

      // Mark IDs as synced in memory
      newMessages.forEach((msg) => syncedMessageIds.add(msg.id));

      // Persist up to the last 2000 synced IDs in chrome.storage.local
      const recentIds = Array.from(syncedMessageIds).slice(-2000);
      chrome.storage.local.set({
        syncedMessageIds: recentIds,
        hark_synced_ids: recentIds,
      });

      if (inserted > 0 || updated > 0) {
        logSuccess(
          `[${sourceLayer.toUpperCase()}] Ingestion successful! ${inserted} new, ${updated} updated:`,
          taskList
        );
      } else {
        tag(`[${sourceLayer.toUpperCase()}] Processed ${newMessages.length} message(s). 0 assignments found or all skipped.`);
      }

      return { tasks: taskList, inserted, updated, skipped };
    } catch (err) {
      logError(`[${sourceLayer.toUpperCase()}] Delivery failed to ${config.apiUrl}: ${err.message}`);
      throw err;
    }
  }

  // ==========================================
  // Layer 1: Network Request Interception Bridge
  // ==========================================
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'HARK_CAPTURED_MESSAGES') return;

    const { messages, endpoint } = event.data;
    if (!Array.isArray(messages) || messages.length === 0) return;

    logNetwork(
      `Captured ${messages.length} message(s) from network stream (${endpoint ? endpoint.slice(0, 75) + '...' : 'Teams API'}).`
    );

    dispatchMessagesToHark(messages, 'network').catch(() => {});
  });

  // ==========================================
  // Layer 2: High-Speed Direct Semantic DOM Card Scanner
  // ==========================================

  /**
   * Traverses the DOM semantically to locate any container holding
   * the text "Assignments" AND ("Due" OR "View assignment").
   * Avoids brittle class-only selectors.
   */
  function findAssignmentContainers() {
    const rawContainers = new Set();
    const candidateLeaves = [];

    // Scan buttons, links, headings, and leaf elements mentioning target keywords
    const candidateNodes = document.querySelectorAll(
      'button, a, [role="button"], [role="listitem"], [data-tid*="card"], [data-tid*="assignment"], .ui-card, .ac-container, h2, h3, h4, strong, span, div'
    );

    for (const el of candidateNodes) {
      if (el.children.length > 3) continue; // Skip large subtree parents
      const text = (el.innerText || el.textContent || '').trim();
      if (!text) continue;

      const lower = text.toLowerCase();
      if (
        lower === 'view assignment' ||
        lower.includes('view assignment') ||
        lower === 'assignments' ||
        lower.includes('assignments') ||
        /\b(?:due|due\s+by|deadline[:\s]+)/i.test(text)
      ) {
        candidateLeaves.push(el);
      }
    }

    // Traverse upwards from candidate leaves to locate tightest container
    for (const leaf of candidateLeaves) {
      let curr = leaf;
      let matchingAncestor = null;

      while (curr && curr !== document.body && curr !== document.documentElement) {
        const text = curr.innerText || '';
        if (text.length > 3500) break; // Stop before ascending to full channel viewport

        const hasAssignments = /assignments?/i.test(text);
        const hasDueOrView = /(?:due|due\s+by|deadline)/i.test(text) || /view assignment/i.test(text);

        if (hasAssignments && hasDueOrView) {
          matchingAncestor = curr;
          // If we hit an adaptive card, ui-card, or message wrapper, stop ascending
          if (
            curr.classList?.contains('ui-card') ||
            curr.classList?.contains('ac-container') ||
            curr.getAttribute('role') === 'listitem' ||
            curr.getAttribute('data-tid')?.includes('card') ||
            curr.getAttribute('data-tid')?.includes('message')
          ) {
            break;
          }
        }
        curr = curr.parentElement;
      }

      if (matchingAncestor) {
        rawContainers.add(matchingAncestor);
      }
    }

    // Deduplicate: keep only the innermost container if nested
    const finalContainers = [];
    for (const c1 of rawContainers) {
      let isEnclosingAnother = false;
      for (const c2 of rawContainers) {
        if (c1 !== c2 && c1.contains(c2)) {
          isEnclosingAnother = true;
          break;
        }
      }
      if (!isEnclosingAnother) {
        finalContainers.push(c1);
      }
    }

    return finalContainers;
  }

  /**
   * Extracts clean native assignment cards directly from a card container element.
   * Matches regex: /(?:Due|due\s+by|deadline[:\s]+)(.+?)(?:\n|$)/i
   */
  function extractCardFromContainer(container, seenBatchIds) {
    const containerText = (container.innerText || container.textContent || '').trim();
    if (!containerText) return null;

    // 1. Due Date regex matching
    const dueRegex = /(?:Due|due\s+by|deadline[:\s]+)(.+?)(?:\n|$)/i;
    const dueMatch = containerText.match(dueRegex);
    let extractedDueDate = '';
    if (dueMatch && dueMatch[1]) {
      extractedDueDate = dueMatch[1].trim().replace(/[.]+$/, '').trim();
    }

    if (!extractedDueDate) {
      return null;
    }

    // 2. Title: text within largest heading or strong tag
    const headingElements = container.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, strong, b, [role="heading"], .ui-card__header, [class*="title"], [class*="header"]'
    );

    let largestTitle = '';
    let maxWeight = -1;

    for (const el of headingElements) {
      const text = (el.innerText || el.textContent || '').trim();
      if (!text || text.length < 2) continue;

      const lower = text.toLowerCase();
      if (
        lower === 'assignments' ||
        lower === 'assignment' ||
        lower.includes('view assignment') ||
        /^(?:due|past due|turned in|returned|points?)/i.test(text)
      ) {
        continue;
      }

      let weight = 14;
      try {
        const style = window.getComputedStyle(el);
        const fs = parseFloat(style.fontSize) || 14;
        const isBold = parseInt(style.fontWeight, 10) >= 600 || style.fontWeight === 'bold';
        weight = fs + (isBold ? 4 : 0);
        if (/^h[1-6]$/i.test(el.tagName)) {
          weight += (7 - parseInt(el.tagName.charAt(1), 10)) * 2;
        }
      } catch {
        if (/^h[1-3]$/i.test(el.tagName)) weight = 24;
        else if (/^h[4-6]$/i.test(el.tagName)) weight = 18;
        else if (el.tagName === 'STRONG' || el.tagName === 'B') weight = 16;
      }

      if (weight > maxWeight) {
        maxWeight = weight;
        largestTitle = text;
      }
    }

    let extractedTitle = largestTitle;

    // Fallback title: preceding line above due date
    if (!extractedTitle) {
      const lines = containerText.split('\n').map((l) => l.trim()).filter(Boolean);
      const dueIdx = lines.findIndex((l) => /(?:due|due\s+by|deadline)/i.test(l));
      if (dueIdx > 0) {
        for (let i = dueIdx - 1; i >= 0; i--) {
          const candidate = lines[i];
          if (
            !/^assignments?$/i.test(candidate) &&
            !/view assignment/i.test(candidate) &&
            candidate.length > 2
          ) {
            extractedTitle = candidate;
            break;
          }
        }
      }
    }

    if (!extractedTitle) {
      extractedTitle = 'Course Assignment';
    }

    // 3. Deep Link: exact assignment URL, button action, or canonical route deep link
    const activeContext = getActiveTeamsChannelContext();
    const cardUrl = resolveCardDeepLink(container, activeContext);

    // Diagnostic Logging: Log resolved URL whenever an assignment card is parsed
    console.log('%c[Hark Link Debug]', 'color: #00ffff; font-weight: bold;', {
      detectedChannel: activeContext.channelName || getChannelName(),
      resolvedDeepLink: cardUrl,
    });

    // Deduplication key
    const domId =
      container.getAttribute('data-mid') ||
      container.getAttribute('data-message-id') ||
      container.getAttribute('id') ||
      container.dataset?.mid;

    const id = domId
      ? `assignment_${domId}`
      : generateFallbackId(extractedTitle + '::' + extractedDueDate, 'Assignments Bot', extractedDueDate);

    if (seenBatchIds && (syncedMessageIds.has(id) || seenBatchIds.has(id))) {
      return null;
    }
    if (seenBatchIds) seenBatchIds.add(id);

    // Format directly for the fast-path bypass
    return {
      id,
      isNativeCard: true,
      title: extractedTitle,
      rawDueString: extractedDueDate,
      url: cardUrl,
      sender: 'Assignments Bot',
      timestamp: new Date().toISOString(),
      text: `Assignment: ${extractedTitle}. Due: ${extractedDueDate}`,
      source: 'native_assignment_card',
    };
  }

  /**
   * Main DOM extraction combining Direct Semantic Card Scanner and regular messages
   */
  function extractMessagesFromDOM() {
    const extracted = [];
    const seenBatchIds = new Set();
    const processedContainers = new Set();

    // 1. Direct Semantic Tree Traversal for Native MS Teams Assignment Cards
    const assignmentContainers = findAssignmentContainers();
    for (const container of assignmentContainers) {
      const card = extractCardFromContainer(container, seenBatchIds);
      if (card) {
        extracted.push(card);
        processedContainers.add(container);
      }
    }

    if (extracted.length > 0) {
      log(`Direct Semantic Scanner found ${extracted.length} native Assignment Bot card(s).`);
    }

    // 2. Scan regular chat messages (filtering out already captured cards)
    const messageSelectors = [
      '[data-tid="chat-pane-message"]',
      '[data-tid="thread-message"]',
      '[data-tid="message-pane-list-item"]',
      '[data-tid="chat-message-item"]',
      '[data-testid="message-item"]',
      'div[data-mid]',
      'div[data-message-id]',
      '[role="listitem"] [data-tid*="message"]',
    ];

    const messageElements = Array.from(document.querySelectorAll(messageSelectors.join(', ')));

    for (const el of messageElements) {
      // Skip if this element is or contains an already processed assignment card
      let alreadyHandled = false;
      for (const pc of processedContainers) {
        if (el.contains(pc) || pc.contains(el)) {
          alreadyHandled = true;
          break;
        }
      }
      if (alreadyHandled) continue;

      const authorEl =
        el.querySelector('[data-tid="message-author-name"]') ||
        el.querySelector('[data-tid="author-name"]') ||
        el.querySelector('[data-testid="author-name"]') ||
        el.querySelector('span[data-tid*="author"]') ||
        el.querySelector('.ui-chat__message__author');

      const sender = authorEl ? (authorEl.innerText || authorEl.textContent || '').trim() : 'Unknown';

      // If sender is Assignments bot and was already handled
      if (sender.toLowerCase().includes('assignment') && extracted.length > 0) {
        continue;
      }

      const bodyEl =
        el.querySelector('[data-tid="message-body"]') ||
        el.querySelector('[data-tid="message-content"]') ||
        el.querySelector('[data-testid="message-body"]') ||
        el.querySelector('.message-body') ||
        el.querySelector('div[dir="auto"]') ||
        el;

      const text = (bodyEl.innerText || bodyEl.textContent || '').trim();
      if (!text || text.length < 15) continue; // Filter short messages

      if (text.toLowerCase().includes('view assignment') && extracted.length > 0) {
        continue;
      }

      const timeEl =
        el.querySelector('time') ||
        el.querySelector('[data-tid="message-timestamp"]') ||
        el.querySelector('[data-testid="message-timestamp"]') ||
        el.querySelector('span[id*="timestamp"]');

      let timestamp = new Date().toISOString();
      if (timeEl) {
        const datetimeAttr = timeEl.getAttribute('datetime');
        if (datetimeAttr) {
          timestamp = datetimeAttr;
        } else {
          const timeText = (timeEl.innerText || timeEl.textContent || '').trim();
          if (timeText) timestamp = timeText;
        }
      }

      const domId =
        el.getAttribute('data-mid') ||
        el.getAttribute('data-message-id') ||
        el.getAttribute('id') ||
        el.dataset?.mid ||
        el.dataset?.messageId;

      const id = domId ? String(domId).trim() : generateFallbackId(text, sender, timestamp);

      if (syncedMessageIds.has(id) || seenBatchIds.has(id)) {
        continue;
      }

      // Extract message item's exact permalink if available, or generate canonical deep link
      const activeContext = getActiveTeamsChannelContext();
      let messageUrl = null;
      const permalinkEl = el.querySelector(
        'a[href*="/l/message/"], [data-tid*="copy-link"], [data-tid*="permalink"]'
      );
      if (permalinkEl && permalinkEl.getAttribute('href')) {
        const href = permalinkEl.getAttribute('href').trim();
        if (href.startsWith('http')) messageUrl = href;
      }

      if (!messageUrl) {
        messageUrl = resolveCardDeepLink(el, activeContext);
      }

      // Diagnostic Logging: Log resolved URL whenever a chat announcement is parsed
      console.log('%c[Hark Link Debug]', 'color: #00ffff; font-weight: bold;', {
        detectedChannel: activeContext.channelName || getChannelName(),
        resolvedDeepLink: messageUrl,
      });

      seenBatchIds.add(id);
      extracted.push({
        id,
        text,
        sender: sender || 'Unknown',
        timestamp,
        url: messageUrl,
        source: 'dom_message',
      });
    }

    return extracted;
  }

  function handleDOMMutation() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    // 2-second debounce to prevent lag during rapid rendering
    debounceTimer = setTimeout(() => {
      const domMessages = extractMessagesFromDOM();
      if (domMessages.length > 0) {
        dispatchMessagesToHark(domMessages, 'dom').catch(() => {});
      }
    }, 2000);
  }

  function setupObserver() {
    if (config.isAutoIngestEnabled && config.userId) {
      if (!isObserverActive) {
        observer = new MutationObserver(handleDOMMutation);
        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
        isObserverActive = true;
        log('DOM Fallback Observer active with 2s debounce.');
      }
    } else {
      if (isObserverActive && observer) {
        observer.disconnect();
        isObserverActive = false;
        logWarn('DOM Observer disconnected.');
      }
    }
  }

  /**
   * Storage change listener for live settings and cache updates
   */
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
      let changed = false;

      if (changes.apiUrl) {
        config.apiUrl = changes.apiUrl.newValue || config.apiUrl;
        changed = true;
      }

      if (changes.userId) {
        config.userId = (changes.userId.newValue || '').trim();
        changed = true;
      }

      if (changes.isAutoIngestEnabled !== undefined) {
        config.isAutoIngestEnabled = Boolean(changes.isAutoIngestEnabled.newValue);
        changed = true;
      } else if (changes.syncEnabled !== undefined) {
        config.isAutoIngestEnabled = Boolean(changes.syncEnabled.newValue);
        changed = true;
      }

      if (changed) {
        log('Settings updated dynamically:', {
          apiUrl: config.apiUrl,
          userId: config.userId || '(none)',
          isAutoIngestEnabled: config.isAutoIngestEnabled,
        });
        setupObserver();
      }
    }

    // Deduplication cache cleared externally (e.g. from popup reset)
    if (areaName === 'local') {
      if (changes.syncedMessageIds || changes.hark_synced_ids) {
        const newIds = changes.syncedMessageIds?.newValue || changes.hark_synced_ids?.newValue;
        if (!newIds || (Array.isArray(newIds) && newIds.length === 0)) {
          syncedMessageIds.clear();
          log('Deduplication cache cleared. Ready for re-scan.');
        }
      }
    }
  });

  /**
   * Runtime message listener for manual scans and cache reset from popup
   */
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      // 1. Manual "Scan Visible Page Now" trigger
      if (request && (request.action === 'scanNow' || request.action === 'forceScan')) {
        log('Manual "Scan Visible Page Now" triggered from popup...');
        const forceBypass = Boolean(request.forceBypassDedup);
        const messages = extractMessagesFromDOM();

        if (messages.length === 0) {
          log('Manual scan found 0 visible items.');
          sendResponse({ success: true, capturedCount: 0, tasksCreated: 0, tasksUpdated: 0 });
          return true;
        }

        dispatchMessagesToHark(messages, 'dom_manual', forceBypass)
          .then((res) => {
            const inserted = res?.inserted ?? (Array.isArray(res) ? res.length : 0);
            const updated = res?.updated ?? 0;
            sendResponse({
              success: true,
              capturedCount: messages.length,
              tasksCreated: inserted,
              tasksUpdated: updated,
            });
          })
          .catch((err) => {
            sendResponse({
              success: false,
              error: err.message,
              capturedCount: messages.length,
              tasksCreated: 0,
              tasksUpdated: 0,
            });
          });

        return true; // Keep channel open for async response
      }

      // 2. Reset sync cache trigger
      if (request && (request.action === 'clearCache' || request.type === 'HARK_FORCE_RESCAN')) {
        syncedMessageIds.clear();
        chrome.storage.local.remove(['syncedMessageIds', 'hark_synced_ids'], () => {
          log('Deduplication cache cleared via popup command.');
          sendResponse?.({ success: true });
        });
        return true;
      }
    });
  }

  // ==========================================
  // Execution Lifecycle
  // ==========================================
  // 1. Inject Network Interceptor as early as possible
  injectNetworkInterceptor();

  // 2. Load settings and initialize fallback DOM observer
  loadSettingsAndCache().then(() => {
    if (!config.userId) {
      logWarn('User ID not set. Open Hark popup to configure your User ID.');
      return;
    }

    if (!config.isAutoIngestEnabled) {
      logWarn('Auto-ingest is disabled in settings.');
      return;
    }

    setupObserver();

    // Immediate one-time DOM scan 2 seconds after initialization
    setTimeout(() => {
      log('Running initial 2-second DOM scan for existing messages and assignments...');
      const initialMessages = extractMessagesFromDOM();
      if (initialMessages.length > 0) {
        log(`Initial scan found ${initialMessages.length} message(s)/assignment(s). Dispatching...`);
        dispatchMessagesToHark(initialMessages, 'dom');
      } else {
        log('Initial scan complete. No un-synced messages or assignments found.');
      }
    }, 2000);
  });
})();
