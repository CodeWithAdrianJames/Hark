/**
 * Date & Calendar utility functions for Hark Student Dashboard
 * Provides timezone-aware local date formatting and Google Calendar integration.
 */

export interface FormattedDueStatus {
  formattedDate: string;
  countdownText: string;
  urgency: 'overdue' | 'today' | 'this_week' | 'later';
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
 * Parses a due date timestamp and generates a localized countdown status
 */
export function parseDueDate(dueDateString: string): FormattedDueStatus {
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

  const diffMs = due.getTime() - now.getTime();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  // Overdue
  if (diffMs < 0) {
    const absHours = Math.abs(diffHours);
    const absDays = Math.abs(diffDays);
    const countdownText = absDays > 0 ? `Overdue by ${absDays}d` : `Overdue by ${absHours}h`;
    return {
      formattedDate,
      countdownText,
      urgency: 'overdue',
    };
  }

  // Due Today
  const isToday =
    due.getDate() === now.getDate() &&
    due.getMonth() === now.getMonth() &&
    due.getFullYear() === now.getFullYear();

  if (isToday) {
    const countdownText =
      diffHours <= 1
        ? 'Due in < 1 hour'
        : `Due in ${diffHours} hours (${timePart})`;
    return {
      formattedDate,
      countdownText,
      urgency: 'today',
    };
  }

  // Due Tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    due.getDate() === tomorrow.getDate() &&
    due.getMonth() === tomorrow.getMonth() &&
    due.getFullYear() === tomorrow.getFullYear();

  if (isTomorrow) {
    return {
      formattedDate,
      countdownText: `Due tomorrow at ${timePart}`,
      urgency: 'this_week',
    };
  }

  // Within next 7 days (This Week)
  if (diffDays <= 7) {
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(due);
    return {
      formattedDate,
      countdownText: `Due ${weekday} at ${timePart}`,
      urgency: 'this_week',
    };
  }

  // Later
  return {
    formattedDate,
    countdownText: `Due in ${diffDays} days`,
    urgency: 'later',
  };
}

/**
 * Formats and validates a Teams deep link URL so it reliably launches in the browser.
 * Ensures an absolute https:// URL and removes any dangerous or broken schemes.
 */
export function formatTeamsDeepLink(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed === '#' || trimmed.startsWith('javascript:')) return null;

  let formatted = trimmed;
  if (formatted.startsWith('//')) {
    formatted = 'https:' + formatted;
  } else if (formatted.startsWith('/')) {
    formatted = 'https://teams.microsoft.com' + formatted;
  } else if (!/^https?:\/\//i.test(formatted)) {
    formatted = 'https://' + formatted;
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
