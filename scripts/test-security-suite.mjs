import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from .env.local
const envContent = fs.readFileSync(path.join(rootDir, '.env.local'), 'utf-8');
envContent.split(/\r?\n/).forEach(line => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2].trim();
  }
});

const sql = neon(process.env.DATABASE_URL);
const BASE_URL = 'http://localhost:3000';
const VALID_KEY = process.env.INGEST_API_KEY;

async function runSecuritySuite() {
  console.log('🔒 Running Hark Security & Tenant Boundary Verification Suite against HTTP server...\n');

  const USER_A = '33333333-3333-4333-a333-333333333333';
  const USER_B = '44444444-4444-4444-a444-444444444444';

  // Seed test users & tasks
  await sql`
    INSERT INTO users (id, email) VALUES 
      (${USER_A}::uuid, 'victim_a@test.edu'),
      (${USER_B}::uuid, 'attacker_b@test.edu')
    ON CONFLICT (id) DO NOTHING;
  `;

  const [testTask] = await sql`
    INSERT INTO tasks (
      user_id, title, due_date, source_type, raw_message_hash, status, is_completed
    ) VALUES (
      ${USER_A}::uuid, 'Sensitive Deliverable User A', NOW() + interval '5 days',
      'official_assignment', 'sec_test_hash_' || NOW(), 'pending', false
    )
    RETURNING id, user_id, title, status, is_completed;
  `;

  console.log(`Seeded test task ${testTask.id} owned by User A (${USER_A})\n`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Unauthenticated POST /api/ingest?reset=true (Must return 401)
    // -------------------------------------------------------------------------
    console.log('--- Test 1: POST /api/ingest?reset=true without Bearer token (Must return 401) ---');
    const res1 = await fetch(`${BASE_URL}/api/ingest?reset=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_A, assignments: [] }),
    });

    const body1 = await res1.json();
    console.log(`Status: ${res1.status}, Body:`, body1);

    if (res1.status !== 401) {
      throw new Error(`Test 1 Failed: Expected status 401, got ${res1.status}`);
    }
    console.log('✅ Test 1 Passed: Unauthenticated request rejected with 401 Unauthorized.\n');

    // -------------------------------------------------------------------------
    // TEST 2: POST /api/ingest with Invalid Bearer token (Must return 401)
    // -------------------------------------------------------------------------
    console.log('--- Test 2: POST /api/ingest with Invalid Bearer Token (Must return 401) ---');
    const res2 = await fetch(`${BASE_URL}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer wrong_malicious_key',
      },
      body: JSON.stringify({ userId: USER_A, assignments: [] }),
    });

    const body2 = await res2.json();
    console.log(`Status: ${res2.status}, Body:`, body2);

    if (res2.status !== 401) {
      throw new Error(`Test 2 Failed: Expected status 401, got ${res2.status}`);
    }
    console.log('✅ Test 2 Passed: Invalid Bearer token rejected with 401 Unauthorized.\n');

    // -------------------------------------------------------------------------
    // TEST 3: Verify ?reset=true no longer wipes tasks even if authenticated
    // -------------------------------------------------------------------------
    console.log('--- Test 3: Authenticated POST /api/ingest?reset=true (Wipe logic removed) ---');
    const res3 = await fetch(`${BASE_URL}/api/ingest?reset=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VALID_KEY}`,
      },
      body: JSON.stringify({
        userId: USER_A,
        assignments: [
          {
            assignmentId: '55555555-5555-4555-a555-555555555555',
            title: 'New Authenticated Ingest Task',
            rawDueString: 'Sep 30 11:59 PM',
            courseName: 'CS101',
          },
        ],
      }),
    });

    const body3 = await res3.json();
    console.log(`Status: ${res3.status}, Body:`, body3);

    if (res3.status !== 200 || !body3.success) {
      throw new Error(`Test 3 Failed: Expected status 200, got ${res3.status}`);
    }

    // Verify task seeded in setup was NOT wiped out by ?reset=true
    const [persistedTask] = await sql`SELECT id FROM tasks WHERE id = ${testTask.id}::uuid`;
    if (!persistedTask) {
      throw new Error('Test 3 Failed: Task was wiped by ?reset=true! Dangerous wipe logic still active!');
    }
    console.log('✅ Test 3 Passed: Authenticated ingest succeeded and ?reset=true did NOT wipe existing tasks.\n');

    // -------------------------------------------------------------------------
    // TEST 4: PATCH /api/tasks and /api/tasks/status missing userId (Must return 400)
    // -------------------------------------------------------------------------
    console.log('--- Test 4: Status update missing userId (Must return 400 Bad Request) ---');
    const res4 = await fetch(`${BASE_URL}/api/tasks/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: testTask.id, completed: true }), // Missing userId
    });

    const body4 = await res4.json();
    console.log(`Status: ${res4.status}, Body:`, body4);

    if (res4.status !== 400) {
      throw new Error(`Test 4 Failed: Expected status 400, got ${res4.status}`);
    }
    console.log('✅ Test 4 Passed: Missing userId rejected with 400 Bad Request.\n');

    // -------------------------------------------------------------------------
    // TEST 5: IDOR Attack: User B attempts to complete User A task (Must return 404)
    // -------------------------------------------------------------------------
    console.log('--- Test 5: IDOR Prevention: User B attempts to mutate User A task (Must return 404) ---');
    const res5 = await fetch(`${BASE_URL}/api/tasks/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: testTask.id,
        userId: USER_B, // Mismatched attacker userId
        completed: true,
      }),
    });

    const body5 = await res5.json();
    console.log(`Status: ${res5.status}, Body:`, body5);

    if (res5.status !== 404) {
      throw new Error(`Test 5 Failed: Expected status 404, got ${res5.status}`);
    }

    // Verify task state in database remains unmodified
    const [unmodifiedTask] = await sql`
      SELECT is_completed, status FROM tasks WHERE id = ${testTask.id}::uuid
    `;
    if (unmodifiedTask.is_completed === true || unmodifiedTask.status === 'completed') {
      throw new Error('Test 5 Failed: Record was mutated by unauthorized user!');
    }
    console.log('✅ Test 5 Passed: Cross-tenant IDOR attempt blocked. Returned 404 with record untouched.\n');

    // -------------------------------------------------------------------------
    // TEST 6: Legitimate Status Mutation with matched userId (Must return 200)
    // -------------------------------------------------------------------------
    console.log('--- Test 6: Legitimate Owner Status Mutation (Must return 200) ---');
    const res6 = await fetch(`${BASE_URL}/api/tasks/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: testTask.id,
        userId: USER_A, // Legitimate owner
        completed: true,
      }),
    });

    const body6 = await res6.json();
    console.log(`Status: ${res6.status}, Updated Task:`, body6.task);

    if (res6.status !== 200 || body6.task.is_completed !== true) {
      throw new Error(`Test 6 Failed: Expected status 200, got ${res6.status}`);
    }
    console.log('✅ Test 6 Passed: Legitimate owner successfully mutated task state.\n');

    // -------------------------------------------------------------------------
    // TEST 7: Preflight OPTIONS on /api/ingest returns restricted CORS headers
    // -------------------------------------------------------------------------
    console.log('--- Test 7: Preflight OPTIONS with Chrome Extension Origin ---');
    const extOrigin = `chrome-extension://${process.env.NEXT_PUBLIC_HARK_EXTENSION_ID}`;
    const res7 = await fetch(`${BASE_URL}/api/ingest`, {
      method: 'OPTIONS',
      headers: {
        'Origin': extOrigin,
      },
    });

    const allowOriginHeader = res7.headers.get('Access-Control-Allow-Origin');
    console.log(`Status: ${res7.status}, Access-Control-Allow-Origin: ${allowOriginHeader}`);

    if (res7.status !== 204 || allowOriginHeader !== extOrigin) {
      throw new Error(`Test 7 Failed: Expected allowOrigin ${extOrigin}, got ${allowOriginHeader}`);
    }
    console.log('✅ Test 7 Passed: Preflight returns strictly allowed extension origin, not wildcard *.\n');

  } finally {
    // Cleanup
    await sql`DELETE FROM tasks WHERE user_id IN (${USER_A}::uuid, ${USER_B}::uuid);`;
    await sql`DELETE FROM courses WHERE user_id IN (${USER_A}::uuid, ${USER_B}::uuid);`;
    await sql`DELETE FROM users WHERE id IN (${USER_A}::uuid, ${USER_B}::uuid);`;
    console.log('🧹 Cleaned up temporary test records from Neon database.');
  }

  console.log('\n🎉 ALL SECURITY SUITE TESTS PASSED WITH 100% SUCCESS!');
}

runSecuritySuite().catch((err) => {
  console.error('\n❌ Security suite failed:', err);
  process.exit(1);
});
