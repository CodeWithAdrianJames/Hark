/**
 * Hark - In-Browser Teams DOM Link Verification Snippet
 *
 * HOW TO TEST:
 * 1. Open Microsoft Teams (https://teams.microsoft.com) in your browser.
 * 2. Click into any specific Team and Channel where an assignment or announcement is located.
 * 3. Open Chrome DevTools (Press F12 or Ctrl+Shift+I) -> Go to the "Console" tab.
 * 4. Copy and paste the entire script below and press Enter.
 * 5. Verify the output:
 *    - "Detected Active Channel" matches the channel you are currently viewing.
 *    - "Canonical Channel Link" has the exact format:
 *      https://teams.microsoft.com/l/channel/<channelId>/<channelName>?groupId=<groupId>&tenantId=<tenantId>
 * 6. Copy the resolved link, paste it into an incognito / new tab, and confirm Teams routes directly to that exact team and channel!
 */

(function testHarkTeamsDomLink() {
  console.log('%c[Hark Test Harness]%c Running DOM deep-link verification...', 'color: #818cf8; font-weight: bold; background: #0f172a; padding: 2px 6px;', 'color: inherit;');

  // 1. Channel Name
  const headerEl =
    document.querySelector('[data-tid="channel-name"]') ||
    document.querySelector('[data-tid="chat-header-title"]') ||
    document.querySelector('[data-tid="thread-header-title"]') ||
    document.querySelector('h2[data-tid*="header"]');
  const channelName = headerEl ? headerEl.textContent.trim() : document.title.replace(/\s*\|\s*Microsoft Teams$/i, '').trim();

  // 2. Active Channel Node in Sidebar
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
  let matchedSelector = null;
  for (const sel of activeSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      activeNode = el;
      matchedSelector = sel;
      break;
    }
  }

  let resolvedChannelUrl = null;
  let channelAnchorHref = null;
  let detectedChannelId = null;
  let detectedGroupId = null;
  let detectedTenantId = null;

  if (activeNode) {
    const anchor = activeNode.tagName === 'A' && activeNode.getAttribute('href') ? activeNode : activeNode.querySelector('a[href]');
    if (anchor) {
      channelAnchorHref = anchor.getAttribute('href');
      if (channelAnchorHref && !channelAnchorHref.startsWith('#')) {
        resolvedChannelUrl = channelAnchorHref.startsWith('http') ? channelAnchorHref : new URL(channelAnchorHref, window.location.origin).href;
      }
    }

    detectedChannelId =
      activeNode.getAttribute('data-channel-id') ||
      activeNode.getAttribute('data-tid')?.match(/19:[a-zA-Z0-9_\-]+(?:%40|@)thread\.[a-zA-Z0-9_\-]+/i)?.[0] ||
      null;

    const teamParent = activeNode.closest('[data-team-id], [data-group-id], [data-tid*="team"]');
    detectedGroupId = teamParent?.getAttribute('data-group-id') || teamParent?.getAttribute('data-team-id') || null;
  }

  // Parse parameters
  if (resolvedChannelUrl) {
    try {
      const parsed = new URL(resolvedChannelUrl);
      detectedGroupId = parsed.searchParams.get('groupId') || detectedGroupId;
      detectedTenantId = parsed.searchParams.get('tenantId') || detectedTenantId;
    } catch {}
  }

  if (!detectedTenantId || !detectedGroupId) {
    try {
      const urlObj = new URL(window.location.href);
      detectedTenantId = detectedTenantId || urlObj.searchParams.get('tenantId');
      detectedGroupId = detectedGroupId || urlObj.searchParams.get('groupId');
    } catch {}
  }

  // 3. Native Card pinpoint check
  const cardContainers = document.querySelectorAll('.ui-card, .ac-container, [data-tid*="assignment"]');
  let firstCardPinpoint = null;
  if (cardContainers.length > 0) {
    const card = cardContainers[0];
    let threadId = null;
    let curr = card;
    while (curr && curr !== document.body) {
      const combined = `${curr.getAttribute('data-thread-id') || ''} ${curr.getAttribute('data-conversation-id') || ''} ${curr.getAttribute('data-tid') || ''} ${curr.id || ''} ${curr.getAttribute('data-mid') || ''}`;
      const match = combined.match(/19:[a-zA-Z0-9_\-]+(?:%40|@)thread\.[a-zA-Z0-9_\-]+/i);
      if (match) {
        threadId = decodeURIComponent(match[0]);
        break;
      }
      curr = curr.parentElement;
    }

    const msgParent = card.closest('[data-mid], [data-message-id], [id^="chat-message-"], [data-tid*="message"], [role="listitem"]') || card;
    const rawMid = msgParent.getAttribute('data-mid') || msgParent.getAttribute('data-message-id') || msgParent.dataset?.mid;
    const cleanMid = rawMid ? String(rawMid).replace(/^chat-message-/i, '').trim() : null;

    if (threadId && cleanMid) {
      let pinpoint = `https://teams.microsoft.com/l/message/${encodeURIComponent(threadId)}/${encodeURIComponent(cleanMid)}`;
      const q = [];
      if (detectedGroupId) q.push(`groupId=${encodeURIComponent(detectedGroupId)}`);
      if (detectedTenantId) q.push(`tenantId=${encodeURIComponent(detectedTenantId)}`);
      if (q.length > 0) pinpoint += `?${q.join('&')}`;
      firstCardPinpoint = pinpoint;
    }
  }

  console.log('%c[Hark Link Debug Result]', 'color: #00ffff; font-weight: bold;', {
    detectedChannel: channelName,
    sidebarActiveSelector: matchedSelector,
    sidebarAnchorHref: channelAnchorHref,
    detectedGroupId: detectedGroupId,
    detectedTenantId: detectedTenantId,
    resolvedCanonicalChannelUrl: resolvedChannelUrl,
    firstCardPinpointMessageUrl: firstCardPinpoint || '(No card on screen or using channel link)',
  });

  console.log('%c👉 Copy this URL to test in an Incognito/New Tab:', 'color: #34d399; font-weight: bold;');
  console.log(firstCardPinpoint || resolvedChannelUrl || window.location.href);
})();
