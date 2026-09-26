/**
 * Hark for MS Teams - EDU Assignments Hub React Fiber Extractor (edu_fiber.js)
 * Injected into assignments.edu.cloud.microsoft to read React Fiber memoizedProps
 * in the page execution context and stamp deep links directly onto DOM nodes.
 */

(function () {
  const LOG_STYLE = 'color: #10b981; font-weight: bold; background: #064e3b; padding: 2px 4px; border-radius: 2px;';

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const UUID_EXTRACT_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  /**
   * Generates a deterministic RFC 4122 compliant synthetic UUID from an input string.
   */
  function generateDeterministicUuid(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57, h3 = 0x9e3779b9, h4 = 0x7b5d21a1;
    const s = String(str || '').trim().toLowerCase();
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
      h3 = Math.imul(h3 ^ ch, 3812015801);
      h4 = Math.imul(h4 ^ ch, 2860486313);
    }
    const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
    const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
    const p3 = (h3 >>> 0).toString(16).padStart(8, '0');
    const p4 = (h4 >>> 0).toString(16).padStart(8, '0');
    const hex = p1 + p2 + p3 + p4;

    const timeLow = hex.slice(0, 8);
    const timeMid = hex.slice(8, 12);
    const timeHiAndVersion = '4' + hex.slice(13, 16);
    const clockSeq = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hex.slice(18, 20);
    const node = hex.slice(20, 32);
    return `${timeLow}-${timeMid}-${timeHiAndVersion}-${clockSeq}-${node}`.toLowerCase();
  }

  function findGuidInProps(obj, depth = 0) {
    if (!obj || depth > 2) return null;
    if (typeof obj === 'string') {
      const m = obj.match(UUID_EXTRACT_REGEX);
      return m ? m[0] : null;
    }
    if (typeof obj === 'object') {
      const priorityKeys = ['id', 'assignmentId', 'itemId', 'cardDataId', 'cardId', 'guid', 'key', 'assignmentGuid'];
      for (const k of priorityKeys) {
        if (obj[k] && typeof obj[k] === 'string') {
          const m = obj[k].match(UUID_REGEX);
          if (m) return m[0];
        }
      }
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
          const m = v.match(UUID_EXTRACT_REGEX);
          if (m) return m[0];
        } else if (v && typeof v === 'object' && depth < 2) {
          const res = findGuidInProps(v, depth + 1);
          if (res) return res;
        }
      }
    }
    return null;
  }

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
        if (p) {
          // 1. Check direct assignment model candidate
          const assignment = p?.assignment || p?.item || p?.cardData || (p?.id && (p?.classId || p?.courseId) ? p : null);
          let assignmentId = assignment?.id || assignment?.assignmentId || p.assignmentId || p.itemId || null;
          const classId = assignment?.classId || assignment?.courseId || p.classId || p.courseId || '';
          const title = assignment?.displayName || assignment?.title || assignment?.name || p.title || p.displayName;
          let courseName = assignment?.className || assignment?.courseName || p.className || p.courseName || '';
          const dueDateTime = assignment?.dueDateTime || assignment?.dueDate || p.dueDateTime || p.dueDate || null;

          // Reject courseName if it contains "Due" or time format
          if (courseName && (/\bdue\b/i.test(courseName) || /\b\d{1,2}:\d{2}\b/.test(courseName))) {
            courseName = '';
          }

          // 2. Props deep search for GUID match
          if (!assignmentId || !UUID_REGEX.test(String(assignmentId))) {
            assignmentId = findGuidInProps(p);
          }

          if (assignmentId && UUID_REGEX.test(String(assignmentId))) {
            return {
              assignmentId: String(assignmentId),
              classId: classId ? String(classId) : '',
              title: title || cardElement.querySelector('h3, [data-test*="title"]')?.innerText?.trim() || '',
              courseName: courseName || '',
              dueDateTime: dueDateTime || null,
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
      // Matches /classes/<classId>/assignments/<assignmentId>
      const match = href.match(/\/classes\/([a-f0-9-]+)\/assignments\/([a-f0-9-]+)/i);
      if (match) {
        return {
          classId: match[1],
          assignmentId: match[2],
        };
      }
      // Matches /assignments/<assignmentId>
      const assignMatch = href.match(/\/assignments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (assignMatch) {
        return {
          classId: '',
          assignmentId: assignMatch[1],
        };
      }
      // Matches query params
      const queryMatch = href.match(/[?&#](?:subEntityId=assignment_|assignmentId=)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (queryMatch) {
        return {
          classId: '',
          assignmentId: queryMatch[1],
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

      let assignmentId = fiberData?.assignmentId || anchorData?.assignmentId || null;
      let classId = fiberData?.classId || anchorData?.classId || null;
      const fullTitle = fiberData?.title || cardEl.querySelector('h3, [data-test*="title"], [data-tid*="title"]')?.innerText?.trim() || '';

      // Locate class label explicitly, avoiding "Due" or time strings
      let fullClassName = fiberData?.courseName;
      if (!fullClassName || /\bdue\b/i.test(fullClassName) || /\b\d{1,2}:\d{2}\b/.test(fullClassName)) {
        const classCandidates = cardEl.querySelectorAll(
          '[data-test*="class"], [data-test*="course"], [data-tid*="class"], [data-tid*="course"], [data-tid*="breadcrumb"] span, [aria-label*="class" i], [aria-label*="course" i], [data-tid*="subtitle"], [class*="subtitle" i], [data-tid*="secondary"], [class*="secondary" i]'
        );
        for (const el of classCandidates) {
          const txt = el?.innerText?.trim();
          if (txt && !/\bdue\b/i.test(txt) && !/\b\d{1,2}:\d{2}\b/.test(txt) && !/\b\d+\s*points?\b/i.test(txt)) {
            fullClassName = txt;
            break;
          }
        }
      }
      if (fullClassName && !/^due\b/i.test(fullClassName)) {
        // verified class name
      } else {
        fullClassName = '';
      }
      const dueDate = fiberData?.dueDateTime;

      // DOM attribute checking
      if (!assignmentId) {
        const candidateEls = [
          cardEl,
          ...Array.from(cardEl.querySelectorAll('[id], [data-item-id], [data-test-id], [data-tid], [data-assignment-id]'))
        ];
        for (const el of candidateEls) {
          const rawId =
            el.getAttribute?.('data-hark-assignment-id') ||
            el.getAttribute?.('data-assignment-id') ||
            el.getAttribute?.('data-item-id') ||
            el.getAttribute?.('data-test-id') ||
            el.getAttribute?.('data-tid') ||
            el.id ||
            '';
          const m = rawId.match(UUID_EXTRACT_REGEX);
          if (m) {
            assignmentId = m[0];
            break;
          }
        }
      }

      if (!classId) {
        classId = cardEl.getAttribute('data-class-id') || cardEl.dataset?.classId || '';
      }

      // Deterministic Fallback: Generate synthetic UUID if no GUID in DOM/Fiber
      if (!assignmentId && fullTitle) {
        assignmentId = generateDeterministicUuid(`${fullClassName || 'General'}_${fullTitle}`);
      }

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
      } else if (assignmentId) {
        const directPortalUrl = `https://assignments.edu.cloud.microsoft/assignments/${assignmentId}`;
        cardEl.setAttribute('data-hark-fiber-deeplink', directPortalUrl);
        cardEl.setAttribute('data-hark-portal-url', directPortalUrl);
        cardEl.setAttribute('data-hark-assignment-id', String(assignmentId));
      }

      if (fullTitle) {
        cardEl.setAttribute('data-hark-title', String(fullTitle).trim());
      }
      if (fullClassName && !/\bdue\b/i.test(fullClassName) && !/\b\d{1,2}:\d{2}\b/.test(fullClassName)) {
        cardEl.setAttribute('data-hark-class-name', String(fullClassName).trim());
      }
      if (dueDate) {
        cardEl.setAttribute('data-hark-due-date', String(dueDate).trim());
      }
      if (assignmentId && fullTitle) {
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
