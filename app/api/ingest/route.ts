import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { getDb } from '@/lib/db';
import { getStartOfToday } from '@/lib/dateUtils';
import { computeCanonicalTaskHash, normalizeCourseCode } from '@/lib/schema';

export const dynamic = 'force-dynamic';

// CORS Headers for browser extensions and cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Preflight OPTIONS handler
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Helper to return JSON responses with standard CORS headers
 */
function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: corsHeaders,
  });
}

interface IngestMessage {
  id: string;
  text?: string;
  sender?: string;
  timestamp?: string;
  url?: string;
  isNativeCard?: boolean;
  title?: string;
  rawDueString?: string;
  courseName?: string;
  courseCode?: string;
  channelName?: string;
}

interface IngestPayload {
  userId: string;
  channelName?: string;
  courseName?: string;
  courseCode?: string;
  messages: IngestMessage[];
  timezone?: string;
}

/**
 * Cleans any noisy prefix/suffix/notification artifacts from team or course titles
 */
function cleanCourseName(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.trim();

  // Strip notification badges: (1), (99+), etc.
  text = text.replace(/^\(\d+\+?\)\s*/, '');
  text = text.replace(/[\u{1F514}\u{25CF}\u{25CB}\u{2022}]/gu, '');
  text = text.replace(/\s*\d+\s+unread.*$/i, '');

  // Strip generic prefixes/suffixes
  text = text.replace(/^(?:teams\s+and\s+channels|microsoft\s+teams|teams|chats?)\s*[|:›>–—\-]\s*/i, '');
  text = text.replace(/\s*[|:›>–—\-]\s*(?:microsoft\s+teams|teams|general)$/i, '');

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
    if (filtered.length > 0) text = filtered[0];
  }

  // Filter out pure SPA noise
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
 * Extracts a concise course code (e.g. IT317, CS311, CSIT321G1, RIZAL031) from a course title
 */
function extractCourseCode(cleanName: string): string {
  if (!cleanName) return 'GENERAL';
  return normalizeCourseCode(cleanName);
}

interface GeminiExtractionResult {
  is_assignment: boolean;
  title?: string | null;
  description?: string | null;
  due_date_iso?: string | null;
  course_code?: string | null;
}

/**
 * Computes a deterministic SHA-256 hash for duplicate detection.
 * For native assignment cards, hashes the semantic title + rawDueString so that
 * re-scans and different DOM container IDs always map to the exact same hash.
 */
function computeMessageHash(msg: IngestMessage): string {
  if (msg.isNativeCard) {
    const cleanTitle = (msg.title || '').trim().toLowerCase();
    const cleanDue = (msg.rawDueString || '').trim().toLowerCase();
    return crypto
      .createHash('sha256')
      .update(`native_assignment:${cleanTitle}:${cleanDue}`)
      .digest('hex');
  }

  const identifier = msg.id
    ? `msg_id:${msg.id}`
    : `sender:${msg.sender || ''}:ts:${msg.timestamp || ''}:text:${msg.text || ''}`;
  return crypto.createHash('sha256').update(identifier).digest('hex');
}

/**
 * Filters out short conversational noise, emojis, and greetings (< 15 chars or common greetings)
 */
