import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';

const envContent = fs.readFileSync('.env.local', 'utf-8');
const match = envContent.match(/DATABASE_URL=([^\r\n]+)/);
const databaseUrl = match ? match[1].trim() : '';

const sql = neon(databaseUrl);

async function run() {
  console.log("=== Starting Database Cleanup and Constraint Setup ===");

  // 1. Ensure columns exist on tasks table
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS class_id text;`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_completed boolean DEFAULT false;`;
  console.log("✓ Ensured class_id and is_completed columns exist on tasks table.");

  // 2. Delete corrupt single-letter / truncated scrape artifacts (<= 2 chars)
  const deletedCorrupt = await sql`
    DELETE FROM tasks
    WHERE LENGTH(TRIM(title)) <= 2
    RETURNING id, title, assignment_id, course_name;
  `;
  console.log(`✓ Deleted ${deletedCorrupt.length} truncated/corrupt artifact tasks (<= 2 chars):`, deletedCorrupt.map(t => `[${t.id}] "${t.title}"`));

  // 3. Delete duplicate title tasks where one row has assignment_id = NULL and the other has assignment_id != NULL
  const deletedNullDupes = await sql`
    DELETE FROM tasks a USING tasks b
    WHERE a.user_id = b.user_id
      AND a.title = b.title
      AND a.assignment_id IS NULL
      AND b.assignment_id IS NOT NULL
    RETURNING a.id, a.title, a.assignment_id;
  `;
  console.log(`✓ Deleted ${deletedNullDupes.length} unassigned duplicates where assigned record exists:`, deletedNullDupes);

  // 4. Delete duplicate tasks matching assignment_id or (title and course_name)
  const deletedGeneralDupes = await sql`
    DELETE FROM tasks a USING tasks b
    WHERE a.id < b.id 
      AND a.user_id = b.user_id 
      AND (
        (a.assignment_id IS NOT NULL AND b.assignment_id IS NOT NULL AND a.assignment_id = b.assignment_id)
        OR (a.title = b.title AND COALESCE(a.course_name, '') = COALESCE(b.course_name, ''))
      )
    RETURNING a.id, a.title, a.assignment_id, a.course_name;
  `;
  console.log(`✓ Deleted ${deletedGeneralDupes.length} duplicate task rows:`, deletedGeneralDupes);

  // 5. Delete ghost courses (e.g. MAIN / Main Channels)
  const deletedGhostCourses = await sql`
    DELETE FROM courses
    WHERE (code = 'MAIN' OR name ILIKE '%main channels%' OR name ILIKE '%teams and channels%')
      AND NOT EXISTS (SELECT 1 FROM tasks WHERE course_id = courses.id)
    RETURNING id, code, name;
  `;
  console.log(`✓ Deleted ${deletedGhostCourses.length} ghost course(s):`, deletedGhostCourses);

  // 6. Ensure strict UNIQUE constraint on (user_id, assignment_id)
  // Drop constraint / index if previously created to ensure clean state
  try {
    await sql`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_user_assignment_unique;`;
    await sql`DROP INDEX IF EXISTS tasks_user_assignment_unique;`;
  } catch (e) {
    console.log("Constraint drop notice:", e.message);
  }

  // Create unique index / constraint for ON CONFLICT (user_id, assignment_id)
  await sql`
    ALTER TABLE tasks 
    ADD CONSTRAINT tasks_user_assignment_unique UNIQUE (user_id, assignment_id);
  `;
  console.log("✓ Added UNIQUE (user_id, assignment_id) constraint to tasks table.");

  // 7. Verify final counts
  const finalTasks = await sql`
    SELECT id, title, assignment_id, course_name, is_completed, due_date
    FROM tasks
    ORDER BY due_date ASC;
  `;
  console.log(`\nFinal tasks count: ${finalTasks.length}`);
  finalTasks.forEach((t, idx) => {
    console.log(`  ${idx + 1}. [${t.assignment_id ? t.assignment_id.slice(0, 8) + '...' : 'NULL'}] "${t.title}" | ${t.course_name || 'No Course'}`);
  });

  const finalCourses = await sql`
    SELECT c.id, c.code, c.name, count(t.id) as task_count
    FROM courses c
    LEFT JOIN tasks t ON t.course_id = c.id
    GROUP BY c.id, c.code, c.name
    ORDER BY count(t.id) DESC;
  `;
  console.log(`\nRemaining courses (${finalCourses.length}):`);
  finalCourses.forEach(c => {
    console.log(`  - [${c.code}] ${c.name} (Tasks: ${c.task_count})`);
  });
}

run().catch(console.error);
