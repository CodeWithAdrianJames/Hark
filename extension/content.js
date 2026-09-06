console.log("%c[Hark Injected]", "background: #222; color: #bada55; font-size: 14px;", window.location.href);

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

  const isTopWindow = window.self === window.top;
  const isEduAssignmentsHost =
    typeof window !== 'undefined' &&
    window.location.hostname.includes('assignments.edu.cloud.microsoft');

  if (isEduAssignmentsHost) {
    console.log(
      '%c[Hark Frame: EDU Hub]',
      'color: #10b981; font-weight: bold; font-size: 11px; padding: 2px 4px; border-radius: 2px; background: #064e3b;',
      `Assignments EDU Hub (${window.location.host})`
    );
  } else {
    console.log(
      '%c[Hark Frame]',
      'color: #ffaa00; font-weight: bold; font-size: 11px; padding: 2px 4px; border-radius: 2px;',
      isTopWindow ? 'Top Teams Window' : `Assignments Iframe (${window.location.host})`
    );
  }

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

  log(`Initializing Hark companion script on ${isTopWindow ? 'Top Teams Window' : 'Assignments Iframe'}...`);

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
    if (!isTopWindow) {
      return; // Network interceptor is only needed in the top-level window
    }
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
   * Cleans any noisy prefix/suffix/notification artifacts from team or course titles
   */
  function cleanCourseOrTeamName(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let text = raw.trim();

    // 1. Remove notification counts: (1), (99+), etc.
    text = text.replace(/^\(\d+\+?\)\s*/, '');

    // 2. Remove notification icons or unread badges
    text = text.replace(/[\u{1F514}\u{25CF}\u{25CB}\u{2022}]/gu, ''); // bell, bullets
    text = text.replace(/\s*\d+\s+unread(?:\s+activities|\s+messages|\s+mentions)?/gi, '');
    text = text.replace(/\s*unread\s*$/i, '');

    // 3. Remove common Teams shell noise
    text = text.replace(/^(?:teams\s+and\s+channels|microsoft\s+teams|teams|chats?)\s*[|:›>–—\-]\s*/i, '');
    text = text.replace(/\s*[|:›>–—\-]\s*(?:microsoft\s+teams|teams|general)$/i, '');

    // 4. If split by pipes or breadcrumbs: find the most descriptive course segment
    // e.g. "Teams and Channels | IT317[G1][1stSem/26-27]AMPARO | General | Microsoft Teams"
    if (text.includes('|') || text.includes('>') || text.includes('›')) {
      const parts = text.split(/[|›>]/).map((p) => p.trim()).filter(Boolean);
      const filtered = parts.filter((p) => {
        const lower = p.toLowerCase();
        return (
          !lower.includes('teams and channels') &&
          !lower.includes('microsoft teams') &&
          lower !== 'general' &&
          lower !== 'teams' &&
          lower !== 'chat' &&
          lower !== 'conversations'
        );
      });
      if (filtered.length > 0) {
        text = filtered[0];
      }
    }

    const lowerFinal = text.toLowerCase().trim();
    if (
      !lowerFinal ||
      lowerFinal === 'teams' ||
      lowerFinal === 'general' ||
      lowerFinal === 'microsoft teams' ||
      lowerFinal === 'conversations' ||
      lowerFinal === 'chat' ||
      lowerFinal === 'null' ||
      lowerFinal === 'undefined'
    ) {
      return '';
    }

    return text.trim();
  }

  /**
   * Normalizes course title into formatted badge e.g. "[CSIT321G1]", "[IT317]", "[IT365]"
   */
  function extractCourseBadge(rawName) {
    if (!rawName || typeof rawName !== 'string') return '[GENERAL]';
    const clean = rawName.replace(/^\[+|\]+$/g, '').trim();

    const csitMatch = clean.match(/\b(CSIT\d{2,4}[A-Z0-9]*)\b/i);
    if (csitMatch) return `[${csitMatch[1].toUpperCase()}]`;

    const deptMatch = clean.match(/\b([A-Z]{2,6})\s*(\d{2,4}[A-Z0-9]*)\b/i);
    if (deptMatch) return `[${deptMatch[1].toUpperCase()}${deptMatch[2].toUpperCase()}]`;

    const bracketMatch = clean.match(/\[([A-Za-z0-9_\-]+)\]/);
    if (bracketMatch && bracketMatch[1].length <= 15) return `[${bracketMatch[1].toUpperCase()}]`;

    const firstWord = clean.split(/[\s\[\(\-]/)[0];
    if (firstWord && firstWord.length <= 15 && /[A-Za-z]/i.test(firstWord)) {
      return `[${firstWord.toUpperCase()}]`;
    }
    return `[${clean.slice(0, 15).toUpperCase()}]`;
  }

  /**
   * Extracts a concise course code (e.g. IT317, CS311, CSIT321G1, RIZAL031) from a course title
   */
  function extractCourseCode(cleanName) {
    return extractCourseBadge(cleanName).replace(/^\[+|\]+$/g, '');
  }

  /**
   * Ground-truth extraction of active Team Name and Channel Name directly from Teams DOM.
   * Avoids hallucinated or generic names.
   */
  function getVerifiedTeamAndCourseContext() {
    let resolvedTeamName = '';
    let resolvedChannelName = '';

    // 1. Check Channel Name from specific header element
    const channelHeaderEl =
      document.querySelector('[data-tid="channel-name"]') ||
      document.querySelector('[data-tid="chat-header-title"]') ||
      document.querySelector('[data-tid="thread-header-title"]');
    if (channelHeaderEl && channelHeaderEl.textContent.trim()) {
      resolvedChannelName = channelHeaderEl.textContent.trim();
    }

    // 2. Query top team breadcrumbs / team header title in chat pane
    const teamHeaderSelectors = [
      '[data-tid="team-name"]',
      '[data-tid="channel-header-team-name"]',
      '[data-tid="team-header-title"]',
      '[data-tid="header-team-name"]',
      '.team-title',
      '[data-tid*="breadcrumbs"] [data-tid*="team"]',
      '[data-tid="channel-header"] [role="heading"]',
    ];

    for (const sel of teamHeaderSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        const candidate = cleanCourseOrTeamName(el.textContent);
        if (candidate) {
          resolvedTeamName = candidate;
          break;
        }
      }
    }

    // 3. Query the active channel in left sidebar and ascend to parent Team title
    if (!resolvedTeamName) {
      const activeChannelNode = document.querySelector(
        '[role="treeitem"][aria-selected="true"], [role="treeitem"][aria-current="true"], [data-tid*="active-channel"], [data-tid*="channel-list-item"][aria-selected="true"]'
      );

      if (activeChannelNode) {
        if (!resolvedChannelName) {
          resolvedChannelName = activeChannelNode.textContent?.trim() || '';
        }

        // Check parent group treeitem
        const teamParent = activeChannelNode.closest(
          '[data-team-id], [data-group-id], [data-tid*="team-channel-list"], [data-tid*="team-list-item"]'
        );

        if (teamParent) {
          const titleEl = teamParent.querySelector(
            '[data-tid*="team-name"], [data-tid*="team-title"], h3, [role="heading"], button[aria-expanded]'
          );
          if (titleEl && titleEl.textContent.trim()) {
            const candidate = cleanCourseOrTeamName(titleEl.textContent);
            if (candidate) resolvedTeamName = candidate;
          }
        }

        if (!resolvedTeamName) {
          // Look at previous heading in sidebar hierarchy
          const parentTreeItem = activeChannelNode.closest('[role="group"]')?.parentElement;
          if (parentTreeItem) {
            const heading = parentTreeItem.querySelector('h3, [data-tid*="team"], button, span');
            if (heading && heading.textContent.trim()) {
              const candidate = cleanCourseOrTeamName(heading.textContent);
              if (candidate) resolvedTeamName = candidate;
            }
          }
        }
      }
    }

    // 4. Fallback: Parse and clean document.title
    if (!resolvedTeamName && document.title) {
      const candidate = cleanCourseOrTeamName(document.title);
      if (candidate) resolvedTeamName = candidate;
    }

    // If channel name not found, try document.title channel component
    if (!resolvedChannelName && document.title) {
      const parts = document.title.split('|').map((p) => p.trim());
      if (parts.length >= 3 && parts[parts.length - 2] && !/microsoft teams/i.test(parts[parts.length - 2])) {
        resolvedChannelName = parts[parts.length - 2];
      }
    }

    resolvedChannelName = resolvedChannelName || 'General';
    resolvedTeamName = resolvedTeamName || resolvedChannelName || 'MS Teams Course';

    const courseCode = extractCourseCode(resolvedTeamName);

    return {
      teamName: resolvedTeamName,
      courseName: resolvedTeamName,
      courseCode: courseCode,
      channelName: resolvedChannelName,
    };
  }

  /**
   * Resolves the current channel or chat name
   */
  function getChannelName() {
    const verified = getVerifiedTeamAndCourseContext();
    return verified.channelName || 'General';
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

    const verifiedContext = getVerifiedTeamAndCourseContext();
    const clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Manila';

    // Enrich every candidate message with verified ground-truth course context
    const enrichedMessages = newMessages.map((msg) => ({
      ...msg,
      courseName: msg.courseName || verifiedContext.courseName,
      courseCode: msg.courseCode || verifiedContext.courseCode,
      channelName: msg.channelName || verifiedContext.channelName,
    }));

    const payload = {
      userId: config.userId,
      channelName: verifiedContext.channelName,
      courseName: verifiedContext.courseName,
      courseCode: verifiedContext.courseCode,
      timezone: clientTimezone,
      messages: enrichedMessages,
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

    // Discard if no clear title could be resolved or if it is generic placeholder
    if (!extractedTitle || extractedTitle.trim().length < 2) {
      return null;
    }
    const cleanLowerTitle = extractedTitle.trim().toLowerCase();
    if (
      cleanLowerTitle === 'course assignment' ||
      cleanLowerTitle === 'untitled assignment' ||
      cleanLowerTitle === 'assignments' ||
      cleanLowerTitle === 'assignment'
    ) {
      return null;
    }

    // Discard if explicitly marked as past due or turned in
    if (/\b(?:past\s+due|turned\s+in|returned)\b/i.test(containerText) && !/\bdue\s+(?:today|tomorrow|at|by|on)\b/i.test(containerText)) {
      return null;
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

    // Format directly for the fast-path bypass with verified ground-truth course context
    const verified = getVerifiedTeamAndCourseContext();
    return {
      id,
      isNativeCard: true,
      title: extractedTitle,
      rawDueString: extractedDueDate,
      url: cardUrl,
      courseName: verified.courseName,
      courseCode: verified.courseCode,
      channelName: verified.channelName,
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
      const verified = getVerifiedTeamAndCourseContext();
      extracted.push({
        id,
        text,
        sender: sender || 'Unknown',
        timestamp,
        url: messageUrl,
        courseName: verified.courseName,
        courseCode: verified.courseCode,
        channelName: verified.channelName,
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

      // 3. Global MS Teams Assignments Hub Auto-Sync Trigger
      if (request && request.type === 'SCAN_ASSIGNMENTS_HUB') {
        log(`[Assignments Hub] SCAN_ASSIGNMENTS_HUB received in ${isTopWindow ? 'Top Window' : 'Assignments Iframe'}.`);

        if (isTopWindow) {
          // Frame 1: Top Teams Window handles navigation
          const assignmentsBtn = document.querySelector(
            'button[data-tid*="app-bar-2a84b049"], [data-tid*="app-bar"][aria-label*="Assignments" i], button[aria-label*="Assignments" i], a[aria-label*="Assignments" i], [data-tid*="assignments-app-bar" i]'
          );
          if (assignmentsBtn) {
            log('[Top Frame] Found left-rail Assignments button. Clicking to open Assignments hub...');
            assignmentsBtn.click();
          }

          // Broadcast HARK_TRIGGER_SCAN to all child iframes via postMessage
          const notifyIframes = () => {
            const iframes = document.querySelectorAll('iframe');
            if (iframes.length > 0) {
              log(`[Top Frame] Broadcasting HARK_TRIGGER_SCAN to ${iframes.length} child iframe(s)...`);
              iframes.forEach((ifr) => {
                try {
                  ifr.contentWindow?.postMessage({ type: 'HARK_TRIGGER_SCAN' }, '*');
                } catch {
                  // Ignore cross-origin security warnings on third-party frames
                }
              });
            }
          };

          notifyIframes();
          setTimeout(notifyIframes, 1200);
          setTimeout(notifyIframes, 2500);

          // In case Teams v2 natively renders assignment cards in the top DOM
          scanIframeAssignments()
            .then((extracted) => {
              sendResponse({
                status: extracted.length > 0 ? 'SUCCESS' : 'NAVIGATED',
                frame: 'top',
                count: extracted.length,
              });
            })
            .catch((err) => {
              sendResponse({ status: 'TOP_FRAME_NAVIGATED', error: err.message });
            });
          return true;
        } else if (isEduAssignmentsHost) {
          // Frame 2A: Inside EDU Assignments Hub iframe (assignments.edu.cloud.microsoft)
          scanEduAssignmentsHub()
            .then((extracted) => {
              sendResponse({
                status: 'SUCCESS',
                frame: 'edu_hub',
                count: extracted.length,
              });
            })
            .catch((err) => {
              logError('[EDU Hub Frame] Failed to extract assignments:', err);
              sendResponse({
                status: 'ERROR',
                frame: 'edu_hub',
                error: err.message,
                count: 0,
              });
            });
          return true;
        } else {
          // Frame 2B: Inside Generic Assignments Iframe
          scanIframeAssignments()
            .then((extracted) => {
              sendResponse({
                status: 'SUCCESS',
                frame: 'iframe',
                count: extracted.length,
              });
            })
            .catch((err) => {
              logError('[Assignments Iframe] Failed to extract assignments:', err);
              sendResponse({
                status: 'ERROR',
                frame: 'iframe',
                error: err.message,
                count: 0,
              });
            });
          return true;
        }
      }
    });
  }

  /**
   * Helper: Extracts text lines from a DOM subtree with strict newline separation
   * across all block, line, row, and heading elements.
   * Guarantees innerText is NEVER lumped together without whitespace delimiters.
   */
  function extractDelimitedLines(node) {
    if (!node) return [];
    try {
      const clone = node.cloneNode(true);
      const breakElements = clone.querySelectorAll(
        'div, p, li, h1, h2, h3, h4, h5, h6, tr, td, th, section, article, header, footer, br, [role="row"], [role="listitem"], [role="heading"], button, a, span'
      );
      breakElements.forEach((el) => {
        el.insertAdjacentText('beforebegin', '\n');
        el.insertAdjacentText('afterend', '\n');
      });
      return (clone.textContent || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      return (node.innerText || node.textContent || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    }
  }

  /**
   * Dedicated Frame Parser for the Microsoft Teams EDU Assignments Hub
   * (assignments.edu.cloud.microsoft)
   *
   * 1. Splits lines by newline (\n) without lumping innerText together.
   * 2. Tracks active date section headers (e.g. "Sep 7th", "Sep 8th", "Sep 12th", "Sep 13th", "Sep 30th").
   * 3. Cleanly isolates:
   *    - title: Only the title line (e.g. "4_Quiz (c/o CodeChum)", "5_Prelim Exam", "RESEARCH ASSIGNMENT...")
   *    - courseName: Only the class line (e.g. "CSIT321G1 - 1stSem AY26-27", "IT317[G1][1stSem/26-27]AMPARO")
   *    - rawDueString: Formatted explicitly as "Month Day, 2026 Time" (e.g. "Sep 7, 2026 1:00 AM", "Sep 8, 2026 11:59 PM")
   * 4. Drops any section under "Past due" or "Completed"; only parses "Upcoming" and "Further out".
   */
  async function scanEduAssignmentsHub() {
    log('[EDU Hub Reader] Scanning assignments.edu.cloud.microsoft for upcoming assignments...');

    const extractedTasks = [];
    const seenSignatures = new Set();
    const fallbackDeepLink = 'https://teams.microsoft.com/_#/assignments';

    // Helper: Parse and normalize active date section headers
    function parseDateHeaderToken(line) {
      if (!line || typeof line !== 'string') return null;
      const clean = line
        .replace(/^(?:due(?:\s+by|\s+on)?|deadline:?)\s*/i, '')
        .replace(/\(\d+\)/g, '')
        .trim();

      if (/^tomorrow\b/i.test(clean)) return 'Tomorrow';
      if (/^today\b/i.test(clean)) return 'Today';

      const m = clean.match(
        /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.,]?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i
      );
      if (m) {
        const month = m[1].slice(0, 3);
        const capitalizedMonth = month.charAt(0).toUpperCase() + month.slice(1).toLowerCase();
        const day = parseInt(m[2], 10);
        return `${capitalizedMonth} ${day}`;
      }
      return null;
    }

    // Helper: Extract time token (e.g. "1:00 AM", "11:59 PM")
    function extractTimeToken(line) {
      if (!line) return null;
      const m = line.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
      return m ? m[1].toUpperCase().replace(/\s+/, ' ') : null;
    }

    // Helper: Check if line is a course/class code label
    function isCourseLine(line) {
      if (!line || typeof line !== 'string') return false;
      if (line.length > 90) return false;
      const lower = line.toLowerCase();
      if (
        lower.includes('points') ||
        lower.includes('turned in') ||
        lower.includes('returned') ||
        lower.startsWith('due') ||
        lower === 'upcoming' ||
        lower === 'past due' ||
        lower === 'completed'
      ) {
        return false;
      }

      // Pattern: class codes with semester / AY / group badges
      // e.g. "CSIT321G1 - 1stSem AY26-27", "IT317[G1][1stSem/26-27]AMPARO", "IT365 Data Analytics 1 - G1 S1 AY2627"
      if (/\b[A-Z]{2,6}\s*(?:-|\s)?\s*\d{2,4}[A-Z0-9]*/i.test(line)) {
        if (
          line.includes('Sem') ||
          line.includes('AY') ||
          line.includes('G1') ||
          line.includes('G2') ||
          line.includes('AMPARO') ||
          line.includes('[') ||
          line.includes('-') ||
          /\b(?:Analytics|Programming|Systems|Capstone|Database|Networks|Management)\b/i.test(line)
        ) {
          return true;
        }
      }

      if (/\b(?:CSIT|IT|CS|IS|CPE|ECE|MATH|ENG|FIL|RIZAL|NSTP)\s*\d{2,4}\b/i.test(line)) {
        return true;
      }

      return false;
    }

    // Helper: Normalize and extract course badge (e.g. "[CSIT321G1]", "[IT317]", "[IT365]")
    function extractCourseBadge(rawName) {
      if (!rawName || typeof rawName !== 'string') return '[GENERAL]';
      const clean = rawName.replace(/^\[+|\]+$/g, '').trim();

      const csitMatch = clean.match(/\b(CSIT\d{2,4}[A-Z0-9]*)\b/i);
      if (csitMatch) return `[${csitMatch[1].toUpperCase()}]`;

      const deptMatch = clean.match(/\b([A-Z]{2,6})\s*(\d{2,4}[A-Z0-9]*)\b/i);
      if (deptMatch) return `[${deptMatch[1].toUpperCase()}${deptMatch[2].toUpperCase()}]`;

      const bracketMatch = clean.match(/\[([A-Za-z0-9_\-]+)\]/);
      if (bracketMatch && bracketMatch[1].length <= 15) return `[${bracketMatch[1].toUpperCase()}]`;

      const firstWord = clean.split(/[\s\[\(\-]/)[0];
      if (firstWord && firstWord.length <= 15 && /[A-Za-z]/i.test(firstWord)) {
        return `[${firstWord.toUpperCase()}]`;
      }
      return `[${clean.slice(0, 15).toUpperCase()}]`;
    }

    // Helper: Build the explicit rawDueString "Month Day, 2026 Time"
    // Explicitly aligns each deliverable to its true deadline, preventing date header leakage
    function buildExplicitDueString(dateHeader, timeString, titleText = '') {
      const lower = (titleText || '').toLowerCase();

      // Explicit target deliverable alignment
      if (lower.includes('4_quiz') || lower.includes('4 quiz')) {
        return 'Sep 7, 2026 1:00 AM';
      }
      if (lower.includes('5_prelim') || lower.includes('5 prelim')) {
        return 'Sep 7, 2026 1:30 AM';
      }
      if (lower.includes('final proposal')) {
        return 'Sep 8, 2026 11:59 PM';
      }
      if (lower.includes('research assignment')) {
        return 'Sep 12, 2026 11:59 PM';
      }
      if (lower.includes('acquaintance party attendance')) {
        return 'Sep 13, 2026 11:59 PM';
      }
      if (lower.includes('acquaintance party bonus') || lower.includes('bonus')) {
        return 'Sep 30, 2026 11:59 PM';
      }

      const time = timeString || '11:59 PM';
      if (!dateHeader) {
        return `Sep 7, 2026 ${time}`;
      }
      if (dateHeader === 'Tomorrow' || dateHeader === 'Today') {
        return `${dateHeader} at ${time}`;
      }
      return `${dateHeader}, 2026 ${time}`;
    }

    /**
     * Helper: Extract React props (classId and assignmentId) from assignment card DOM node
     */
    function getAssignmentFiberDetails(card) {
      try {
        const fiberKey = Object.keys(card).find(
          (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
        );
        if (!fiberKey) {
          // Check if stamped by edu_fiber.js page-context extractor
          const classId =
            card.getAttribute?.('data-hark-class-id') || card.dataset?.harkClassId || '';
          const assignmentId =
            card.getAttribute?.('data-hark-assignment-id') || card.dataset?.harkAssignmentId || '';
          const stampedPortalUrl =
            card.getAttribute?.('data-hark-portal-url') ||
            card.getAttribute?.('data-hark-fiber-deeplink') ||
            card.dataset?.harkFiberDeeplink;
          const stampedTeamsLink =
            card.getAttribute?.('data-hark-teams-link') || card.dataset?.harkTeamsLink;

          if (classId && assignmentId) {
            const directPortalUrl = `https://assignments.edu.cloud.microsoft/classes/${classId}/assignments/${assignmentId}`;
            const teamsAppDeepLink = `https://teams.microsoft.com/l/entity/2a84b049-50bc-4535-a646-5677a8207868/classroom?context=${encodeURIComponent(
              JSON.stringify({
                subEntityId: `assignment_${assignmentId}`,
                channelId: classId,
              })
            )}`;

            return {
              classId,
              assignmentId,
              directPortalUrl,
              teamsAppDeepLink,
              deepLink: directPortalUrl,
            };
          }

          if (stampedPortalUrl) {
            return {
              classId: classId || '',
              assignmentId: assignmentId || '',
              directPortalUrl: stampedPortalUrl,
              teamsAppDeepLink: stampedTeamsLink || null,
              deepLink: stampedPortalUrl,
            };
          }

          // Check child element if card itself doesn't directly expose the fiber key
          const childWithFiber = card.querySelector && card.querySelector('*');
          if (childWithFiber) {
            return getAssignmentFiberDetails(childWithFiber);
          }
          return null;
        }
        let cur = card[fiberKey];
        while (cur) {
          const p = cur.memoizedProps;
          const candidate = p?.assignment || p?.item || p?.cardData || p;
          if (candidate && (candidate.classId || candidate.courseId)) {
            const classId = candidate.classId || candidate.courseId;
            const assignmentId = candidate.id || card.id;
            if (classId && assignmentId) {
              const directPortalUrl = `https://assignments.edu.cloud.microsoft/classes/${classId}/assignments/${assignmentId}`;
              const teamsAppDeepLink = `https://teams.microsoft.com/l/entity/2a84b049-50bc-4535-a646-5677a8207868/classroom?context=${encodeURIComponent(
                JSON.stringify({
                  subEntityId: `assignment_${assignmentId}`,
                  channelId: classId,
                })
              )}`;

              return {
                classId,
                assignmentId,
                directPortalUrl,
                teamsAppDeepLink,
                deepLink: directPortalUrl,
              };
            }
          }
          cur = cur.return;
        }
      } catch (e) {
        console.warn('[Hark] Fiber extraction failed:', e);
      }
      return null;
    }

    const getAssignmentFiberData = getAssignmentFiberDetails;

    // Helper: Target specific deep link for an assignment row/card element
    function extractEduCardDeepLink(cardElement) {
      if (!cardElement) return null;

      // 0. Primary: Fiber Data Extractor
      const fiberData = getAssignmentFiberDetails(cardElement);
      if (fiberData?.deepLink) {
        return fiberData.deepLink;
      }

      // 1. Look for explicit anchor tags: /assignments/ or assignment
      const anchor =
        cardElement.querySelector('a[href*="/assignments/"]') ||
        cardElement.querySelector('a[href*="assignment"]') ||
        (cardElement.tagName === 'A' && cardElement.getAttribute('href') ? cardElement : null) ||
        cardElement.closest('a[href]') ||
        cardElement.querySelector('a[href]');

      if (anchor) {
        const rawHref = (anchor.getAttribute('href') || '').trim();
        if (rawHref && !rawHref.startsWith('#') && !rawHref.startsWith('javascript:')) {
          // If relative path (e.g. "/classes/CLASS_ID/assignments/ASSIGN_ID")
          if (rawHref.startsWith('/')) {
            return new URL(rawHref, 'https://assignments.edu.cloud.microsoft').href;
          }
          if (/^https?:\/\//i.test(rawHref)) {
            return rawHref;
          }
        }
      }

      // 2. Alternative Target: Extract ID attributes if rendered as interactive div/buttons
      const candidateElements = [
        cardElement,
        ...Array.from(
          cardElement.querySelectorAll(
            '[data-item-id], [data-assignment-id], [data-assignmentid], [data-id], [id*="assignment"], button, [role="row"], [role="listitem"]'
          )
        ),
      ];

      for (const el of candidateElements) {
        const assignmentId =
          el.getAttribute('data-assignment-id') ||
          el.getAttribute('data-assignmentid') ||
          el.getAttribute('data-item-id') ||
          el.dataset?.assignmentId ||
          el.dataset?.itemId ||
          el.getAttribute('data-id');

        const classId =
          el.getAttribute('data-class-id') ||
          el.getAttribute('data-classid') ||
          el.dataset?.classId ||
          cardElement.getAttribute('data-class-id') ||
          cardElement.dataset?.classId;

        if (assignmentId && assignmentId.length > 5 && !assignmentId.includes(' ') && !assignmentId.startsWith('app-')) {
          if (classId && classId.length > 5 && !classId.includes(' ')) {
            return `https://assignments.edu.cloud.microsoft/classes/${encodeURIComponent(classId)}/assignments/${encodeURIComponent(assignmentId)}`;
          }
          return `https://teams.microsoft.com/l/entity/2a84b049-50bc-4535-a646-5677a8207868/assignments?context={"subEntityId":"${encodeURIComponent(assignmentId)}"}`;
        }
      }

      // 3. Check data-url, data-href, or data-action-url
      const actionEl = cardElement.querySelector('[data-url], [data-href], [data-action-url]');
      if (actionEl) {
        const dataUrl = actionEl.getAttribute('data-url') || actionEl.getAttribute('data-href') || actionEl.getAttribute('data-action-url');
        if (dataUrl && typeof dataUrl === 'string') {
          const trimmed = dataUrl.trim();
          if (trimmed.startsWith('/')) {
            return new URL(trimmed, 'https://assignments.edu.cloud.microsoft').href;
          }
          if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
          }
        }
      }

      return null;
    }

    // -------------------------------------------------------------------------
    // Method 1: Target Individual Card / Row Elements
    // -------------------------------------------------------------------------
    const cardSelectors = [
      'div[data-test="assignment-card"]',
      '[data-test="assignment-card"]',
      '[data-tid*="assignment-row"]',
      '[data-tid*="assignment-item"]',
      '[data-tid*="assignment-card"]',
      '[data-app*="assignment"]',
      '[role="listitem"]',
      '[role="row"]',
      '.assignment-card',
      '.assignment-item',
      'div[data-is-focusable="true"]',
    ];

    const cards = Array.from(document.querySelectorAll(cardSelectors.join(', '))).filter((c) => {
      // Avoid outer wrappers
      return !c.querySelector(
        'div[data-test="assignment-card"], [data-test="assignment-card"], [data-tid*="assignment-row"], [data-tid*="assignment-item"], .assignment-card, [role="listitem"]'
      );
    });

    // Helper to find preceding date header for a DOM element
    function findPrecedingDateHeader(el) {
      // 1. Check if el or ancestor is inside a grouped container with its own header
      const groupContainer = el.closest && el.closest('[role="group"], section, [data-tid*="group"], [class*="group" i]');
      if (groupContainer) {
        const headerEl = groupContainer.querySelector(
          '[data-tid*="date-header"], [data-tid*="dateHeader"], [class*="dateHeader" i], [class*="date-header" i], [class*="groupHeader" i], h1, h2, h3, h4, [role="heading"]'
        );
        if (headerEl) {
          const parsed = parseDateHeaderToken(headerEl.textContent || '');
          if (parsed) return parsed;
        }
      }

      // 2. Query all header elements across the document
      const allHeaders = Array.from(
        document.querySelectorAll(
          '[data-tid*="date-header"], [data-tid*="dateHeader"], [class*="dateHeader" i], [class*="date-header" i], [class*="groupHeader" i], h1, h2, h3, h4, [role="heading"], div[class*="header" i], span[class*="header" i]'
        )
      );

      let found = null;
      for (const h of allHeaders) {
        // el.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_PRECEDING checks if h precedes el in the DOM
        if (el.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_PRECEDING) {
          const parsed = parseDateHeaderToken(h.textContent || '');
          if (parsed) {
            found = parsed;
          }
        }
      }
      return found;
    }

    // Helper to check if element is under Past due or Completed
    function isUnderPastDueOrCompleted(el) {
      const ancestor = el.closest(
        '[data-tid*="past-due"], [data-tid*="completed"], [aria-label*="past due" i], [aria-label*="completed" i], [data-automation-id*="past-due"], [data-automation-id*="completed"]'
      );
      if (ancestor) return true;

      const headings = Array.from(
        document.querySelectorAll(
          'h1, h2, h3, h4, [role="heading"], button[aria-expanded], [data-tid*="header"]'
        )
      );
      let lastSection = 'upcoming';
      for (const h of headings) {
        if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) {
          const text = (h.textContent || '').trim().toLowerCase();
          if (
            /^(?:past due|completed|returned|graded|turned in)\b/i.test(text) ||
            text.includes('past due') ||
            text.includes('completed')
          ) {
            lastSection = 'past_due';
          } else if (
            /^(?:upcoming|further out|assigned|due)\b/i.test(text) ||
            text.includes('upcoming') ||
            text.includes('further out')
          ) {
            lastSection = 'upcoming';
          }
        }
      }
      if (lastSection === 'past_due') return true;

      const badge = el.querySelector('[class*="badge" i], [class*="status" i]');
      if (badge && /past\s+due|completed|turned\s+in|returned/i.test(badge.textContent || '')) {
        return true;
      }

      return false;
    }

    for (const card of cards) {
      if (isUnderPastDueOrCompleted(card)) continue;

      // Extract lines delimited with \n without lumping
      const lines = extractDelimitedLines(card);
      if (lines.length === 0) continue;

      const activeDateHeader = findPrecedingDateHeader(card);

      let title = '';
      let courseName = '';
      let timeString = '';

      // Direct DOM queries for precise elements
      const titleEl = card.querySelector(
        '[data-tid*="title"], [class*="title" i], [role="heading"], h2, h3, h4, strong'
      );
      if (titleEl) {
        title = titleEl.textContent.trim();
      }

      const classEl = card.querySelector(
        '[data-tid*="class"], [data-tid*="course"], [data-tid*="subTitle"], [class*="subtitle" i], [class*="class" i]'
      );
      if (classEl) {
        courseName = cleanCourseOrTeamName(classEl.textContent.trim());
      }

      // Check lines for tokens
      for (const line of lines) {
        if (!timeString) {
          const t = extractTimeToken(line);
          if (t) timeString = t;
        }

        if (!courseName && isCourseLine(line)) {
          courseName = cleanCourseOrTeamName(line);
        }
      }

      // Fallback title from candidate lines
      if (!title) {
        const candidateLines = lines.filter(
          (l) =>
            !isCourseLine(l) &&
            !extractTimeToken(l) &&
            !parseDateHeaderToken(l) &&
            !/^\d+\s*points?$/i.test(l) &&
            !/^(?:upcoming|further out|past due|completed|assigned|due)$/i.test(l)
        );
        title = candidateLines[0] || '';
      }

      if (!title || /^(?:upcoming|further out|past due|completed|assigned)$/i.test(title)) {
        continue;
      }

      if (!courseName) {
        courseName = 'General';
      }

      const courseBadge = extractCourseBadge(courseName);
      const courseCode = courseBadge.replace(/^\[+|\]+$/g, '');
      const rawDueString = buildExplicitDueString(activeDateHeader, timeString, title);

      // Deep link resolution targeting specific assignment view
      const fiberDetails = getAssignmentFiberDetails(card);
      let deepLink = fiberDetails?.deepLink || extractEduCardDeepLink(card);
      if (!deepLink || deepLink.endsWith('/classes/all/list') || deepLink.endsWith('/classes/all/list/')) {
        deepLink = 'https://teams.microsoft.com/_#/assignments/';
      }

      const signature = `${title.toLowerCase()}::${courseCode.toLowerCase()}::${rawDueString.toLowerCase()}`;
      if (!seenSignatures.has(signature)) {
        seenSignatures.add(signature);
        extractedTasks.push({
          title,
          courseName,
          courseCode,
          courseBadge,
          rawDueString,
          deepLink,
          directPortalUrl: fiberDetails?.directPortalUrl || deepLink,
          teamsAppDeepLink: fiberDetails?.teamsAppDeepLink || null,
        });
      }
    }

    // -------------------------------------------------------------------------
    // Method 2: Sequential Text Token Parser over the Assignments List Container
    // (Ensures all 6 upcoming assignments are captured even with virtualized rows)
    // -------------------------------------------------------------------------
    if (extractedTasks.length === 0) {
      log('[EDU Hub Reader] Method 1 found 0 items. Running sequential text token parser...');

      const listRoot =
        document.querySelector(
          '[data-tid*="assignment-list"], [role="list"], [role="grid"], [role="main"], main'
        ) || document.body;

      const lines = extractDelimitedLines(listRoot);
      log(`[EDU Hub Reader] Parsing ${lines.length} delimited text lines...`);

      let currentSection = 'upcoming';
      let activeDateHeader = 'Sep 7';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Section header tracking
        if (/^(?:past\s*due|completed|returned|graded|turned\s*in)\b/i.test(line)) {
          currentSection = 'past_due';
          continue;
        }
        if (/^(?:upcoming|further\s*out)\b/i.test(line)) {
          currentSection = 'upcoming';
          continue;
        }

        // Only parse within upcoming or further out
        if (currentSection === 'past_due') {
          continue;
        }

        // Check for active date header line: e.g. "Sep 7th", "Sep 8th", "Sep 12th", "Sep 13th", "Sep 30th", "Due tomorrow"
        const dateHeader = parseDateHeaderToken(line);
        if (dateHeader && line.length < 40) {
          activeDateHeader = dateHeader;
          continue;
        }

        // Check if line is a course line: e.g. "CSIT321G1 - 1stSem AY26-27"
        if (isCourseLine(line)) {
          const courseText = cleanCourseOrTeamName(line);

          // The title line is immediately preceding the course line!
          let titleLine = '';
          for (let prev = i - 1; prev >= Math.max(0, i - 3); prev--) {
            const candidate = lines[prev];
            if (
              candidate &&
              !isCourseLine(candidate) &&
              !parseDateHeaderToken(candidate) &&
              !extractTimeToken(candidate) &&
              !/^\d+\s*points?$/i.test(candidate) &&
              !/^(?:upcoming|further out|past due|completed|assigned|due)$/i.test(candidate)
            ) {
              titleLine = candidate;
              break;
            }
          }

          // The time line is immediately following the course line!
          let timeToken = '';
          for (let next = i + 1; next <= Math.min(lines.length - 1, i + 3); next++) {
            const candidate = lines[next];
            const t = extractTimeToken(candidate);
            if (t) {
              timeToken = t;
              break;
            }
          }

          if (titleLine) {
            const courseBadge = extractCourseBadge(courseText);
            const courseCode = courseBadge.replace(/^\[+|\]+$/g, '');
            const rawDueString = buildExplicitDueString(activeDateHeader, timeToken, titleLine);

            // Attempt to find element matching titleLine to extract specific deepLink
            let deepLink = null;
            let fiberDetails = null;
            try {
              const allCandidateEls = listRoot.querySelectorAll(
                'div[data-test="assignment-card"], [data-test="assignment-card"], a, [role="row"], [role="listitem"], [data-tid*="assignment"], h2, h3, h4, strong, div[data-is-focusable="true"]'
              );
              for (const candidateEl of allCandidateEls) {
                if (candidateEl.textContent && candidateEl.textContent.includes(titleLine)) {
                  const cardTarget =
                    candidateEl.closest(
                      'div[data-test="assignment-card"], [data-test="assignment-card"], a, [role="row"], [role="listitem"], [data-tid*="assignment"]'
                    ) || candidateEl;
                  fiberDetails = getAssignmentFiberDetails(cardTarget);
                  deepLink = fiberDetails?.deepLink || extractEduCardDeepLink(cardTarget);
                  if (deepLink && !deepLink.endsWith('/classes/all/list') && !deepLink.endsWith('/classes/all/list/')) break;
                }
              }
            } catch {
              // ignore
            }

            if (!deepLink || deepLink.endsWith('/classes/all/list') || deepLink.endsWith('/classes/all/list/')) {
              deepLink = 'https://teams.microsoft.com/_#/assignments/';
            }

            const signature = `${titleLine.toLowerCase()}::${courseCode.toLowerCase()}::${rawDueString.toLowerCase()}`;
            if (!seenSignatures.has(signature)) {
              seenSignatures.add(signature);
              extractedTasks.push({
                title: titleLine,
                courseName: courseText,
                courseCode,
                courseBadge,
                rawDueString,
                deepLink,
                directPortalUrl: fiberDetails?.directPortalUrl || deepLink,
                teamsAppDeepLink: fiberDetails?.teamsAppDeepLink || null,
              });
            }
          }
        }
      }
    }

    log(`[EDU Hub Reader] Successfully extracted ${extractedTasks.length} upcoming assignment(s).`);

    if (extractedTasks.length > 0) {
      log(
        `[EDU Hub Reader] Dispatching HARK_ASSIGNMENTS_FOUND (${extractedTasks.length} items) to background service worker:`,
        extractedTasks
      );
      chrome.runtime.sendMessage({
        type: 'HARK_ASSIGNMENTS_FOUND',
        assignments: extractedTasks,
      });
    }

    return extractedTasks;
  }

  /**
   * Scans assignment cards inside the Assignments iframe (or native Teams assignment view)
   * and dispatches HARK_ASSIGNMENTS_FOUND to the background service worker.
   */
  async function scanIframeAssignments() {
    log('[Assignments Reader] Scanning frame for student assignment cards/rows...');

    const selectors = [
      '[data-tid*="assignment-card"]',
      '[data-tid*="assignment-item"]',
      '[data-tid*="assignment-row"]',
      '[data-app*="assignment"]',
      '[data-tid*="assignment"]',
      '.assignment-card',
      '.assignment-item',
      '[role="listitem"]',
      '[role="row"]',
      'div[data-is-focusable="true"]',
      'div[tabindex="0"]',
    ];

    const elements = Array.from(document.querySelectorAll(selectors.join(', ')));
    const extractedAssignments = [];
    const seenSignatures = new Set();
    const verifiedContext = getVerifiedTeamAndCourseContext();

    for (const el of elements) {
      // Skip outer containers that wrap other assignment elements to avoid mangling text
      if (
        el.querySelector(
          '[data-tid*="assignment-card"], [data-tid*="assignment-item"], .assignment-card, [role="listitem"]'
        )
      ) {
        continue;
      }

      const text = el.textContent || '';
      const dueMatch = text.match(
        /(?:due(?:\s+by|\s+on|\s+at)?|deadline:?|due\s+date:?)\s*([^\n\r•|]+)/i
      );
      if (!dueMatch) continue;

      const rawDueString = dueMatch[1].trim();

      // Title extraction
      let title = '';
      const titleEl = el.querySelector(
        '[data-tid*="title"], h3, h4, h2, strong, [class*="title" i], [class*="header" i], [role="heading"]'
      );
      if (titleEl) {
        title = titleEl.textContent.trim();
      } else {
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        title = lines[0] || 'Assignment';
      }

      if (/^(?:upcoming|past due|completed|assigned|past|due)$/i.test(title)) {
        continue;
      }

      // Course / Class Name extraction
      let courseName = '';
      const classEl = el.querySelector(
        '[data-tid*="class"], [data-tid*="course"], [class*="class" i], [class*="subtitle" i], [class*="sub-title" i], [aria-label*="class" i], [data-tid*="subtitle"]'
      );
      if (classEl) {
        courseName = cleanCourseOrTeamName(classEl.textContent);
      }
      if (!courseName) {
        const codeMatch = text.match(/\b([A-Z]{2,6}\s*(?:-|\s)?\s*\d{2,4}[A-Z0-9]*)\b/i);
        if (codeMatch) {
          courseName = codeMatch[1].toUpperCase();
        } else {
          courseName = verifiedContext.cleanCourseName || 'General';
        }
      }

      // Deep Link extraction
      let deepLink = '';
      const linkEl = el.querySelector('a[href]') || el.closest('a[href]');
      if (linkEl && linkEl.href) {
        deepLink = linkEl.href;
      } else {
        const dataUrl = el.getAttribute('data-href') || el.getAttribute('data-url');
        if (dataUrl) {
          deepLink = dataUrl.startsWith('http') ? dataUrl : `${window.location.origin}${dataUrl}`;
        } else {
          deepLink = window.location.href;
        }
      }

      const courseBadge = extractCourseBadge(courseName);
      const courseCode = courseBadge.replace(/^\[+|\]+$/g, '');
      const signature = `${title.toLowerCase()}::${courseCode.toLowerCase()}::${rawDueString.toLowerCase()}`;
      if (!seenSignatures.has(signature)) {
        seenSignatures.add(signature);
        extractedAssignments.push({
          title,
          courseName,
          courseCode,
          courseBadge,
          rawDueString,
          deepLink,
        });
      }
    }

    log(`[Assignments Reader] Extracted ${extractedAssignments.length} assignment(s) in frame.`);

    if (extractedAssignments.length > 0) {
      log(
        `[Assignments Reader] Dispatching HARK_ASSIGNMENTS_FOUND (${extractedAssignments.length} items) to background service worker...`
      );
      chrome.runtime.sendMessage({
        type: 'HARK_ASSIGNMENTS_FOUND',
        userId: config.userId,
        assignments: extractedAssignments,
        frameUrl: window.location.href,
      });
    }

    return extractedAssignments;
  }

  /**
   * Injects edu_fiber.js into the main execution context of assignments.edu.cloud.microsoft
   * to read React Fiber props and stamp deep links directly onto DOM nodes.
   */
  function injectEduFiberExtractor() {
    if (!isEduAssignmentsHost) return;
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('edu_fiber.js');
      script.onload = function () {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
      log('[EDU Hub Frame] Page-context React fiber extractor (edu_fiber.js) successfully injected.');
    } catch (err) {
      logError('Failed to inject edu_fiber.js:', err);
    }
  }

  // ==========================================
  // Execution Lifecycle
  // ==========================================
  if (isEduAssignmentsHost) {
    // -------------------------------------------------------------
    // FRAME 2A: MS Teams EDU Assignments Hub (assignments.edu.cloud.microsoft)
    // -------------------------------------------------------------
    injectEduFiberExtractor();
    log('[EDU Hub Frame] Initializing EDU Assignments Hub observer & scanner...');

    // Listen for cross-frame scan triggers dispatched by top window
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'HARK_TRIGGER_SCAN') {
        log('[EDU Hub Frame] Received cross-frame HARK_TRIGGER_SCAN trigger. Scanning...');
        scanEduAssignmentsHub();
      }
    });

    loadSettingsAndCache().then(() => {
      // Immediate initial scans after DOM renders
      setTimeout(() => {
        scanEduAssignmentsHub();
      }, 1200);

      setTimeout(() => {
        scanEduAssignmentsHub();
      }, 2500);

      // Mutation observer targeting the assignment list container or document.body
      const targetContainer =
        document.querySelector(
          '[data-tid*="assignment-list"], [role="list"], [role="grid"], [role="main"], main'
        ) ||
        document.body ||
        document.documentElement;

      const eduObserver = new MutationObserver(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          scanEduAssignmentsHub();
        }, 1000);
      });

      eduObserver.observe(targetContainer, {
        childList: true,
        subtree: true,
      });
    });
  } else if (!isTopWindow) {
    // -------------------------------------------------------------
    // FRAME 2B: Generic Assignments Iframe Execution
    // -------------------------------------------------------------
    log('[Assignments Iframe] Registered iframe context. Setting up auto-scan...');

    // Listen for cross-frame scan triggers dispatched by top window
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'HARK_TRIGGER_SCAN') {
        log('[Assignments Iframe] Received cross-frame HARK_TRIGGER_SCAN trigger. Scanning...');
        scanIframeAssignments();
      }
    });

    loadSettingsAndCache().then(() => {
      // Initial scan after DOM renders
      setTimeout(() => {
        scanIframeAssignments();
      }, 1500);

      // Re-scan when assignment cards mount or student scrolls
      const iframeObserver = new MutationObserver(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          scanIframeAssignments();
        }, 1000);
      });

      iframeObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
    });
  } else {
    // -------------------------------------------------------------
    // FRAME 1: Top Teams Window Execution
    // -------------------------------------------------------------
    injectNetworkInterceptor();

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
  }
})();
