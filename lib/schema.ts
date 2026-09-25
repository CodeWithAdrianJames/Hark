import crypto from 'crypto';

/**
 * ---------------------------------------------------------------------------
 * Database Record Contracts & TypeScript Schema Definitions
 * Mirrors PostgreSQL Tables, Foreign Keys, Composite Indexes & Constraints
 * ---------------------------------------------------------------------------
 */

export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export type TaskSourceType = 'official_assignment' | 'chat_announcement';

export interface UserRecord {
  id: string; // UUID primary key
  email: string;
  created_at: string;
}

export interface CourseRecord {
  id: string; // UUID primary key
  user_id: string; // Foreign key -> users(id) ON DELETE CASCADE
  code: string; // Normalized course code (e.g., CSIT321G1, IT317)
  name: string; // Course name or title
  channel_id: string | null; // Associated Teams channel/class identifier
  created_at: string;
}

export interface TaskRecord {
  id: string; // UUID primary key
  user_id: string; // Foreign key -> users(id) ON DELETE CASCADE
  course_id: string | null; // Foreign key -> courses(id) ON DELETE CASCADE
  assignment_id: string | null; // Microsoft Teams official assignment UUID
  class_id: string | null; // Microsoft Teams class / channel UUID
  title: string;
  description: string | null;
  due_date: string; // timestamptz
  source_type: TaskSourceType;
  source_url: string | null;
  deep_link: string | null;
  raw_message_hash: string; // SHA-256 canonical message/assignment hash
  status: TaskStatus;
  is_completed?: boolean;
  urgency?: string;
  created_at: string;
  updated_at?: string;
}

export interface TaskWithCourse extends TaskRecord {
  course_code?: string;
  course_name?: string;
  completed?: boolean;
}

/**
 * Composite Database Constraints & Index Specifications
 * Documents verified PostgreSQL catalog invariants established in:
 * - migrations/0001_init_schema.sql
 * - migrations/0002_fix_constraints_and_indexes.sql
 */
export const DATABASE_CONSTRAINTS = {
  tasks: {
    primaryKey: 'id',
    foreignKeys: {
      user_id: 'users(id) ON DELETE CASCADE',
      course_id: 'courses(id) ON DELETE CASCADE',
    },
    uniqueConstraints: {
      // DAT-02: Tenant-scoped assignment deduplication
      tasks_user_id_raw_message_hash_idx: ['user_id', 'raw_message_hash'],
      // Official Microsoft Teams assignment deduplication per student
      tasks_user_assignment_unique: ['user_id', 'assignment_id'],
    },
    compositeIndexes: {
      // PRF-03: Dashboard query sorting and pagination index
      idx_tasks_user_due_created: ['user_id', 'due_date ASC', 'created_at DESC'],
      idx_tasks_user_due_date: ['user_id', 'due_date ASC'],
      idx_tasks_user_status: ['user_id', 'status'],
      idx_tasks_course_id: ['course_id'],
    },
  },
  courses: {
    primaryKey: 'id',
    foreignKeys: {
      user_id: 'users(id) ON DELETE CASCADE',
    },
    uniqueConstraints: {
      // ARC-04: Atomic course resolution & duplicate prevention per student
      courses_user_id_code_idx: ['user_id', 'code'],
    },
    indexes: {
      idx_courses_user_id: ['user_id'],
      idx_courses_channel_id: ['channel_id'],
    },
  },
} as const;

/**
 * Normalizes course codes into a clean uppercase string without brackets.
 * Examples:
 * - "CSIT321G1 - 1stSem AY26-27" -> "CSIT321G1"
 * - "IT317[G1][1stSem/26-27]AMPARO" -> "IT317"
 * - "IT365 Data Analytics 1 - G1 S1 AY2627" -> "IT365"
 * - "[IT317]" -> "IT317"
 */
