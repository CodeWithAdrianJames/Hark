import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL in environment');
  process.exit(1);
}

const sql = neon(databaseUrl);
const TARGET_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function normalizeCourseCode(raw) {
  if (!raw || typeof raw !== 'string') return 'GENERAL';
  const clean = raw.replace(/^\[+|\]+$/g, '').trim();
  const csitMatch = clean.match(/\b(CSIT\d{2,4}[A-Z0-9]*)\b/i);
  if (csitMatch) return csitMatch[1].toUpperCase();

  const deptMatch = clean.match(/\b([A-Z]{2,6})\s*(\d{2,4}[A-Z0-9]*)\b/i);
  if (deptMatch) return `${deptMatch[1].toUpperCase()}${deptMatch[2].toUpperCase()}`;

  const bracketMatch = clean.match(/\[([A-Za-z0-9_\-]+)\]/);
  if (bracketMatch && bracketMatch[1].length <= 15) return bracketMatch[1].toUpperCase();

  const firstWord = clean.split(/[\s\[\(\-]/)[0];
  if (firstWord && firstWord.length <= 15 && /[A-Za-z]/i.test(firstWord)) return firstWord.toUpperCase();

  return clean.slice(0, 15).toUpperCase();
}

function normalizeTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  return rawTitle
    .toLowerCase()
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/[^a-z0-9]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeCanonicalTaskHash(userId, courseCode, title) {
  const cleanCode = normalizeCourseCode(courseCode);
  const cleanTitle = normalizeTitle(title);
  return crypto
    .createHash('sha256')
    .update(`${userId}_${cleanCode}_${cleanTitle}`)
    .digest('hex');
}

const REAL_DELIVERABLES = [
  {
    titlePattern: '4 quiz',
    canonicalTitle: '4_Quiz (c/o CodeChum)',
    courseCode: 'CSIT321G1',
    courseBadge: '[CSIT321G1]',
    canonicalDueIso: '2026-09-06T17:00:00.000Z', // Sep 7, 2026, 1:00 AM (UTC+8)
    rawDueString: 'Sep 7, 2026 1:00 AM',
    assignmentId: 'abf580cd-830a-41f4-b7b0-4af1e96104df',
    portalUrl: 'https://teams.microsoft.com/_#/assignments/',
  },
  {
    titlePattern: '5 prelim',
    canonicalTitle: '5_Prelim Exam',
    courseCode: 'CSIT321G1',
    courseBadge: '[CSIT321G1]',
    canonicalDueIso: '2026-09-06T17:30:00.000Z', // Sep 7, 2026, 1:30 AM (UTC+8)
    rawDueString: 'Sep 7, 2026 1:30 AM',
    portalUrl: 'https://teams.microsoft.com/_#/assignments/',
  },
  {
    titlePattern: 'final proposal',
    canonicalTitle: '📢 FINAL PROPOSAL AS YOUR PRELIM EXAM',
    courseCode: 'IT317',
    courseBadge: '[IT317]',
    canonicalDueIso: '2026-09-08T15:59:59.000Z', // Sep 8, 2026, 11:59 PM (UTC+8)
    rawDueString: 'Sep 8, 2026 11:59 PM',
    portalUrl: 'https://teams.microsoft.com/_#/assignments/',
  },
  {
    titlePattern: 'research assignment',
    canonicalTitle: 'RESEARCH ASSIGNMENT Project Management Process in IT',
    courseCode: 'IT365',
    courseBadge: '[IT365]',
    canonicalDueIso: '2026-09-12T15:59:59.000Z', // Sep 12, 2026, 11:59 PM (UTC+8)
    rawDueString: 'Sep 12, 2026 11:59 PM',
    portalUrl: 'https://teams.microsoft.com/_#/assignments/',
  },
  {
    titlePattern: 'acquaintance party attendance',
    canonicalTitle: 'CCS Acquaintance Party Attendance (Optional but Highly Encouraged)',
    courseCode: 'CSIT321G1',
    courseBadge: '[CSIT321G1]',
    canonicalDueIso: '2026-09-13T15:59:59.000Z', // Sep 13, 2026, 11:59 PM (UTC+8)
    rawDueString: 'Sep 13, 2026 11:59 PM',
    portalUrl: 'https://teams.microsoft.com/_#/assignments/',
  },
  {
    titlePattern: 'acquaintance party bonus',
    canonicalTitle: '📢 ANNOUNCEMENT: ACQUAINTANCE PARTY BONUS',
    courseCode: 'IT317',
    courseBadge: '[IT317]',
    canonicalDueIso: '2026-09-30T15:59:59.000Z', // Sep 30, 2026, 11:59 PM (UTC+8)
    rawDueString: 'Sep 30, 2026 11:59 PM',
    portalUrl: 'https://teams.microsoft.com/_#/assignments/',
  },
];

async function runClean() {
  console.log(`=== Starting Database Cleanup for User ${TARGET_USER_ID} ===\n`);

  // 1. Delete mock entries
  const deletedMocks = await sql`
    DELETE FROM tasks
    WHERE user_id = ${TARGET_USER_ID}::uuid
      AND (
        title ILIKE '%Case Analysis 1: Agile Sprints in Industry%'
        OR title ILIKE '%Milestone 2 Architecture & Schema Submission%'
        OR title ILIKE '%Case Analysis%'
        OR title ILIKE '%Milestone 2%'
      )
    RETURNING id, title;
  `;
  console.log(`1. Deleted ${deletedMocks.length} mock task(s):`);
  deletedMocks.forEach(m => console.log(`   - Removed: "${m.title}" (id: ${m.id})`));

  // 2. Fetch or create courses
  const existingCourses = await sql`
    SELECT id, code, name
    FROM courses
    WHERE user_id = ${TARGET_USER_ID}::uuid;
  `;
  const courseMap = new Map();
  for (const c of existingCourses) {
    const code = normalizeCourseCode(c.code);
    if (!courseMap.has(code)) courseMap.set(code, c.id);
  }

  for (const item of REAL_DELIVERABLES) {
    const code = normalizeCourseCode(item.courseCode);
    if (!courseMap.has(code)) {
      const [newCourse] = await sql`
        INSERT INTO courses (user_id, code, name)
        VALUES (${TARGET_USER_ID}::uuid, ${code}, ${item.courseBadge})
        RETURNING id;
      `;
      if (newCourse) {
        courseMap.set(code, newCourse.id);
        console.log(`   + Created course [${code}] (id: ${newCourse.id})`);
      }
    }
  }

  // 3. Current tasks inspection
  const currentTasks = await sql`
    SELECT id, title, due_date, raw_message_hash, course_id
    FROM tasks
    WHERE user_id = ${TARGET_USER_ID}::uuid;
  `;
  console.log(`\n2. Found ${currentTasks.length} existing tasks in DB before deduping.`);

  const preservedTaskIds = new Set();
  const toDeleteTaskIds = [];

  for (const def of REAL_DELIVERABLES) {
    const matches = currentTasks.filter((t) => {
      const norm = normalizeTitle(t.title);
      return norm.includes(def.titlePattern);
    });

    const targetTime = new Date(def.canonicalDueIso).getTime();
    const courseId = courseMap.get(normalizeCourseCode(def.courseCode));
    const canonicalHash = computeCanonicalTaskHash(TARGET_USER_ID, def.courseCode, def.canonicalTitle);

    if (matches.length === 0) {
      console.log(`   + Inserting missing canonical task: "${def.canonicalTitle}"`);
      const [inserted] = await sql`
        INSERT INTO tasks (
          user_id,
          course_id,
          title,
          description,
          due_date,
          source_type,
          source_url,
          deep_link,
          assignment_id,
          raw_message_hash,
          status
        )
        VALUES (
          ${TARGET_USER_ID}::uuid,
          ${courseId},
          ${def.canonicalTitle},
          'Extracted from MS Teams EDU Assignments Hub',
          ${def.canonicalDueIso}::timestamptz,
          'official_assignment',
          'https://teams.microsoft.com/_#/assignments/',
          'https://teams.microsoft.com/_#/assignments/',
          ${def.assignmentId || null},
          ${canonicalHash},
          'pending'
        )
        ON CONFLICT (raw_message_hash)
        DO UPDATE SET
          assignment_id = EXCLUDED.assignment_id,
          title = EXCLUDED.title,
          source_url = EXCLUDED.source_url,
          deep_link = EXCLUDED.deep_link,
          due_date = EXCLUDED.due_date,
          updated_at = NOW()
        RETURNING id;
      `;
      if (inserted) preservedTaskIds.add(inserted.id);
    } else {
      // Pick best match closest to target time
      let bestMatch = matches[0];
      for (const m of matches) {
        const mTime = new Date(m.due_date).getTime();
        if (Math.abs(mTime - targetTime) < Math.abs(new Date(bestMatch.due_date).getTime() - targetTime)) {
          bestMatch = m;
        }
      }

      preservedTaskIds.add(bestMatch.id);

      // Collect duplicates for deletion
      for (const m of matches) {
        if (m.id !== bestMatch.id) {
          toDeleteTaskIds.push(m.id);
          console.log(`   - Marking duplicate for removal: "${m.title}" (due: ${m.due_date}, id: ${m.id})`);
        }
      }

      const finalUrl = 'https://teams.microsoft.com/_#/assignments/';

      // Update best match to canonical due date, course, assignment_id, universal deep link, and hash
      await sql`
        UPDATE tasks
        SET
          title = ${def.canonicalTitle},
          due_date = ${def.canonicalDueIso}::timestamptz,
          course_id = ${courseId || bestMatch.course_id},
          assignment_id = ${def.assignmentId || bestMatch.assignment_id || null},
          source_url = ${finalUrl},
          deep_link = ${finalUrl},
          raw_message_hash = ${canonicalHash},
          updated_at = NOW()
        WHERE id = ${bestMatch.id}::uuid;
      `;
    }
  }

  // Delete any tasks that do not match the real deliverables
  for (const t of currentTasks) {
    if (!preservedTaskIds.has(t.id) && !toDeleteTaskIds.includes(t.id)) {
      toDeleteTaskIds.push(t.id);
      console.log(`   - Marking non-matching task for removal: "${t.title}" (id: ${t.id})`);
    }
  }

  if (toDeleteTaskIds.length > 0) {
    await sql`
      DELETE FROM tasks
      WHERE id = ANY(${toDeleteTaskIds}::uuid[]);
    `;
    console.log(`\n3. Successfully purged ${toDeleteTaskIds.length} duplicate/orphan task rows.`);
  }

  // 4. Final verification
  const finalTasks = await sql`
    SELECT 
      t.id,
      t.title,
      c.code AS course_code,
      t.due_date,
      t.raw_message_hash
    FROM tasks t
    LEFT JOIN courses c ON t.course_id = c.id
    WHERE t.user_id = ${TARGET_USER_ID}::uuid
    ORDER BY t.due_date ASC;
  `;

  console.log(`\n=== Final Clean State: Exactly ${finalTasks.length} Real Deliverables ===`);
  console.table(
    finalTasks.map((t) => ({
      ID: t.id.slice(0, 8),
      Course: `[${t.course_code}]`,
      Title: t.title,
      DueDateUTC: t.due_date,
      Hash: t.raw_message_hash?.slice(0, 12) + '...',
    }))
  );

  console.log('\nDatabase cleanup complete ✅');
}

runClean().catch(console.error);
