import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
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

async function verify() {
  console.log('--- Verifying Database Alignment to 6 Real Deliverables ---\n');

  // 1. Query current tasks for active user
  const tasks = await sql`
    SELECT 
      t.id,
      t.title,
      c.code AS course_code,
      c.name AS course_name,
      t.due_date,
      t.source_url,
      t.deep_link,
      t.assignment_id,
      t.raw_message_hash,
      t.source_type
    FROM tasks t
    LEFT JOIN courses c ON t.course_id = c.id
    WHERE t.user_id = ${TARGET_USER_ID}::uuid
    ORDER BY t.due_date ASC;
  `;

  console.log(`Current tasks count: ${tasks.length}`);
  console.table(
    tasks.map((t) => ({
      Title: t.title,
      CourseBadge: `[${t.course_code}]`,
      AssignmentId: t.assignment_id || 'null',
      DeepLink: t.deep_link || t.source_url,
      DueDateUTC: t.due_date,
      HashPrefix: t.raw_message_hash?.slice(0, 10),
    }))
  );

  const mockTasks = tasks.filter(
    (t) =>
      t.title.includes('Case Analysis') ||
      t.title.includes('Milestone 2') ||
      t.title.includes('Agile Sprints')
  );

  console.log('\n--- Assertion Checks ---');
  const check1 = tasks.length === 6;
  console.log(`1. Exactly 6 tasks present: ${check1 ? 'PASSED ✅' : 'FAILED ❌'}`);

  const check2 = mockTasks.length === 0;
  console.log(`2. Zero mock entries present: ${check2 ? 'PASSED ✅' : 'FAILED ❌'}`);

  // Check expected course badges
  const quiz = tasks.find((t) => t.title.includes('4_Quiz'));
  const prelim = tasks.find((t) => t.title.includes('5_Prelim'));
  const finalProp = tasks.find((t) => t.title.includes('FINAL PROPOSAL'));
  const research = tasks.find((t) => t.title.includes('RESEARCH ASSIGNMENT'));
  const partyAtt = tasks.find((t) => t.title.includes('Acquaintance Party Attendance'));
  const partyBonus = tasks.find((t) => t.title.includes('PARTY BONUS'));

  const checkQuizCourse = quiz?.course_code === 'CSIT321G1';
  const checkPrelimCourse = prelim?.course_code === 'CSIT321G1';
  const checkFinalCourse = finalProp?.course_code === 'IT317';
  const checkResearchCourse = research?.course_code === 'IT365';
  const checkPartyAttCourse = partyAtt?.course_code === 'CSIT321G1';
  const checkPartyBonusCourse = partyBonus?.course_code === 'IT317';

  console.log(`3. 4_Quiz badge [CSIT321G1]: ${checkQuizCourse ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`4. 5_Prelim badge [CSIT321G1]: ${checkPrelimCourse ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`5. FINAL PROPOSAL badge [IT317]: ${checkFinalCourse ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`6. RESEARCH ASSIGNMENT badge [IT365]: ${checkResearchCourse ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`7. Party Attendance badge [CSIT321G1]: ${checkPartyAttCourse ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`8. Party Bonus badge [IT317]: ${checkPartyBonusCourse ? 'PASSED ✅' : 'FAILED ❌'}`);

  // Check expected due dates in UTC
  const isIsoNear = (dateStr, targetIso) => {
    const diff = Math.abs(new Date(dateStr).getTime() - new Date(targetIso).getTime());
    return diff <= 1000; // within 1 second
  };

  const checkQuizDate = isIsoNear(quiz?.due_date, '2026-09-06T17:00:00.000Z');
  const checkPrelimDate = isIsoNear(prelim?.due_date, '2026-09-06T17:30:00.000Z');
  const checkFinalDate = isIsoNear(finalProp?.due_date, '2026-09-08T15:59:59.000Z');
  const checkResearchDate = isIsoNear(research?.due_date, '2026-09-12T15:59:59.000Z');
  const checkPartyAttDate = isIsoNear(partyAtt?.due_date, '2026-09-13T15:59:59.000Z');
  const checkPartyBonusDate = isIsoNear(partyBonus?.due_date, '2026-09-30T15:59:59.000Z');

  console.log(`9. 4_Quiz due Sep 7 1:00 AM: ${checkQuizDate ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`10. 5_Prelim due Sep 7 1:30 AM: ${checkPrelimDate ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`11. FINAL PROPOSAL due Sep 8 11:59 PM: ${checkFinalDate ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`12. RESEARCH ASSIGNMENT due Sep 12 11:59 PM: ${checkResearchDate ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`13. Party Attendance due Sep 13 11:59 PM: ${checkPartyAttDate ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`14. Party Bonus due Sep 30 11:59 PM: ${checkPartyBonusDate ? 'PASSED ✅' : 'FAILED ❌'}`);

  const checkSpecificLinks = tasks.every(
    (t) => (t.deep_link || t.source_url) && !(t.deep_link || t.source_url).endsWith('/classes/all/list')
  );
  console.log(`15. All 6 tasks have valid deep links (not generic list): ${checkSpecificLinks ? 'PASSED ✅' : 'FAILED ❌'}`);

  const checkQuizAssignmentId = quiz?.assignment_id === 'abf580cd-830a-41f4-b7b0-4af1e96104df';
  console.log(`16. 4_Quiz assignmentId captured correctly: ${checkQuizAssignmentId ? 'PASSED ✅' : 'FAILED ❌'}`);

  // 2. Test Canonical Ingest Upsert: Re-simulate incoming sync with adjusted dates/descriptions
  console.log('\n--- Testing Re-scan Idempotency & In-place Upsert ---');
  const simulatedIncoming = [
    {
      title: '4_Quiz (c/o CodeChum)',
      courseCode: 'CSIT321G1',
      dueIso: '2026-09-06T17:00:00.000Z',
      assignmentId: 'abf580cd-830a-41f4-b7b0-4af1e96104df',
    },
    {
      title: '5_Prelim Exam',
      courseCode: 'CSIT321G1',
      dueIso: '2026-09-06T17:30:00.000Z',
    },
    {
      title: '📢 FINAL PROPOSAL AS YOUR PRELIM EXAM',
      courseCode: 'IT317',
      dueIso: '2026-09-08T15:59:59.000Z',
    },
    {
      title: 'RESEARCH ASSIGNMENT Project Management Process in IT',
      courseCode: 'IT365',
      dueIso: '2026-09-12T15:59:59.000Z',
    },
    {
      title: 'CCS Acquaintance Party Attendance (Optional but Highly Encouraged)',
      courseCode: 'CSIT321G1',
      dueIso: '2026-09-13T15:59:59.000Z',
    },
    {
      title: '📢 ANNOUNCEMENT: ACQUAINTANCE PARTY BONUS',
      courseCode: 'IT317',
      dueIso: '2026-09-30T15:59:59.000Z',
    },
  ];

  let insertCount = 0;
  let updateCount = 0;

  for (const item of simulatedIncoming) {
    const rawHash = computeCanonicalTaskHash(TARGET_USER_ID, item.courseCode, item.title);
    const result = await sql`
      INSERT INTO tasks (
        user_id,
        title,
        due_date,
        source_type,
        deep_link,
        source_url,
        assignment_id,
        raw_message_hash,
        status
      )
      VALUES (
        ${TARGET_USER_ID}::uuid,
        ${item.title},
        ${item.dueIso}::timestamptz,
        'official_assignment',
        'https://teams.microsoft.com/_#/assignments/',
        'https://teams.microsoft.com/_#/assignments/',
        ${item.assignmentId || null},
        ${rawHash},
        'pending'
      )
      ON CONFLICT (user_id, raw_message_hash)
      DO UPDATE SET
        assignment_id = EXCLUDED.assignment_id,
        deep_link = EXCLUDED.deep_link,
        title = EXCLUDED.title,
        due_date = EXCLUDED.due_date,
        updated_at = NOW()
      RETURNING (xmax = 0) AS is_insert;
    `;

    if (result[0]?.is_insert) insertCount++;
    else updateCount++;
  }

  console.log(`Re-scan results: ${insertCount} inserted, ${updateCount} updated in-place.`);
  const checkUpsert = insertCount === 0 && updateCount === 6;
  console.log(`17. Zero duplicate insertions on re-scan: ${checkUpsert ? 'PASSED ✅' : 'FAILED ❌'}`);

  const postSyncTasks = await sql`
    SELECT COUNT(*)::int as count FROM tasks WHERE user_id = ${TARGET_USER_ID}::uuid;
  `;
  const finalCount = postSyncTasks[0]?.count;
  console.log(`18. Final task count remains exactly 6: ${finalCount === 6 ? 'PASSED ✅' : 'FAILED ❌'}`);

  if (
    check1 &&
    check2 &&
    checkQuizCourse &&
    checkPrelimCourse &&
    checkFinalCourse &&
    checkResearchCourse &&
    checkPartyAttCourse &&
    checkPartyBonusCourse &&
    checkQuizDate &&
    checkPrelimDate &&
    checkFinalDate &&
    checkResearchDate &&
    checkPartyAttDate &&
    checkPartyBonusDate &&
    checkSpecificLinks &&
    checkQuizAssignmentId &&
    checkUpsert &&
    finalCount === 6
  ) {
    console.log('\n🎉 ALL 18 ASSERTIONS PASSED! Database is perfectly aligned with assignment IDs, tenant-agnostic links, and zero duplicate cards.');
  } else {
    console.error('\n❌ Some assertions failed.');
    process.exit(1);
  }
}

verify().catch(console.error);
