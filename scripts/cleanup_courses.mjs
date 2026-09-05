import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL in .env.local');
  process.exit(1);
}

const sql = neon(databaseUrl);

function cleanCourseName(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.trim();

  text = text.replace(/^\(\d+\+?\)\s*/, '');
  text = text.replace(/[\u{1F514}\u{25CF}\u{25CB}\u{2022}]/gu, '');
  text = text.replace(/\s*\d+\s+unread.*$/i, '');

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

  return text.trim();
}

function extractCourseCode(cleanName) {
  if (!cleanName) return 'GENERAL';
  const match = cleanName.match(/\b([A-Z]{2,6}\s*(?:-|\s)?\s*\d{2,4}[A-Z0-9]*)\b/i);
  if (match) {
    return match[1].replace(/[\s\-]/g, '').toUpperCase();
  }
  const bracketMatch = cleanName.match(/\[([A-Za-z0-9_\-]+)\]/);
  if (bracketMatch && bracketMatch[1].length <= 15) {
    return bracketMatch[1].toUpperCase();
  }
  const firstWord = cleanName.split(/[\s\[\(\-]/)[0];
  return firstWord && firstWord.length <= 15 ? firstWord.toUpperCase() : cleanName.slice(0, 20).toUpperCase();
}

async function cleanup() {
  console.log('--- Cleaning Up Courses & Relabeling Tasks in Neon DB ---');

  // 1. Fetch all courses
  const courses = await sql`
    SELECT c.id, c.user_id, c.code, c.name, c.channel_id,
           COUNT(t.id) as task_count
    FROM courses c
    LEFT JOIN tasks t ON t.course_id = c.id
    GROUP BY c.id, c.user_id, c.code, c.name, c.channel_id
    ORDER BY c.created_at ASC
  `;

  console.log(`Found ${courses.length} total courses in database.`);

  // 2. Track primary course per user + clean code
  const primaryCourseMap = new Map(); // key: `${userId}::${cleanCode}` -> primary course row
  const toDeleteCourseIds = [];
  const toUpdateCourses = [];

  const hallucinatedCodes = ['CS412 - CLOUD ARCHITECTURE', 'CS499 - CAPSTONE SYSTEMS', 'CS101', 'ENG201'];

  for (const c of courses) {
    const taskCount = parseInt(c.task_count, 10);
    const cleanName = cleanCourseName(c.name) || cleanCourseName(c.channel_id) || c.code;
    const cleanCode = extractCourseCode(cleanName);

    // If hallucinated with 0 tasks, mark for deletion
    const isHallucinated = hallucinatedCodes.some(
      (h) => c.code.toUpperCase().includes(h) || c.name.toUpperCase().includes(h)
    );

    if (isHallucinated && taskCount === 0) {
      console.log(`Deleting orphan hallucinated course: [${c.code}] "${c.name}"`);
      toDeleteCourseIds.push(c.id);
      continue;
    }

    const key = `${c.user_id}::${cleanCode}`;
    if (!primaryCourseMap.has(key)) {
      primaryCourseMap.set(key, { id: c.id, cleanCode, cleanName });
      toUpdateCourses.push({ id: c.id, cleanCode, cleanName });
    } else {
      // Duplicate course for the same user & clean code!
      const primary = primaryCourseMap.get(key);
      console.log(`Found duplicate course [${c.code}] (id: ${c.id}). Merging into primary (id: ${primary.id})...`);
      // Re-point any tasks to primary
      if (taskCount > 0) {
        await sql`
          UPDATE tasks
          SET course_id = ${primary.id}::uuid
          WHERE course_id = ${c.id}::uuid
        `;
      }
      toDeleteCourseIds.push(c.id);
    }
  }

  // 3. Update cleaned names and codes on primary courses
  for (const item of toUpdateCourses) {
    await sql`
      UPDATE courses
      SET code = ${item.cleanCode},
          name = ${item.cleanName}
      WHERE id = ${item.id}::uuid
    `;
    console.log(`Updated course ${item.id} -> code: [${item.cleanCode}], name: "${item.cleanName}"`);
  }

  // 4. Delete orphan and duplicate courses
  if (toDeleteCourseIds.length > 0) {
    await sql`
      DELETE FROM courses
      WHERE id = ANY(${toDeleteCourseIds}::uuid[])
    `;
    console.log(`Deleted ${toDeleteCourseIds.length} duplicate/hallucinated course rows.`);
  }

  // 5. Inspect final cleaned state
  const finalCourses = await sql`
    SELECT c.id, c.code, c.name, COUNT(t.id) as active_tasks
    FROM courses c
    LEFT JOIN tasks t ON t.course_id = c.id
    GROUP BY c.id, c.code, c.name
    ORDER BY c.code ASC
  `;
  console.log('\n--- Final Cleaned Courses in Database ---');
  console.table(finalCourses);
}

cleanup().catch(console.error);
