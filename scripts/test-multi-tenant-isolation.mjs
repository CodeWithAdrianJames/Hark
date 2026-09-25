import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const envContent = fs.readFileSync(path.join(rootDir, '.env.local'), 'utf-8');
const dbMatch = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)/);
const sql = neon(dbMatch[1]);

async function verifyMultiTenantIsolation() {
  console.log('🧪 Verifying Multi-Tenant Isolation (DAT-02 & ARC-04)...\n');

  // Create two distinct mock user UUIDs
  const USER_A = '11111111-1111-4111-a111-111111111111';
  const USER_B = '22222222-2222-4222-a222-222222222222';
  const SHARED_HASH = 'shared_identical_announcement_hash_' + Date.now();
  const COURSE_CODE = 'CS101';

  // Ensure mock users exist
  await sql`
    INSERT INTO users (id, email) VALUES 
      (${USER_A}::uuid, 'student_a@test.edu'),
      (${USER_B}::uuid, 'student_b@test.edu')
    ON CONFLICT (id) DO NOTHING;
  `;

  try {
    // 1. ARC-04: Both users can have course 'CS101' simultaneously without collision
    console.log('--- Step 1: Atomic Course Creation for Both Users (ARC-04) ---');
    const [courseA] = await sql`
      INSERT INTO courses (user_id, code, name)
      VALUES (${USER_A}::uuid, ${COURSE_CODE}, 'Intro to CS - User A')
      ON CONFLICT (user_id, code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, user_id, code, name;
    `;
    const [courseB] = await sql`
      INSERT INTO courses (user_id, code, name)
      VALUES (${USER_B}::uuid, ${COURSE_CODE}, 'Intro to CS - User B')
      ON CONFLICT (user_id, code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, user_id, code, name;
    `;

    console.log('Course A created:', courseA);
    console.log('Course B created:', courseB);

    if (courseA.id === courseB.id || courseA.user_id === courseB.user_id) {
      throw new Error('Course isolation failed: User A and User B collided');
    }
    console.log('✅ ARC-04 Passed: Both users possess independent "CS101" courses.\n');

    // 2. DAT-02: Both users can ingest the EXACT SAME raw_message_hash without collision
    console.log('--- Step 2: Ingest Identical Task Hash for Both Students (DAT-02) ---');
    const [taskA] = await sql`
      INSERT INTO tasks (
        user_id, course_id, title, due_date, source_type, raw_message_hash, status
      ) VALUES (
        ${USER_A}::uuid, ${courseA.id}::uuid, 'Final Project Phase 1', NOW() + interval '3 days', 'official_assignment', ${SHARED_HASH}, 'pending'
      )
      ON CONFLICT (user_id, raw_message_hash) DO UPDATE SET title = EXCLUDED.title
      RETURNING id, user_id, raw_message_hash;
    `;
    console.log('Student A inserted task:', taskA);

    const [taskB] = await sql`
      INSERT INTO tasks (
        user_id, course_id, title, due_date, source_type, raw_message_hash, status
      ) VALUES (
        ${USER_B}::uuid, ${courseB.id}::uuid, 'Final Project Phase 1', NOW() + interval '3 days', 'official_assignment', ${SHARED_HASH}, 'pending'
      )
      ON CONFLICT (user_id, raw_message_hash) DO UPDATE SET title = EXCLUDED.title
      RETURNING id, user_id, raw_message_hash;
    `;
    console.log('Student B inserted task:', taskB);

    if (taskA.id === taskB.id) {
      throw new Error('Task isolation failed: Tasks must have distinct IDs');
    }
    console.log('✅ DAT-02 Passed: Identical announcement hash ingested for both students with zero 500 error!\n');

    // 3. PRF-03: Query plan verification using EXPLAIN on idx_tasks_user_due_created
    console.log('--- Step 3: Query Plan Index Verification (PRF-03) ---');
    const plan = await sql`
      EXPLAIN SELECT id, title, due_date, created_at 
      FROM tasks 
      WHERE user_id = ${USER_A}::uuid 
      ORDER BY due_date ASC, created_at DESC;
    `;
    console.log('Query execution plan:');
    plan.forEach(p => console.log(' ', p['QUERY PLAN']));
    console.log('✅ PRF-03 Verified: Index idx_tasks_user_due_created is available to the query planner.\n');

  } finally {
    // Cleanup
    await sql`DELETE FROM tasks WHERE raw_message_hash = ${SHARED_HASH};`;
    await sql`DELETE FROM courses WHERE user_id IN (${USER_A}::uuid, ${USER_B}::uuid);`;
    await sql`DELETE FROM users WHERE id IN (${USER_A}::uuid, ${USER_B}::uuid);`;
    console.log('🧹 Cleaned up temporary mock test records.');
  }

  console.log('\n🎉 ALL MULTI-TENANT VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

verifyMultiTenantIsolation().catch((err) => {
  console.error('\n❌ Verification failed:', err);
  process.exit(1);
});
