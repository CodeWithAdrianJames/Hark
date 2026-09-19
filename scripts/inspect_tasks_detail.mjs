import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const tasks = await sql`
    SELECT 
      t.id,
      t.assignment_id,
      t.class_id,
      t.title,
      t.course_name,
      c.code as course_code,
      t.due_date,
      t.deep_link,
      t.source_url,
      t.status,
      t.is_completed,
      t.raw_message_hash
    FROM tasks t
    LEFT JOIN courses c ON t.course_id = c.id
    ORDER BY t.due_date ASC, t.id ASC;
  `;
  console.log(`Total tasks: ${tasks.length}`);
  console.table(tasks);
}

main().catch(console.error);
