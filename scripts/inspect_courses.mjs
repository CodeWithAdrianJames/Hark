import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const courses = await sql`
    SELECT c.id, c.user_id, c.code, c.name, c.channel_id, COUNT(t.id) as task_count
    FROM courses c
    LEFT JOIN tasks t ON t.course_id = c.id
    GROUP BY c.id, c.user_id, c.code, c.name, c.channel_id
    ORDER BY c.name ASC;
  `;
  console.log('=== COURSES IN NEON DB ===');
  console.table(courses);
}

main().catch(console.error);
