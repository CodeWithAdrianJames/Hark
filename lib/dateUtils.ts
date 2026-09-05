/**
 * Date & Calendar utility functions for Hark Student Dashboard
 * Provides timezone-aware local date formatting and Google Calendar integration.
 */

export type UrgencyTier = 'overdue' | 'today' | 'tomorrow' | 'within_7_days' | 'later';

export interface FormattedDueStatus {
  formattedDate: string;
  countdownText: string;
  urgency: UrgencyTier;
}

/**
 * Calculates the start of today (00:00:00) in the specified timezone (defaults to 'Asia/Manila' / UTC+8).
 */
export function getStartOfToday(timezone: string = 'Asia/Manila'): Date {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now); // 'YYYY-MM-DD'

  let offsetStr = '+08:00';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    }).formatToParts(now);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    const match = tzPart?.value?.match(/GMT([+-]\d{2}:?\d{2})/);
    if (match) offsetStr = match[1];
  } catch {
    // fallback +08:00
  }
  return new Date(`${dateStr}T00:00:00${offsetStr}`);
}

/**
 * Formats a deadline into standard localized presentation (e.g., "Sep 6, 2026 • 11:59 PM")
 */
export function formatLocalDeadline(dueDateString: string): string {
  const due = new Date(dueDateString);
  if (isNaN(due.getTime())) return 'Date not specified';

  const datePart = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(due);

  const timePart = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(due);

  return `${datePart} • ${timePart}`;
}

/**
 * Returns consistent Tailwind badge styles for each urgency tier
 */
export function getUrgencyBadgeClasses(urgency: UrgencyTier, isCompleted = false): {
  badge: string;
  dot: string;
  label: string;
} {
  if (isCompleted) {
    return {
      badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      dot: 'bg-emerald-400',
      label: 'Completed',
    };
  }
  switch (urgency) {
    case 'overdue':
      return {
        badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse',
        dot: 'bg-rose-500',
        label: 'Overdue',
      };
    case 'today':
      return {
        badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
        dot: 'bg-rose-400',
        label: 'Due Today',
      };
    case 'tomorrow':
      return {
        badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        dot: 'bg-amber-400',
        label: 'Due Tomorrow',
      };
    case 'within_7_days':
      return {
        badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
        dot: 'bg-blue-400',
        label: 'Due this week',
      };
    case 'later':
    default:
      return {
        badge: 'bg-slate-800 text-slate-400 border-slate-700/60',
        dot: 'bg-slate-400',
        label: '8+ Days',
      };
  }
}

/**
 * Parses a due date timestamp and generates a localized countdown status with 4 distinct urgency tiers:
 * - Red: Due today
 * - Yellow: Due tomorrow
 * - Blue: Due within 7 days
 * - Slate: Due in 8+ days
 */
export function parseDueDate(dueDateString: string, timezone = 'Asia/Manila'): FormattedDueStatus {
  const due = new Date(dueDateString);
  const now = new Date();

  if (isNaN(due.getTime())) {
    return {
      formattedDate: 'Date not specified',
      countdownText: 'No deadline',
      urgency: 'later',
    };
  }

  const formattedDate = formatLocalDeadline(dueDateString);

  const timePart = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(due);

  const startOfToday = getStartOfToday(timezone);
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const startOfDayAfterTomorrow = new Date(startOfToday.getTime() + 48 * 60 * 60 * 1000);
  const eightDaysFromToday = new Date(startOfToday.getTime() + 8 * 24 * 60 * 60 * 1000);

  const diffMs = due.getTime() - now.getTime();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.ceil((due.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));

  // 1. Strictly Overdue (due before 00:00:00 of today)
  if (due.getTime() < startOfToday.getTime()) {
    const absDays = Math.abs(diffDays);
    const countdownText = absDays > 0 ? `Overdue by ${absDays}d` : 'Overdue';
    return {
      formattedDate,
      countdownText,
      urgency: 'overdue',
    };
  }

  // 2. Due Today (startOfToday <= due < startOfTomorrow) -> RED
  if (due.getTime() < startOfTomorrow.getTime()) {
    let countdownText = `Due today at ${timePart}`;
    if (diffMs > 0 && diffHours <= 1) {
      countdownText = 'Due in < 1 hr';
    } else if (diffMs > 0 && diffHours < 12) {
      countdownText = `Due in ${diffHours}h (${timePart})`;
    } else if (diffMs < 0) {
      countdownText = `Due today (${timePart})`;
    }
    return {
      formattedDate,
      countdownText,
      urgency: 'today',
    };
  }

  // 3. Due Tomorrow (startOfTomorrow <= due < startOfDayAfterTomorrow) -> YELLOW
  if (due.getTime() < startOfDayAfterTomorrow.getTime()) {
    return {
      formattedDate,
      countdownText: `Due tomorrow at ${timePart}`,
      urgency: 'tomorrow',
    };
  }

  // 4. Due within 7 days (startOfDayAfterTomorrow <= due < eightDaysFromToday) -> BLUE
  if (due.getTime() < eightDaysFromToday.getTime()) {
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(due);
    return {
      formattedDate,
      countdownText: `Due ${weekday} • ${timePart}`,
      urgency: 'within_7_days',
    };
  }

  // 5. Due in 8+ days -> SLATE / NEUTRAL
  return {
    formattedDate,
    countdownText: `Due in ${diffDays} days`,
    urgency: 'later',
  };
}

