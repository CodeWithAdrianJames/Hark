/**
 * Hark for MS Teams - EDU Assignments Hub React Fiber Extractor (edu_fiber.js)
 * Injected into assignments.edu.cloud.microsoft to read React Fiber memoizedProps
 * in the page execution context and stamp deep links directly onto DOM nodes.
 */

(function () {
  const LOG_STYLE = 'color: #10b981; font-weight: bold; background: #064e3b; padding: 2px 4px; border-radius: 2px;';

  function extractPropsFromCard(cardEl) {
    try {
      if (cardEl.getAttribute('data-hark-fiber-deeplink') && cardEl.getAttribute('data-hark-title')) return;

      const fiberKey = Object.keys(cardEl).find(
        (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
      );
      if (!fiberKey) return;

      let cur = cardEl[fiberKey];
      while (cur) {
        const p = cur.memoizedProps;
        if (p) {
          const candidate = p.assignment || p.item || p.cardData || p;
          if (candidate && (candidate.classId || candidate.courseId || candidate.id || candidate.displayName || candidate.title)) {
            const classId = candidate.classId || candidate.courseId || candidate.classDetails?.id;
            const assignmentId = candidate.id || cardEl.id || candidate.assignmentId;
            const fullTitle = candidate.displayName || candidate.title || candidate.name || candidate.assignmentTitle;
            const fullClassName = candidate.className || candidate.classDetails?.displayName || candidate.courseName;
            const dueDate = candidate.dueDateTime || candidate.dueDate;

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
            if (fullClassName) {
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
              break;
            }
          }
        }
        cur = cur.return;
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

  // Observe DOM for newly rendered or virtualized assignment cards
  const observer = new MutationObserver(() => {
    syncAllCards();
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
