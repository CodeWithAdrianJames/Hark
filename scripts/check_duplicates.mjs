import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const dupesByTitle = await sql`
    SELECT user_id, title, COUNT(*) as count, array_agg(id) as ids, array_agg(assignment_id) as assign_ids
    FROM tasks
    GROUP BY user_id, title
    HAVING COUNT(*) > 1;
  `;
  console.log('Duplicate by user_id & title:', dupesByTitle);

  const dupesByAssignId = await sql`
    SELECT user_id, assignment_id, COUNT(*) as count, array_agg(id) as ids
    FROM tasks
    WHERE assignment_id IS NOT NULL
    GROUP BY user_id, assignment_id
    HAVING COUNT(*) > 1;
  `;
  console.log('Duplicate by user_id & assignment_id:', dupesByAssignId);

  const dupesByHash = await sql`
    SELECT raw_message_hash, COUNT(*) as count, array_agg(id) as ids
    FROM tasks
    WHERE raw_message_hash IS NOT NULL
    GROUP BY raw_message_hash
    HAVING COUNT(*) > 1;
  `;
  console.log('Duplicate by raw_message_hash:', dupesByHash);
}

main().catch(console.error);
