/**
 * Hark for MS Teams - EDU Assignments Hub React Fiber Extractor (edu_fiber.js)
 * Injected into assignments.edu.cloud.microsoft to read React Fiber memoizedProps
 * in the page execution context and stamp deep links directly onto DOM nodes.
 */

(function () {
  const LOG_STYLE = 'color: #10b981; font-weight: bold; background: #064e3b; padding: 2px 4px; border-radius: 2px;';

  function extractCardData(cardElement) {
    if (!cardElement) return null;
    // Search both the element and its direct interactive children for React Fiber
    const nodesToInspect = [
      cardElement,
      cardElement.querySelector('button'),
      cardElement.querySelector('[data-test*="assignment"]'),
      cardElement.querySelector('[role="button"]'),
      ...cardElement.querySelectorAll('div')
    ].filter(Boolean);

    for (const el of nodesToInspect) {
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (!fiberKey) continue;

      let cur = el[fiberKey];
      while (cur) {
        const p = cur.memoizedProps;
        // Check assignment model candidate
        const assignment = p?.assignment || p?.item || p?.cardData || (p?.id && (p?.classId || p?.courseId) ? p : null);
        if (assignment) {
          const assignmentId = assignment.id || assignment.assignmentId;
          const classId = assignment.classId || assignment.courseId;
          const title = assignment.displayName || assignment.title || assignment.name;
          
          // Validate UUID format
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (uuidRegex.test(assignmentId)) {
            return {
              assignmentId,
              classId: classId || '',
              title: title || cardElement.querySelector('h3, [data-test*="title"]')?.innerText?.trim() || '',
              courseName: assignment.className || assignment.courseName || '',
              dueDateTime: assignment.dueDateTime || assignment.dueDate || null,
              isFiberStamped: true
            };
          }
        }
        cur = cur.return;
      }
    }
    return null;
  }

  function extractAnchorData(cardEl) {
    if (!cardEl) return null;
    const links = Array.from(cardEl.querySelectorAll('a[href]'));
    if (cardEl.tagName === 'A' && cardEl.getAttribute('href')) links.unshift(cardEl);
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const match = href.match(/\/classes\/([a-f0-9-]+)\/assignments\/([a-f0-9-]+)/i);
      if (match) {
        return {
          classId: match[1],
          assignmentId: match[2],
        };
      }
    }
    return null;
  }

  function extractPropsFromCard(cardEl) {
    try {
      if (cardEl.getAttribute('data-hark-fiber-deeplink') && cardEl.getAttribute('data-hark-title') && cardEl.getAttribute('data-hark-assignment-id')) return;

      const fiberData = extractCardData(cardEl);
      const anchorData = !fiberData?.assignmentId ? extractAnchorData(cardEl) : null;

      const assignmentId = fiberData?.assignmentId || anchorData?.assignmentId || null;
      const classId = fiberData?.classId || anchorData?.classId || null;
      const fullTitle = fiberData?.title || cardEl.querySelector('h3, [data-test*="title"], [data-tid*="title"]')?.innerText?.trim();
      let fullClassName = fiberData?.courseName;
      if (!fullClassName || /^due\b/i.test(fullClassName)) {
        const classEl = cardEl.querySelector('[data-test*="class"], [data-test*="course"], [data-tid*="class"], [data-tid*="course"]');
        const candidate = classEl?.innerText?.trim();
        if (candidate && !/^due\b/i.test(candidate)) {
          fullClassName = candidate;
        }
      }
      const dueDate = fiberData?.dueDateTime;

      if (classId && assignmentId) {
        const directPortalUrl = `https://assignments.edu.cloud.microsoft/classes/${classId}/assignments/${assignmentId}`;
        const teamsAppDeepLink = `https://teams.microsoft.com/l/entity/2a84b049-50bc-4535-a646-5677a8207868/classroom?context=${encodeURIComponent(
          JSON.stringify({
            subEntityId: `assignment_${assignmentId}`,
            channelId: classId,
          })
        )}`;
        cardEl.setAttribute('data-hark-fiber-deeplink', directPortalUrl);
        cardEl.setAttribute('data-hark-portal-url', directPortalUrl);
        cardEl.setAttribute('data-hark-teams-link', teamsAppDeepLink);
        cardEl.setAttribute('data-hark-class-id', String(classId));
        cardEl.setAttribute('data-hark-assignment-id', String(assignmentId));
      }
      if (fullTitle) {
        cardEl.setAttribute('data-hark-title', String(fullTitle).trim());
      }
      if (fullClassName && !/^due\b/i.test(fullClassName)) {
        cardEl.setAttribute('data-hark-class-name', String(fullClassName).trim());
      }
      if (dueDate) {
        cardEl.setAttribute('data-hark-due-date', String(dueDate).trim());
      }
      if (classId && assignmentId && fullTitle) {
        console.log(
          '%c[Hark Fiber]%c Stamped assignment with full title & links:',
          LOG_STYLE,
          'color: #10b981;',
          assignmentId,
          fullTitle
        );
      }
    } catch (err) {
      console.warn('[Hark] Fiber extraction error in edu_fiber.js:', err);
    }
  }

  function syncAllCards() {
    try {
      const cards = document.querySelectorAll(
        'div[data-test="assignment-card"], [data-test="assignment-card"], [data-tid*="assignment-card"], [data-tid*="assignment-row"], [role="listitem"]'
      );
      cards.forEach(extractPropsFromCard);
    } catch {
      // ignore
    }
  }

  // Initial scan
  syncAllCards();

  // Observe DOM for newly rendered or virtualized assignment cards (debounced by 1500ms for PRF-01)
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      syncAllCards();
    }, 1500);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      syncAllCards();
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
})();
