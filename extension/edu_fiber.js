/**
 * Hark for MS Teams - EDU Assignments Hub React Fiber Extractor (edu_fiber.js)
 * Injected into assignments.edu.cloud.microsoft to read React Fiber memoizedProps
 * in the page execution context and stamp deep links directly onto DOM nodes.
 */

(function () {
  const LOG_STYLE = 'color: #10b981; font-weight: bold; background: #064e3b; padding: 2px 4px; border-radius: 2px;';

  function extractPropsFromCard(cardEl) {
    try {
      if (cardEl.getAttribute('data-hark-fiber-deeplink')) return;

      const fiberKey = Object.keys(cardEl).find(
        (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
      );
      if (!fiberKey) return;

      let cur = cardEl[fiberKey];
      while (cur) {
        const p = cur.memoizedProps;
        if (p) {
          const candidate = p.assignment || p.item || p.cardData || p;
          if (candidate && (candidate.classId || candidate.courseId)) {
            const classId = candidate.classId || candidate.courseId || candidate.classDetails?.id;
            const assignmentId = candidate.id || cardEl.id;
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
              console.log(
                '%c[Hark Fiber]%c Stamped assignment direct portal & teams links:',
                LOG_STYLE,
                'color: #10b981;',
                assignmentId,
                directPortalUrl
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