export function normalizeCourseCode(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return 'GENERAL';
  const clean = raw.replace(/^\[+|\]+$/g, '').trim();

  // 1. Check for specific department prefixes with full section code (e.g. CSIT321G1)
  const csitMatch = clean.match(/\b(CSIT\d{2,4}[A-Z0-9]*)\b/i);
  if (csitMatch) {
    return csitMatch[1].toUpperCase();
  }

  // 2. Check for standard department code + number (e.g. IT317, IT365, CS311)
  const deptMatch = clean.match(/\b([A-Z]{2,6})\s*(\d{2,4}[A-Z0-9]*)\b/i);
  if (deptMatch) {
    return `${deptMatch[1].toUpperCase()}${deptMatch[2].toUpperCase()}`;
  }

  // 3. Check for bracketed codes e.g. [IT317]
  const bracketMatch = clean.match(/\[([A-Za-z0-9_\-]+)\]/);
  if (bracketMatch && bracketMatch[1].length <= 15) {
    return bracketMatch[1].toUpperCase();
  }

  // 4. Fallback first word token
  const firstWord = clean.split(/[\s\[\(\-]/)[0];
  if (firstWord && firstWord.length <= 15 && /[A-Za-z]/i.test(firstWord)) {
    return firstWord.toUpperCase();
  }

  return clean.slice(0, 15).toUpperCase();
}

/**
 * Returns formatted badge representation e.g. "[CSIT321G1]"
 */
export function formatCourseBadge(raw: string | null | undefined): string {
  const code = normalizeCourseCode(raw);
  return `[${code}]`;
}

/**
 * Normalizes deliverable titles by removing emojis, punctuation, and multiple spaces.
 * Ensures consistent canonical hash calculation across varying OCR/DOM text extractions.
 */
export function normalizeTitle(rawTitle: string | null | undefined): string {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  return rawTitle
    .toLowerCase()
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // strip emojis
    .replace(/[^a-z0-9]/gi, ' ') // replace punctuation & symbols with spaces
    .replace(/\s+/g, ' ') // collapse multi-spaces
    .trim();
}

/**
 * Strictly anchors assignment uniqueness on:
 * unique_hash = sha256(`${userId}_${courseCode}_${normalizedTitle}`)
 * 
 * Guarantee: Re-scanning updates existing rows in-place when dates or descriptions
 * are adjusted without creating duplicate entries.
 */
export function computeCanonicalTaskHash(
  userId: string,
  courseCode: string | null | undefined,
  title: string | null | undefined
): string {
  const cleanCode = normalizeCourseCode(courseCode);
  const cleanTitle = normalizeTitle(title);
  return crypto
    .createHash('sha256')
    .update(`${userId}_${cleanCode}_${cleanTitle}`)
    .digest('hex');
}

/**
 * The 6 Real Scanned Deliverables from MS Teams EDU Assignments Hub:
 * Reference ground truth for cleanup, verification, and fallback alignment.
 */
export interface RealDeliverableDefinition {
  titlePattern: string;
  canonicalTitle: string;
  courseCode: string;
  courseBadge: string;
  canonicalDueIso: string;
  rawDueString: string;
  portalUrl?: string;
  assignmentId?: string;
}

export const REAL_DELIVERABLES: RealDeliverableDefinition[] = [
  {
    titlePattern: '4 quiz',
    canonicalTitle: '4_Quiz (c/o CodeChum)',
    courseCode: 'CSIT321G1',
    courseBadge: '[CSIT321G1]',
    canonicalDueIso: '2026-09-06T17:00:00.000Z', // Sep 7, 2026, 1:00 AM (UTC+8)
    rawDueString: 'Sep 7, 2026 1:00 AM',
    assignmentId: 'abf580cd-830a-41f4-b7b0-4af1e96104df',
    portalUrl: 'https://teams.microsoft.com/v2/',
  },
  {
    titlePattern: '5 prelim',
    canonicalTitle: '5_Prelim Exam',
    courseCode: 'CSIT321G1',
    courseBadge: '[CSIT321G1]',
    canonicalDueIso: '2026-09-06T17:30:00.000Z', // Sep 7, 2026, 1:30 AM (UTC+8)
    rawDueString: 'Sep 7, 2026 1:30 AM',
    portalUrl: 'https://teams.microsoft.com/v2/',
  },
  {
    titlePattern: 'final proposal',
    canonicalTitle: '📢 FINAL PROPOSAL AS YOUR PRELIM EXAM',
    courseCode: 'IT317',
    courseBadge: '[IT317]',
    canonicalDueIso: '2026-09-08T15:59:59.000Z', // Sep 8, 2026, 11:59 PM (UTC+8)
    rawDueString: 'Sep 8, 2026 11:59 PM',
    portalUrl: 'https://teams.microsoft.com/v2/',
  },
  {
    titlePattern: 'research assignment',
    canonicalTitle: 'RESEARCH ASSIGNMENT Project Management Process in IT',
    courseCode: 'IT365',
    courseBadge: '[IT365]',
    canonicalDueIso: '2026-09-12T15:59:59.000Z', // Sep 12, 2026, 11:59 PM (UTC+8)
    rawDueString: 'Sep 12, 2026 11:59 PM',
    portalUrl: 'https://teams.microsoft.com/v2/',
  },
  {
    titlePattern: 'acquaintance party attendance',
    canonicalTitle: 'CCS Acquaintance Party Attendance (Optional but Highly Encouraged)',
    courseCode: 'CSIT321G1',
    courseBadge: '[CSIT321G1]',
    canonicalDueIso: '2026-09-13T15:59:59.000Z', // Sep 13, 2026, 11:59 PM (UTC+8)
    rawDueString: 'Sep 13, 2026 11:59 PM',
    portalUrl: 'https://teams.microsoft.com/v2/',
  },
  {
    titlePattern: 'acquaintance party bonus',
    canonicalTitle: '📢 ANNOUNCEMENT: ACQUAINTANCE PARTY BONUS',
    courseCode: 'IT317',
    courseBadge: '[IT317]',
    canonicalDueIso: '2026-09-30T15:59:59.000Z', // Sep 30, 2026, 11:59 PM (UTC+8)
    rawDueString: 'Sep 30, 2026 11:59 PM',
    portalUrl: 'https://teams.microsoft.com/v2/',
  },
];
