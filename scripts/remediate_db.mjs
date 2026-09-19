import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('--- Step 1: Fix 5_Prelim Exam null assignment_id ---');
  const fixPrelim = await sql`
    UPDATE tasks
    SET 
      assignment_id = id::text,
      updated_at = NOW()
    WHERE title = '5_Prelim Exam' AND assignment_id IS NULL
    RETURNING id, title, assignment_id;
  `;
  console.log('Updated Prelim Exam task:', fixPrelim);

  console.log('\n--- Step 2: Sanitize noisy courses channel_id breadcrumbs ---');
  const dirtyCourses = await sql`
    SELECT id, name, channel_id
    FROM courses
    WHERE channel_id LIKE '%Teams and Channels%' OR channel_id LIKE '%|%';
  `;
  console.log(`Found ${dirtyCourses.length} courses with noisy channel_id.`);

  for (const c of dirtyCourses) {
    let clean = c.channel_id || '';
    clean = clean.replace(/^\(\d+\+?\)\s*/, '');
    clean = clean.replace(/^(?:teams\s+and\s+channels|microsoft\s+teams|teams|chats?)\s*[|:›>–—\-]\s*/i, '');
    clean = clean.replace(/\s*[|:›>–—\-]\s*(?:microsoft\s+teams|teams|general)$/i, '');
    if (clean.includes('|')) {
      const parts = clean.split('|').map(p => p.trim()).filter(Boolean);
      clean = parts[parts.length - 1] || 'General';
    }
    await sql`
      UPDATE courses
      SET channel_id = ${clean.trim() || 'General'}
      WHERE id = ${c.id};
    `;
    console.log(`Cleaned course ${c.name}: '${c.channel_id}' -> '${clean.trim() || 'General'}'`);
  }

  console.log('\n--- Step 3: Prune phantom / ghost courses (0 tasks & no deliverables) ---');
  const deletedCourses = await sql`
    DELETE FROM courses c
    WHERE c.id NOT IN (SELECT DISTINCT course_id FROM tasks WHERE course_id IS NOT NULL)
      AND (
        c.code IN ('MAIN', 'CS311', 'CS420', 'LSG02')
        OR c.name ILIKE '%main channels%'
        OR c.name ILIKE '%teams and channels%'
      )
    RETURNING id, code, name;
  `;
  console.log('Pruned phantom courses:', deletedCourses);

  console.log('\n--- Step 4: Run database deduplication query on tasks ---');
  // Prune any duplicate tasks retaining the one with the newest updated_at / highest id
  const prunedDupes = await sql`
    DELETE FROM tasks a USING tasks b
    WHERE a.id < b.id 
      AND a.user_id = b.user_id 
      AND (
        (a.assignment_id IS NOT NULL AND b.assignment_id IS NOT NULL AND a.assignment_id = b.assignment_id)
        OR (a.title = b.title AND COALESCE(a.course_name, '') = COALESCE(b.course_name, ''))
      )
    RETURNING a.id, a.title;
  `;
  console.log(`Pruned ${prunedDupes.length} duplicate task(s).`);

  console.log('\n--- Verification: Current Course Count & Task Count ---');
  const finalTasks = await sql`SELECT COUNT(*) as task_count FROM tasks;`;
  const finalCourses = await sql`SELECT COUNT(*) as course_count FROM courses;`;
  console.log(`Final tasks in DB: ${finalTasks[0].task_count}`);
  console.log(`Final courses in DB: ${finalCourses[0].course_count}`);
}

main().catch(console.error);