/**
 * Formats and validates a Teams deep link URL so it reliably launches in the browser.
 * Ensures an absolute https:// URL and removes any dangerous or broken schemes.
 * If the link points to generic /classes/all/list, generates an official MS Teams web
 * entity deep link with search/title hint.
 */
export function formatTeamsDeepLink(
  url: string | null | undefined,
  hint?: { title?: string; course_code?: string }
): string | null {
  if (!url || typeof url !== 'string') {
    if (hint?.title) {
      return `https://teams.microsoft.com/l/entity/2a84b049-50bc-4535-a646-5677a8207868/assignments?context=${encodeURIComponent(
        JSON.stringify({ title: hint.title, course: hint.course_code || '' })
      )}`;
    }
    return null;
  }

  let formatted = url.trim();
  if (!formatted || formatted === '#' || formatted.startsWith('javascript:')) {
    if (hint?.title) {
      return `https://teams.microsoft.com/l/entity/2a84b049-50bc-4535-a646-5677a8207868/assignments?context=${encodeURIComponent(
        JSON.stringify({ title: hint.title, course: hint.course_code || '' })
      )}`;
    }
    return null;
  }

  if (formatted.startsWith('//')) {
    formatted = 'https:' + formatted;
  } else if (formatted.startsWith('/')) {
    if (formatted.startsWith('/classes/') || formatted.startsWith('/assignments/')) {
      formatted = 'https://assignments.edu.cloud.microsoft' + formatted;
    } else {
      formatted = 'https://teams.microsoft.com' + formatted;
    }
  } else if (!/^https?:\/\//i.test(formatted)) {
    formatted = 'https://' + formatted;
  }

  // If it's a specific assignment route, return it directly
  if (/\/assignments\/[a-zA-Z0-9_\-]+/i.test(formatted)) {
    return formatted;
  }

  // If the link points to the generic /classes/all/list, fallback to MS Teams assignments entity with title/course hint
  if (
    formatted.endsWith('/classes/all/list') ||
    formatted.endsWith('/classes/all/list/') ||
    /^https?:\/\/[^/]+\/classes\/all\/list(?:\?|$)/i.test(formatted)
  ) {
    if (hint?.title) {
      return `https://teams.microsoft.com/l/entity/2a84b049-50bc-4535-a646-5677a8207868/assignments?context=${encodeURIComponent(
        JSON.stringify({ title: hint.title, course: hint.course_code || '' })
      )}`;
    }
    return 'https://teams.microsoft.com/_#/assignments';
  }

  return formatted;
}

/**
 * Generates Google Calendar web intent link with UTC parameters
 * matching the user's exact local moment.
 */
export function buildGoogleCalendarUrl(task: {
  title: string;
  description?: string | null;
  due_date: string;
  source_url?: string | null;
  course_code?: string | null;
}): string {
  const due = new Date(task.due_date);
  // Default to a 1-hour focus block before the deadline
  const start = new Date(due.getTime() - 60 * 60 * 1000);

  // ISO compact UTC formatting: YYYYMMDDTHHmmssZ
  const formatUtc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const datesParam = `${formatUtc(start)}/${formatUtc(due)}`;
  const titleParam = task.course_code
    ? `[${task.course_code}] ${task.title}`
    : task.title;

  const validTeamsLink = formatTeamsDeepLink(task.source_url);

  const detailsArray = [];
  if (task.description) detailsArray.push(task.description);
  if (validTeamsLink) detailsArray.push(`Teams Link: ${validTeamsLink}`);
  detailsArray.push('Organized via Hark Academic Assistant');

  const detailsParam = detailsArray.join('\n\n');

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
    titleParam
  )}&dates=${datesParam}&details=${encodeURIComponent(detailsParam)}`;
}

/**
 * Exports tasks to an .ics iCalendar file and triggers browser download
 */
export function exportToICS(
  tasks: Array<{
    id: string;
    title: string;
    description?: string | null;
    due_date: string;
    source_url?: string | null;
    course_code?: string | null;
  }>
) {
  const formatIcsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const now = new Date();
  const dtStamp = formatIcsDate(now);

  const events = tasks.map((task) => {
    const due = new Date(task.due_date);
    const start = new Date(due.getTime() - 60 * 60 * 1000);

    const summary = (task.course_code ? `[${task.course_code}] ` : '') + task.title;
    const description = [
      task.description || '',
      task.source_url ? `Link: ${task.source_url}` : '',
      'Tracked via Hark',
    ]
      .filter(Boolean)
      .join('\\n');

    return [
      'BEGIN:VEVENT',
      `UID:${task.id}@hark.app`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${formatIcsDate(start)}`,
      `DTEND:${formatIcsDate(due)}`,
      `SUMMARY:${summary.replace(/,/g, '\\,')}`,
      `DESCRIPTION:${description.replace(/,/g, '\\,')}`,
      task.source_url ? `URL:${task.source_url}` : '',
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT2H',
      'ACTION:DISPLAY',
      `DESCRIPTION:Reminder: ${summary}`,
      'END:VALARM',
      'END:VEVENT',
    ]
      .filter(Boolean)
      .join('\r\n');
  });

  const icsBody = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hark//Academic Task Dashboard//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Hark Academic Tasks',
    'X-WR-TIMEZONE:UTC',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([icsBody], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hark-tasks-${new Date().toISOString().slice(0, 10)}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
