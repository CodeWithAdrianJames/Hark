import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const constraints = await sql`
    SELECT conname, pg_get_constraintdef(c.oid) as def 
    FROM pg_constraint c 
    WHERE conrelid = 'tasks'::regclass;
  `;
  console.log('=== CONSTRAINTS ===');
  constraints.forEach(c => console.log(`${c.conname}: ${c.def}`));

  const indexes = await sql`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename = 'tasks';
  `;
  console.log('\n=== INDEXES ===');
  indexes.forEach(i => console.log(`${i.indexname}: ${i.indexdef}`));

  const tasks = await sql`
    SELECT id, title, assignment_id, course_name, due_date, status, is_completed, raw_message_hash, source_type, created_at
    FROM tasks
    ORDER BY due_date ASC;
  `;
  console.log(`\n=== TASKS (${tasks.length} total) ===`);
  tasks.forEach((t, i) => {
    console.log(`[${i}] ${t.title} | ID:${t.id} | AssignId:${t.assignment_id} | Due:${t.due_date} | Status:${t.status} | Done:${t.is_completed} | Hash:${t.raw_message_hash?.slice(0, 10)}`);
  });
}

main().catch(console.error);