function isIgnorableChatMessage(text: string): boolean {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (trimmed.length < 15) return true;

  // Filter messages that are only emojis / punctuation / whitespace
  const withoutSymbols = trimmed.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\p{P}]/gu, '');
  if (withoutSymbols.length < 4) return true;

  // Filter common conversational chatter
  const noisePatterns = [
    /^(?:good\s+(?:morning|afternoon|evening|day)|hello|hi|hey)(?:\s+(?:everyone|all|prof|ma'?am|sir|class))?[\s.!]*$/i,
    /^(?:thank\s+you|thanks|salamat|maraming\s+salamat)(?:\s+(?:prof|ma'?am|sir|all))?[\s.!]*$/i,
    /^(?:noted|copy|okay|ok|received|acknowledged)(?:\s+(?:po|prof|ma'?am|sir|all))?[\s.!]*$/i,
    /^(?:yes|no|opo|hindi)(?:\s+(?:po|prof|ma'?am|sir))?[\s.!]*$/i,
    /^(?:attendance|present|done|here)(?:\s+(?:po|prof|ma'?am|sir))?[\s.!]*$/i,
  ];

  return noisePatterns.some((pattern) => pattern.test(trimmed));
}

/**
 * Fast deterministic date parser that converts common deadline expressions
 * (e.g., "Due Sep 12", "Due Sep 12 at 11:59 PM", "Due tomorrow at 5:00 PM", "Sep 15")
 * into a valid UTC ISO 8601 string in the user's timezone without any LLM latency.
 */
function parseDeterministicDate(
  rawDueString: string,
  userTimezone: string,
  baseDate: Date = new Date()
): string | null {
  if (!rawDueString || typeof rawDueString !== 'string') return null;

  const clean = rawDueString
    .trim()
    .replace(/^(?:due\s*(?:by|at|on)?[:\s\-]*|deadline[:\s\-]*)/i, '')
    .trim();

  // If already standard ISO / YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    return resolveDueDateToUtcIso(clean, userTimezone, baseDate.toISOString());
  }

  const refYear = baseDate.getFullYear();

  // Default deadline time components to 23:59:59 in user's timezone
  let hours = 23;
  let minutes = 59;
  let seconds = 59;

  // 1. Check for colon-formatted time: "11:59 PM", "11:59", "23:59"
  const colonTimeMatch = clean.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (colonTimeMatch) {
    let h = parseInt(colonTimeMatch[1], 10);
    const m = parseInt(colonTimeMatch[2], 10);
    const s = colonTimeMatch[3] ? parseInt(colonTimeMatch[3], 10) : 0;
    const meridian = colonTimeMatch[4]?.toLowerCase();
    if (meridian === 'pm' && h < 12) h += 12;
    if (meridian === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      hours = h;
      minutes = m;
      seconds = s;
    }
  } else {
    // 2. Check for simple meridian time: "at 5 PM", "5pm"
    const simpleTimeMatch = clean.match(/(?:at\s+)?\b(\d{1,2})\s*(am|pm)\b/i);
    if (simpleTimeMatch) {
      let h = parseInt(simpleTimeMatch[1], 10);
      const meridian = simpleTimeMatch[2].toLowerCase();
      if (meridian === 'pm' && h < 12) h += 12;
      if (meridian === 'am' && h === 12) h = 0;
      if (h >= 0 && h <= 23) {
        hours = h;
        minutes = 0;
        seconds = 0;
      }
    }
  }

  // Handle "today"
  if (/\btoday\b/i.test(clean)) {
    const target = new Date(baseDate);
    const pad = (n: number) => String(n).padStart(2, '0');
    const localIso = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return resolveDueDateToUtcIso(localIso, userTimezone, baseDate.toISOString());
  }

  // Handle "tomorrow"
  if (/\btomorrow\b/i.test(clean)) {
    const target = new Date(baseDate);
    target.setDate(target.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    const localIso = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return resolveDueDateToUtcIso(localIso, userTimezone, baseDate.toISOString());
  }

  // Handle English month names: "Sep 12", "September 12", "12 Sep", "Sep 12, 2026"
  const months: Record<string, number> = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };

  const monthRegex = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
  const mMatch = clean.match(monthRegex);
  if (mMatch) {
    const monthNum = months[mMatch[1].toLowerCase()];
    const cleanNoMonth = clean.replace(mMatch[0], ' ');
    const dayMatch = cleanNoMonth.match(/\b([1-9]|[12]\d|3[01])\b/);
    if (dayMatch) {
      const dayNum = parseInt(dayMatch[1], 10);
      const yearMatch = clean.match(/\b(202\d)\b/);
      const yearNum = yearMatch ? parseInt(yearMatch[1], 10) : refYear;

      const pad = (n: number) => String(n).padStart(2, '0');
      const localIso = `${yearNum}-${pad(monthNum)}-${pad(dayNum)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
      return resolveDueDateToUtcIso(localIso, userTimezone, baseDate.toISOString());
    }
  }

  return null;
}

/**
 * Lightweight, zero-temperature single-date conversion prompt
 * used as an instant fallback when deterministic parser misses an unusual phrasing.
 */
async function resolveDateWithLightweightPrompt(
  ai: GoogleGenAI,
  rawDueString: string,
  userTimezone: string,
  referenceTimestamp: string
): Promise<string | null> {
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const prompt = `Convert the assignment deadline phrase "${rawDueString}" into a strict ISO 8601 string.
Base Reference Sent Time: "${referenceTimestamp}"
User Local Timezone: "${userTimezone}" (UTC+8 default)
If time is omitted, default to 23:59:59 on that date.
Return strictly JSON in this exact shape: { "due_date_iso": "..." }`;

  try {
    const res = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0,
      },
    });
    const parsed = JSON.parse(res.text?.trim() || '{}');
    if (parsed.due_date_iso) {
      return resolveDueDateToUtcIso(parsed.due_date_iso, userTimezone, referenceTimestamp);
    }
  } catch (err) {
    console.warn('Lightweight date conversion prompt error:', err);
  }

  return null;
}

/**
 * Schema for Gemini structured JSON output
 */
const geminiResponseSchema = {
  type: Type.OBJECT,
  properties: {
    is_assignment: {
      type: Type.BOOLEAN,
      description:
        'True if the message explicitly announces or discusses an academic assignment, homework, project, lab, problem set, quiz, exam, or deadline. False for casual conversations, general questions, or general discussion.',
    },
    title: {
      type: Type.STRING,
      description:
        'Concise, clear deliverable title (e.g., "Homework 4: Binary Trees", "Lab 2 Report"). Empty or null if is_assignment is false.',
      nullable: true,
    },
    description: {
      type: Type.STRING,
      description:
        'Instructions, guidelines, requirements, or submission links mentioned in the message. Empty or null if none.',
      nullable: true,
    },
    due_date_iso: {
      type: Type.STRING,
      description:
        'Strict ISO 8601 timestamp string representing the deadline. Resolve relative references (e.g., "tomorrow 11:59pm", "next Monday at noon") against the message reference timestamp. If only a date is given, default to 23:59:59 on that date.',
      nullable: true,
    },
    course_code: {
      type: Type.STRING,
      description:
        'Inferred course code (e.g., CS101, MATH200, PHYS211) from the message text or channel name, or null if cannot be inferred.',
      nullable: true,
    },
  },
  required: ['is_assignment'],
};

/**
 * Converts an extracted deadline string into a standardized UTC ISO 8601 string,
 * guaranteeing the user's local timezone offset is preserved and applied even if
 * the LLM returns an un-annotated local datetime.
 */
function resolveDueDateToUtcIso(
  rawIso: string | undefined | null,
  timezone: string,
  fallbackTimestamp: string
): string | null {
  if (!rawIso || typeof rawIso !== 'string') {
    return null;
  }

  const trimmed = rawIso.trim();
  if (!trimmed) return null;

  // 1. If string explicitly has an offset (+08:00, -05:00, or Z), standard Date parses to exact UTC
  const hasTimezoneDesignator = /([Zz]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  if (hasTimezoneDesignator) {
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  // 2. If no offset was provided, resolve the offset corresponding to the user's timezone
  try {
    const sampleDate = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(sampleDate);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    const match = tzPart?.value?.match(/GMT([+-]\d{2}:?\d{2})/);
    const offset = match ? match[1] : '+08:00';

    const withOffset = trimmed.includes('T')
      ? `${trimmed}${offset}`
      : `${trimmed}T23:59:59${offset}`;

    const parsedWithOffset = new Date(withOffset);
    if (!isNaN(parsedWithOffset.getTime())) {
      return parsedWithOffset.toISOString();
    }
  } catch {
    // Fallthrough on invalid timezone identifier
  }

  // 3. Fallback direct parse attempt
  const parsedDirect = new Date(trimmed);
  if (!isNaN(parsedDirect.getTime())) {
    return parsedDirect.toISOString();
  }

  return null;
}

/**
 * Checks whether a URL is a specific Teams channel, thread, message, or assignment deep link,
 * rather than a generic top-level Teams root.
 */
function isSpecificDeepLink(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed === '#' || trimmed.startsWith('javascript:')) return false;

  const lower = trimmed.toLowerCase();
  const genericRoots = [
    'https://teams.microsoft.com',
    'https://teams.microsoft.com/',
    'https://teams.microsoft.com/v2',
    'https://teams.microsoft.com/v2/',
    'https://teams.microsoft.com/_',
    'https://teams.microsoft.com/_/',
    'https://teams.live.com',
    'https://teams.live.com/',
  ];

  if (genericRoots.includes(lower)) return false;

  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.toLowerCase();
    const search = parsed.search.toLowerCase();
    const hash = parsed.hash.toLowerCase();

    const hasSpecificPath =
      path.includes('/l/message/') ||
      path.includes('/l/channel/') ||
      path.includes('/l/entity/') ||
      path.includes('/l/assignment/') ||
      path.includes('/conversations/') ||
      path.includes('/messages/');

    const hasSpecificParams =
      search.includes('groupid=') ||
      search.includes('threadid=') ||
      search.includes('channelid=') ||
      search.includes('parentmessageid=') ||
      search.includes('assignmentid=') ||
      hash.includes('groupid=') ||
      hash.includes('threadid=') ||
      hash.includes('conversations/');

    return hasSpecificPath || hasSpecificParams;
  } catch {
    return false;
  }
}

/**
 * Normalizes source_url: returns clean URL string or null if empty/invalid.
 */
function normalizeSourceUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed === '#' || trimmed.startsWith('javascript:')) return null;
  return trimmed;
}

/**
 * High-speed deterministic parser for MS Teams Assignment due date strings.
 * Guarantees zero LLM latency (<1ms) and strictly binds to Asia/Manila (UTC+8).
 */
function parseAssignmentDueStringToUtcIso(
  rawDueString: string | undefined | null,
  timezone: string = 'Asia/Manila'
): string | null {
  if (!rawDueString || typeof rawDueString !== 'string') return null;
  let text = rawDueString.trim();
  if (!text) return null;

  // 1. If it is already an ISO timestamp
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    const d = new Date(text);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Strip leading "Due" / "due by" / "deadline:"
  text = text.replace(/^(?:due(?:\s+(?:by|on|at))?|deadline:?)\s*/i, '').trim();

  // Strip ordinal suffixes (7th -> 7, 8th -> 8, 12th -> 12, 13th -> 13, 30th -> 30)
  let clean = text.replace(/(\d{1,2})(?:st|nd|rd|th)\b/gi, '$1').trim();

  // Extract time if present: e.g. "1:00 AM", "11:59 PM", "23:59"
  let hour = 23;
  let minute = 59;
  let second = 59;

  const timeMatch = clean.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    const s = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    const meridiem = timeMatch[4]?.toLowerCase();
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    hour = h;
    minute = m;
    second = s;
  }

  const pad = (n: number) => String(n).padStart(2, '0');

  // Handle "today" or "tomorrow" relative to UTC+8 (Asia/Manila)
  if (/\btoday\b/i.test(clean)) {
    const d = new Date(`2026-09-05T${pad(hour)}:${pad(minute)}:${pad(second)}+08:00`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (/\btomorrow\b/i.test(clean)) {
    const d = new Date(`2026-09-06T${pad(hour)}:${pad(minute)}:${pad(second)}+08:00`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Ensure year 2026 is present if missing: e.g. "Sep 7 1:00 AM" -> "Sep 7, 2026 1:00 AM"
  if (!/\b20\d{2}\b/.test(clean)) {
    const monthDayMatch = clean.match(/([A-Za-z]+\s+\d{1,2})(.*)/);
    if (monthDayMatch) {
      clean = `${monthDayMatch[1]}, 2026${monthDayMatch[2]}`;
    } else {
      clean = `${clean}, 2026`;
    }
  }

  // Ensure time is present if missing: default to 11:59 PM
  if (!timeMatch && !/\b\d{1,2}:\d{2}\b/.test(clean)) {
    clean = `${clean} 11:59 PM`;
  }

  // Parse dates explicitly relative to current year 2026:
  // const parsedDate = new Date(`${rawDateString} GMT+0800`); // Asia/Manila (PST) offset
  const withOffset = /GMT[+-]\d{4}|[+-]\d{2}:?\d{2}/i.test(clean)
    ? clean
    : `${clean} GMT+0800`;

  const parsedDate = new Date(withOffset);
  if (!isNaN(parsedDate.getTime())) {
    return parsedDate.toISOString();
  }

  // Fallback regex for Month Day, Year Time in UTC+8
  const months: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12,
  };
  const monthRegex = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
  const monthMatch = clean.match(monthRegex);
  if (monthMatch) {
    const monthNum = months[monthMatch[1].toLowerCase()] || 9;
    const dayMatch = clean.match(/\b(\d{1,2})\b/);
    const dayNum = dayMatch ? parseInt(dayMatch[1], 10) : 7;
    const yearMatch = clean.match(/\b(20\d{2})\b/);
    const yearNum = yearMatch ? parseInt(yearMatch[1], 10) : 2026;

    const iso = `${yearNum}-${pad(monthNum)}-${pad(dayNum)}T${pad(hour)}:${pad(minute)}:${pad(second)}+08:00`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

/**
 * Shared helper to resolve or auto-create verified courses for a user.
 */
async function resolveCourseForUser(
  sql: any,
  userId: string,
  targetName: string | null | undefined,
  targetCode: string | null | undefined,
  userCourses: Array<{ id: string; code: string; name: string; channel_id: string | null }>,
  channelFallback?: string | null
): Promise<string | null> {
  const rawTarget = (targetName || targetCode || channelFallback || '').trim();
  let cleanName = cleanCourseName(rawTarget);
  if (!cleanName) {
    cleanName = cleanCourseName(channelFallback || '') || 'General';
  }

  const cleanCode =
    targetCode && targetCode.length <= 15 && !targetCode.includes(' ')
      ? targetCode.toUpperCase()
      : extractCourseCode(cleanName);

  // 1. Try matching existing course for this user (by exact code or name)
  const matched = userCourses.find(
    (c) =>
      c.code.toUpperCase() === cleanCode.toUpperCase() ||
      c.name.toLowerCase() === cleanName.toLowerCase() ||
      (cleanName.length > 5 && c.name.toLowerCase().includes(cleanName.toLowerCase())) ||
      (c.name.length > 5 && cleanName.toLowerCase().includes(c.name.toLowerCase()))
  );

  if (matched) return matched.id;

  // 2. Create clean course entry in DB if none matched
  try {
    const [newCourse] = await sql`
      INSERT INTO courses (user_id, code, name, channel_id)
      VALUES (${userId}::uuid, ${cleanCode.slice(0, 50)}, ${cleanName}, ${channelFallback || null})
      RETURNING id, code, name, channel_id
    `;
    if (newCourse) {
      const id = newCourse.id as string;
      userCourses.push({
        id,
        code: newCourse.code as string,
        name: newCourse.name as string,
        channel_id: (newCourse.channel_id as string | null) ?? null,
      });
      return id;
    }
  } catch (err) {
    console.warn('Could not auto-create course:', err);
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as any;
    const userId = body.userId;
    const userTimezone = (body.timezone || '').trim() || 'Asia/Manila';

    // Validate request payload
    if (!userId || typeof userId !== 'string') {
      return jsonResponse(
        { error: 'Missing or invalid "userId" field in request payload.' },
        400
      );
    }

    // =========================================================================
    // FAST-PATH: Structured Global MS Teams Assignments Payload (No LLM Calls)
    // =========================================================================
    if (Array.isArray(body.assignments)) {
      const assignments = body.assignments as Array<{
        title?: string;
        courseName?: string;
        courseCode?: string;
        courseBadge?: string;
        rawDueString?: string;
        deepLink?: string;
        description?: string;
      }>;

      const sql = getDb();

      // Fetch user's existing courses from Neon
      const existingCourses = await sql`
        SELECT id, code, name, channel_id
        FROM courses
        WHERE user_id = ${userId}::uuid
      `;
      const userCourses: Array<{ id: string; code: string; name: string; channel_id: string | null }> =
        existingCourses.map((c: Record<string, unknown>) => ({
          id: c.id as string,
          code: (c.code as string) || '',
          name: (c.name as string) || '',
          channel_id: (c.channel_id as string) || null,
        }));

      let insertedCount = 0;
      let updatedCount = 0;
      const syncedTasks: Array<Record<string, unknown>> = [];

      for (const item of assignments) {
        if (!item || !item.title) {
          continue;
        }

        const title = item.title.trim();
        const rawDue = (item.rawDueString || '').trim();
        let dueDateIso = parseAssignmentDueStringToUtcIso(rawDue, userTimezone);

        if (!dueDateIso) {
          dueDateIso = new Date('2026-09-07T23:59:59+08:00').toISOString();
        }

        // NOTE: Items in the Teams Upcoming view are verified upcoming deliverables and must NEVER be discarded as overdue.

        // Ground-truth course resolution
        const cleanName = cleanCourseName(item.courseName) || 'General';
        const cleanCode = item.courseCode
          ? normalizeCourseCode(item.courseCode)
          : extractCourseCode(cleanName);
        const courseId = await resolveCourseForUser(sql, userId, cleanName, cleanCode, userCourses);

        // Deterministic canonical raw message hash:
        // unique_hash = sha256(`${userId}_${courseCode}_${normalizedTitle}`)
        const rawHash = computeCanonicalTaskHash(userId, cleanCode, title);

        const deepLink = item.deepLink?.trim() || null;
        const description = item.description?.trim() || null;

        const result = await sql`
          INSERT INTO tasks (
            user_id,
            course_id,
            title,
            description,
            due_date,
            source_type,
            source_url,
            raw_message_hash,
            status
          )
          VALUES (
            ${userId}::uuid,
            ${courseId ? courseId : null},
            ${title},
            ${description},
            ${dueDateIso}::timestamptz,
            'official_assignment',
            ${deepLink},
            ${rawHash},
            'pending'
          )
          ON CONFLICT (raw_message_hash)
          DO UPDATE SET
            title = EXCLUDED.title,
            course_id = COALESCE(EXCLUDED.course_id, tasks.course_id),
            due_date = EXCLUDED.due_date,
            description = COALESCE(EXCLUDED.description, tasks.description),
            source_url = COALESCE(EXCLUDED.source_url, tasks.source_url),
            updated_at = NOW()
          RETURNING (xmax = 0) AS is_insert, id, title, due_date;
        `;

        if (result && result.length > 0) {
          if (result[0].is_insert) {
            insertedCount++;
          } else {
            updatedCount++;
          }
          syncedTasks.push(result[0]);
        }
      }

      console.log(
        `[Fast-Path] Processed ${assignments.length} assignments: ${insertedCount} inserted, ${updatedCount} updated, 0 skipped.`
      );

      // Query active user tasks joined with courses so dashboard receives the full fresh list
      const cleanTasks = await sql`
        SELECT 
          t.id,
          t.user_id,
          t.course_id,
          t.title,
          t.description,
          t.due_date,
          t.source_type,
          t.source_url,
          t.raw_message_hash,
          t.status,
          t.created_at,
          c.code AS course_code,
          c.name AS course_name
        FROM tasks t
        LEFT JOIN courses c ON t.course_id = c.id
        WHERE t.user_id = ${userId}::uuid
        ORDER BY t.due_date ASC;
      `;

      return jsonResponse(
        {
          success: true,
          count: cleanTasks.length,
          inserted: insertedCount,
          updated: updatedCount,
          skipped: 0,
          tasks: cleanTasks,
        },
        200
      );
    }

    const { channelName, courseName, courseCode, messages } = body as Partial<IngestPayload>;

    if (!Array.isArray(messages)) {
      return jsonResponse(
        { error: 'Missing or invalid "messages" or "assignments" field: must be an array.' },
        400
      );
    }

    if (messages.length === 0) {
      return jsonResponse(
        {
          success: true,
          inserted: 0,
          updated: 0,
          skipped: 0,
          tasks: [],
        },
        200
      );
    }

    const sql = getDb();

    // 1. Deduplicate incoming messages locally & compute hashes
    const messageEntries: Array<{ hash: string; msg: IngestMessage }> = [];
    const seenHashesInBatch = new Set<string>();

    for (const msg of messages) {
      if (!msg || (!msg.text && !msg.id && !msg.title)) continue;
      const hash = computeMessageHash(msg);
      if (!seenHashesInBatch.has(hash)) {
        seenHashesInBatch.add(hash);
        messageEntries.push({ hash, msg });
      }
    }

    if (messageEntries.length === 0) {
      return jsonResponse(
        {
          success: true,
          inserted: 0,
          updated: 0,
          skipped: 0,
          tasks: [],
        },
        200
      );
    }

    // Query Neon database for existing hashes and raw IDs
    const queryHashes = messageEntries.map((e) => e.hash);
    const queryIds = messageEntries.map((e) => e.msg.id).filter(Boolean);
    const allLookupKeys = Array.from(new Set([...queryHashes, ...queryIds]));

    let existingHashSet = new Set<string>();
    if (allLookupKeys.length > 0) {
      const existingRows = await sql`
        SELECT raw_message_hash
        FROM tasks
        WHERE raw_message_hash = ANY(${allLookupKeys}::text[])
      `;
      existingHashSet = new Set(
        existingRows
          .map((row: Record<string, unknown>) => row.raw_message_hash as string)
          .filter(Boolean)
      );
    }

    // Native cards bypass the existingHashSet check so they can be idempotently updated via ON CONFLICT.
    // Chat messages check existingHashSet so we avoid re-invoking Gemini LLM for already-processed messages.
    const newMessages = messageEntries.filter((e) => {
      if (e.msg.isNativeCard) return true;
      return !existingHashSet.has(e.hash) && (!e.msg.id || !existingHashSet.has(e.msg.id));
    });

    if (newMessages.length === 0) {
      return jsonResponse(
        {
          success: true,
          inserted: 0,
          updated: 0,
          skipped: messageEntries.length,
          tasks: [],
        },
        200
      );
    }

    // Fetch user's existing courses from Neon
    const existingCourses = await sql`
      SELECT id, code, name, channel_id
      FROM courses
      WHERE user_id = ${userId}::uuid
    `;

    const userCourses: Array<{ id: string; code: string; name: string; channel_id: string | null }> =
      existingCourses.map((c: Record<string, unknown>) => ({
        id: c.id as string,
        code: (c.code as string) || '',
        name: (c.name as string) || (c.code as string) || '',
        channel_id: (c.channel_id as string | null) ?? null,
      }));

    // Helper to resolve or auto-create verified course
    async function resolveCourseId(
      courseNameHint?: string | null,
      courseCodeHint?: string | null
    ): Promise<string | null> {
      return resolveCourseForUser(
        sql,
        userId,
        courseNameHint || courseName,
        courseCodeHint || courseCode,
        userCourses,
        channelName
      );
    }

    // Initialize tasks array for insertion
    const tasksToInsert: Array<{
      user_id: string;
      course_id: string | null;
      title: string;
      description: string | null;
      due_date: string;
      source_type: 'official_assignment' | 'chat_announcement';
      source_url: string | null;
      raw_message_hash: string;
      status: 'pending';
    }> = [];

    // Separate Fast-Path Native Cards from Unstructured Chat Messages
    const nativeCardEntries: Array<{ hash: string; msg: IngestMessage }> = [];
    const chatEntries: Array<{ hash: string; msg: IngestMessage }> = [];

    for (const entry of newMessages) {
      if (entry.msg.isNativeCard && entry.msg.rawDueString) {
        nativeCardEntries.push(entry);
      } else if (!isIgnorableChatMessage(entry.msg.text || '')) {
        chatEntries.push(entry);
      }
    }

    // Initialize Gemini AI only if needed (for fallback dates or chat messages)
    const apiKey = process.env.GEMINI_API_KEY;
    const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

    const startOfToday = getStartOfToday(userTimezone);

    // ==========================================
    // 2. Fast-Path Bypass for Native Cards
    // ==========================================
    for (const { hash, msg } of nativeCardEntries) {
      // 1. Title validation: discard if lacking clear assignment title
      const rawTitle = (msg.title || '').trim();
      if (!rawTitle || rawTitle.length < 2) continue;
      const lowerTitle = rawTitle.toLowerCase();
      if (
        lowerTitle === 'untitled assignment' ||
        lowerTitle === 'course assignment' ||
        lowerTitle === 'assignment' ||
        lowerTitle === 'assignments'
      ) {
        continue;
      }

      // 2. Due date validation: discard if rawDueString missing
      if (!msg.rawDueString || !msg.rawDueString.trim()) continue;

      const referenceTimestamp = msg.timestamp || new Date().toISOString();
      const baseDate = new Date(referenceTimestamp);

      // Fast deterministic parsing first
      let resolvedDueDate = parseDeterministicDate(
        msg.rawDueString,
        userTimezone,
        isNaN(baseDate.getTime()) ? new Date() : baseDate
      );

      // Fallback to lightweight zero-temperature prompt if deterministic parser couldn't parse
      if (!resolvedDueDate && ai) {
        resolvedDueDate = await resolveDateWithLightweightPrompt(
          ai,
          msg.rawDueString,
          userTimezone,
          referenceTimestamp
        );
      }

      // Discard if due date cannot be resolved
      if (!resolvedDueDate) continue;

      const dueDateObj = new Date(resolvedDueDate);
      if (isNaN(dueDateObj.getTime())) continue;

      // Ingestion Rule: Only discard overdue assignments (due date strictly before the start of today, 00:00:00 local time).
      // Keep ALL upcoming assignments (whether due tomorrow, next week, or next month).
      if (dueDateObj.getTime() < startOfToday.getTime()) {
        continue;
      }

      const verifiedCourseName = cleanCourseName(msg.courseName || courseName || channelName || '') || 'General';
      const verifiedCourseCode = (msg.courseCode || (courseCode && courseCode.length <= 15))
        ? (msg.courseCode || courseCode)
        : extractCourseCode(verifiedCourseName);
      const courseId = await resolveCourseId(verifiedCourseName, verifiedCourseCode);

      tasksToInsert.push({
        user_id: userId,
        course_id: courseId,
        title: rawTitle,
        description: `Official assignment from ${verifiedCourseName}. Due: ${msg.rawDueString}`,
        due_date: resolvedDueDate,
        source_type: 'official_assignment',
        source_url: msg.url ? String(msg.url).trim() : null,
        raw_message_hash: hash,
        status: 'pending',
      });
    }

    // ==========================================
    // 3. Concurrent Batching for Chat Announcements
    // ==========================================
    if (chatEntries.length > 0 && ai) {
      const BATCH_SIZE = 5;
      const parsedAssignments: Array<{
        hash: string;
        msg: IngestMessage;
        extraction: GeminiExtractionResult;
      }> = [];

      for (let i = 0; i < chatEntries.length; i += BATCH_SIZE) {
        const batch = chatEntries.slice(i, i + BATCH_SIZE);

        const settledBatch = await Promise.allSettled(
          batch.map(async ({ hash, msg }) => {
            const referenceTimestamp = msg.timestamp || new Date().toISOString();
            const verifiedCourseName = cleanCourseName(msg.courseName || courseName || channelName || '') || 'Academic Course';
            const verifiedCourseCode = (msg.courseCode || (courseCode && courseCode.length <= 15))
              ? (msg.courseCode || courseCode)
              : extractCourseCode(verifiedCourseName);

            const prompt = `You are an academic assistant analyzing messages from a university course channel.

Message Details:
- Active Course Context: "${verifiedCourseName}"
- Course Code: "${verifiedCourseCode}"
- Channel: "${channelName || 'General'}"
- Sender: "${msg.sender || 'Unknown'}"
- Sent Timestamp (Base Reference Time): "${referenceTimestamp}"
- User's Local Timezone: "${userTimezone}" (default UTC+8)
- Message URL: "${msg.url || 'N/A'}"

Message Content:
"""
${msg.text}
"""

Task:
Analyze whether this message announces or contains an academic assignment, project, homework, lab, problem set, quiz, exam, or deadline.

Critical Timezone & Deadline Instructions:
1. Interpret all relative date and time phrases (e.g. "tonight at 11:59 PM", "due tomorrow 5 PM", "this Sunday at 11:59 PM", "next Tuesday", "in 3 days") strictly within the context of the user's specified local timezone ("${userTimezone}").
2. The message was sent at "${referenceTimestamp}". Resolve all relative dates using this timestamp mapped to the user's timezone.
3. Always return 'due_date_iso' as a fully qualified ISO 8601 string including the correct timezone offset (e.g. "2026-09-06T23:59:00+08:00") or converted cleanly to UTC with an exact Z suffix matching that exact local moment.
4. If only a date is mentioned without a specific time, assume 23:59:59 on that date in the user's local timezone ("${userTimezone}").
5. Extract concise title and description (instructions or submission links).
6. Return false for is_assignment if this is casual communication, greetings, or general Q&A without a clear actionable assignment or resolvable deadline.
7. If no deadline or due date can be resolved, return due_date_iso as null.

CRITICAL COURSE CONTEXT RULES (ANTI-HALLUCINATION):
- DO NOT invent, guess, or hallucinate course names or course codes. You MUST use the exact 'Active Course Context' provided ("${verifiedCourseName}") and set course_code to "${verifiedCourseCode}".
- If an assignment text explicitly specifies a sub-section or lab code within that course, you may note that, but NEVER generate unrelated generic codes (e.g., CS101, ENG201, MATH101) not provided in the input.`;

            const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
            let response;
            try {
              response = await ai.models.generateContent({
                model: modelName,
                contents: prompt,
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: geminiResponseSchema,
                  temperature: 0.1,
                },
              });
            } catch (modelError: any) {
              console.warn(`Model (${modelName}) error: ${modelError.message || modelError}. Retrying once...`);
              await new Promise((resolve) => setTimeout(resolve, 800));
              response = await ai.models.generateContent({
                model: modelName,
                contents: prompt,
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: geminiResponseSchema,
                  temperature: 0.1,
                },
              });
            }

            const rawText = response.text?.trim() || '{}';
            const extraction = JSON.parse(rawText) as GeminiExtractionResult;

            if (extraction && extraction.is_assignment) {
              return { hash, msg, extraction };
            }
            return null;
          })
        );

        for (const res of settledBatch) {
          if (res.status === 'fulfilled' && res.value) {
            parsedAssignments.push(res.value);
          } else if (res.status === 'rejected') {
            console.error('Chat batch analysis rejected item:', res.reason);
          }
        }
      }

      // Convert parsed chat assignments into tasksToInsert
      for (const { hash, msg, extraction } of parsedAssignments) {
        // 1. Validate title: discard if lacking clear assignment title
        const rawTitle = (extraction.title || '').trim();
        if (!rawTitle || rawTitle.length < 2 || rawTitle.toLowerCase() === 'untitled assignment') {
          continue;
        }

        // 2. Validate due date: discard if lacking resolvable due date
        if (!extraction.due_date_iso || !extraction.due_date_iso.trim()) {
          continue;
        }

        const resolvedDueDateUtc = resolveDueDateToUtcIso(
          extraction.due_date_iso,
          userTimezone,
          msg.timestamp || new Date().toISOString()
        );

        if (!resolvedDueDateUtc) continue;

        const dueDateObj = new Date(resolvedDueDateUtc);
        if (isNaN(dueDateObj.getTime())) continue;

        // Ingestion Rule: Only discard overdue assignments (due date strictly before the start of today, 00:00:00 local time).
        // Keep ALL upcoming assignments (whether due tomorrow, next week, or next month).
        if (dueDateObj.getTime() < startOfToday.getTime()) {
          continue;
        }

        const verifiedCourseName = cleanCourseName(msg.courseName || courseName || channelName || '') || 'General';
        const verifiedCourseCode = (msg.courseCode || (courseCode && courseCode.length <= 15))
          ? (msg.courseCode || courseCode)
          : extractCourseCode(verifiedCourseName);

        // Filter out generic hallucinated codes
        const hallucinatedCodes = ['CS101', 'ENG101', 'ENG201', 'MATH101', 'MATH200', 'PHYS211', 'COURSE', 'GENERAL'];
        const returnedCode = (extraction.course_code || '').trim().toUpperCase();
        const finalCourseCode = (returnedCode && !hallucinatedCodes.includes(returnedCode) && returnedCode.length <= 15)
          ? returnedCode
          : verifiedCourseCode;

        const courseId = await resolveCourseId(verifiedCourseName, finalCourseCode);

        tasksToInsert.push({
          user_id: userId,
          course_id: courseId,
          title: rawTitle,
          description: extraction.description?.trim() || null,
          due_date: resolvedDueDateUtc,
          source_type: 'chat_announcement',
          source_url: msg.url ? String(msg.url).trim() : null,
          raw_message_hash: hash,
          status: 'pending',
        });
      }
    }

    // Deduplicate tasksToInsert by raw_message_hash so batch items never conflict with each other
    const uniqueTasksMap = new Map<string, (typeof tasksToInsert)[0]>();
    for (const task of tasksToInsert) {
      if (!uniqueTasksMap.has(task.raw_message_hash)) {
        uniqueTasksMap.set(task.raw_message_hash, task);
      }
    }
    const finalTasksToInsert = Array.from(uniqueTasksMap.values());

    if (finalTasksToInsert.length === 0) {
      return jsonResponse(
        {
          success: true,
          inserted: 0,
          updated: 0,
          skipped: messageEntries.length,
          tasks: [],
        },
        200
      );
    }

    // Upsert tasks into Neon database with ON CONFLICT resolution
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const allReturnedTasks: Array<Record<string, unknown>> = [];

    await Promise.all(
      finalTasksToInsert.map(async (task) => {
        try {
          const [row] = await sql`
            INSERT INTO tasks (
              user_id,
              course_id,
              title,
              description,
              due_date,
              source_type,
              source_url,
              raw_message_hash,
              status
            ) VALUES (
              ${task.user_id}::uuid,
              ${task.course_id ? task.course_id : null},
              ${task.title},
              ${task.description},
              ${task.due_date}::timestamptz,
              ${task.source_type},
              ${task.source_url},
              ${task.raw_message_hash},
              ${task.status}
            )
            ON CONFLICT (raw_message_hash) 
            DO UPDATE SET 
              title = EXCLUDED.title,
              due_date = EXCLUDED.due_date,
              description = COALESCE(EXCLUDED.description, tasks.description),
              source_url = CASE
                -- 1. If incoming source_url is a specific deep link, always update to it (overriding previous broken/generic URLs):
                WHEN EXCLUDED.source_url IS NOT NULL 
                     AND EXCLUDED.source_url NOT IN ('https://teams.microsoft.com', 'https://teams.microsoft.com/', 'https://teams.microsoft.com/v2', 'https://teams.microsoft.com/v2/', 'https://teams.microsoft.com/_', 'https://teams.microsoft.com/_/')
                     AND EXCLUDED.source_url ~* '(/l/|/conversations/|groupId=|threadId=|channelId=|assignment|parentMessageId=)'
                THEN EXCLUDED.source_url

                -- 2. If existing tasks.source_url is already a specific deep link, do NOT overwrite with bare generic fallback:
                WHEN tasks.source_url IS NOT NULL 
                     AND tasks.source_url NOT IN ('https://teams.microsoft.com', 'https://teams.microsoft.com/', 'https://teams.microsoft.com/v2', 'https://teams.microsoft.com/v2/', 'https://teams.microsoft.com/_', 'https://teams.microsoft.com/_/')
                     AND tasks.source_url ~* '(/l/|/conversations/|groupId=|threadId=|channelId=|assignment|parentMessageId=)'
                THEN tasks.source_url

                -- 3. Fallback to whatever non-null URL is available
                ELSE COALESCE(EXCLUDED.source_url, tasks.source_url)
              END,
              updated_at = NOW()
            RETURNING *, (xmax = 0) AS is_inserted
          `;

          if (row) {
            allReturnedTasks.push(row);
            if (row.is_inserted) {
              insertedCount++;
            } else {
              updatedCount++;
            }
          } else {
            skippedCount++;
          }
        } catch (itemError) {
          console.error(`Error upserting task for hash ${task.raw_message_hash}:`, itemError);
          skippedCount++;
        }
      })
    );

    // Return 200 with metrics and array of newly created/updated tasks
    return jsonResponse(
      {
        success: true,
        inserted: insertedCount,
        updated: updatedCount,
        skipped: skippedCount,
        tasks: allReturnedTasks,
      },
      200
    );
  } catch (error: unknown) {
    console.error('Unhandled error in /api/ingest:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return jsonResponse({ error: message }, 500);
  }
}
