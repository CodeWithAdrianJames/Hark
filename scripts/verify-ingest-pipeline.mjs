import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';

// Read env variables
const envContent = fs.readFileSync('.env.local', 'utf-8');
const dbMatch = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)/);
const apiKeyMatch = envContent.match(/INGEST_API_KEY=["']?([^"'\r\n]+)/);

if (!dbMatch || !apiKeyMatch) {
  console.error('DATABASE_URL or INGEST_API_KEY not found in .env.local');
  process.exit(1);
}

const DATABASE_URL = dbMatch[1];
const INGEST_API_KEY = apiKeyMatch[1];
const API_URL = 'http://localhost:3000/api/ingest';
const sql = neon(DATABASE_URL);

const TEST_USER = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ASSIGNMENT_1 = 'a1b2c3d4-1111-4000-8000-000000000001';
const ASSIGNMENT_2 = 'a1b2c3d4-2222-4000-8000-000000000002';
const ASSIGNMENT_3 = 'a1b2c3d4-3333-4000-8000-000000000003';

async function runVerification() {
  console.log('====================================================');
  console.log('🚀 Running Ingestion Pipeline Full Verification');
  console.log('====================================================\n');

  try {
    // Clean up any leftovers from previous test runs
    await sql`
      DELETE FROM tasks 
      WHERE user_id = ${TEST_USER}::uuid 
        AND assignment_id IN (${ASSIGNMENT_1}, ${ASSIGNMENT_2}, ${ASSIGNMENT_3})
    `;

    // -------------------------------------------------------------------------
    // TEST 1: Override Preservation (DAT-01 Verification)
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: User Completion & Status Override Preservation ---');
    // 1a. Seed task marked is_completed = true in Neon DB
    await sql`
      INSERT INTO tasks (
        user_id, assignment_id, raw_message_hash, title, course_name, due_date, status, is_completed
      ) VALUES (
        ${TEST_USER}::uuid, ${ASSIGNMENT_1}, 'seed_hash_test_1', 'Original Assignment - Student Completed', 'CS101', NOW() + interval '3 days', 'completed', true
      );
    `;

    const [seeded] = await sql`
      SELECT id, title, is_completed, status 
      FROM tasks 
      WHERE user_id = ${TEST_USER}::uuid AND assignment_id = ${ASSIGNMENT_1}
    `;
    console.log('Seeded state in DB:', seeded);
    if (!seeded || seeded.is_completed !== true || seeded.status !== 'completed') {
      throw new Error('Failed to seed initial completed task.');
    }

    // 1b. Ingest an updated version of that assignment marked 'pending' from Teams
    console.log('Sending sync request with updated title and pending status...');
    const ingestRes = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${INGEST_API_KEY}`,
      },
      body: JSON.stringify({
        userId: TEST_USER,
        assignments: [
          {
            assignmentId: ASSIGNMENT_1,
            title: 'Updated Assignment Title From Teams Sync',
            courseName: 'CS101 - Computer Science',
            courseCode: 'CS101',
            rawDueString: 'Due tomorrow at 11:59 PM',
            deepLink: 'https://teams.microsoft.com/v2/assignments/view/1',
            status: 'pending', // Teams sees pending, but student marked complete!
          },
        ],
      }),
    });

    if (!ingestRes.ok) {
      const errText = await ingestRes.text();
      throw new Error(`Ingest request failed with ${ingestRes.status}: ${errText}`);
    }

    const ingestJson = await ingestRes.json();
    console.log('Ingest Response:', {
      success: ingestJson.success,
      count: ingestJson.count,
      inserted: ingestJson.inserted,
      updated: ingestJson.updated,
    });

    if (ingestJson.updated !== 1) {
      throw new Error(`Expected updated count to be 1, got ${ingestJson.updated}`);
    }

    // 1c. Inspect DB directly to verify is_completed and status were PRESERVED
    const [persisted] = await sql`
      SELECT id, title, course_name, is_completed, status, deep_link, updated_at
      FROM tasks 
      WHERE user_id = ${TEST_USER}::uuid AND assignment_id = ${ASSIGNMENT_1}
    `;
    console.log('Persisted state in DB after sync:', persisted);

    if (persisted.title !== 'Updated Assignment Title From Teams Sync') {
      throw new Error(`Title was not updated: expected "Updated Assignment Title From Teams Sync", got "${persisted.title}"`);
    }

    if (persisted.is_completed !== true) {
      throw new Error(`CLOBBER DETECTED! is_completed was overwritten to false!`);
    }

    if (persisted.status !== 'completed') {
      throw new Error(`CLOBBER DETECTED! status was overwritten to "${persisted.status}"!`);
    }

    console.log('✅ TEST 1 PASSED: Completed status and user override were 100% preserved!\n');

    // -------------------------------------------------------------------------
    // TEST 2: Multi-Row Batch Upsert (PRF-02 Verification)
    // -------------------------------------------------------------------------
    console.log('--- TEST 2: Multi-Row Batch Upsert Execution ---');
    const batchRes = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${INGEST_API_KEY}`,
      },
      body: JSON.stringify({
        userId: TEST_USER,
        assignments: [
          {
            assignmentId: ASSIGNMENT_2,
            title: 'Batch Task Alpha',
            courseName: 'MATH201',
            courseCode: 'MATH201',
            rawDueString: 'Due Friday at 5:00 PM',
          },
          {
            assignmentId: ASSIGNMENT_3,
            title: 'Batch Task Beta',
            courseName: 'PHYS101',
            courseCode: 'PHYS101',
            rawDueString: 'Due Monday at 11:59 PM',
          },
          // Also include existing ASSIGNMENT_1 to test simultaneous insert & update
          {
            assignmentId: ASSIGNMENT_1,
            title: 'Updated Assignment Title - Second Sync Pass',
            courseName: 'CS101',
            rawDueString: 'Due in 3 days',
          },
        ],
      }),
    });

    if (!batchRes.ok) {
      const errText = await batchRes.text();
      throw new Error(`Batch ingest failed with ${batchRes.status}: ${errText}`);
    }

    const batchJson = await batchRes.json();
    console.log('Batch Response:', {
      success: batchJson.success,
      inserted: batchJson.inserted,
      updated: batchJson.updated,
    });

    if (batchJson.inserted !== 2 || batchJson.updated !== 1) {
      throw new Error(`Expected 2 inserted and 1 updated, got inserted=${batchJson.inserted}, updated=${batchJson.updated}`);
    }

    console.log('✅ TEST 2 PASSED: Multi-row batch executed cleanly in a single transaction!\n');

    // -------------------------------------------------------------------------
    // TEST 3: State-Transfer Deduplication CTE (DAT-01 CTE Verification)
    // Merging unassociated older task (e.g. from chat announcement) into official assignment
    // -------------------------------------------------------------------------
    console.log('--- TEST 3: State-Transfer Deduplication CTE (Title Merging) ---');
    const DUP_ASSIGNMENT = 'a1b2c3d4-9999-4000-8000-000000000099';
    const SHARED_TITLE = 'Special Lab Report Final Submission';

    // 3a. Insert older unassociated task (assignment_id is NULL) marked completed
    const [olderRow] = await sql`
      INSERT INTO tasks (
        user_id, assignment_id, raw_message_hash, title, course_name, due_date, status, is_completed
      ) VALUES (
        ${TEST_USER}::uuid, NULL, 'chat_announcement_hash_99', ${SHARED_TITLE}, 'CS101', NOW() + interval '5 days', 'completed', true
      ) RETURNING id, assignment_id, is_completed, status;
    `;

    console.log(`Created older unassociated task: id=${olderRow.id}, assignment_id=${olderRow.assignment_id}, completed=${olderRow.is_completed}`);

    // 3b. Trigger sync of official assignment with matching title, but pending from Teams
    const dupRes = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${INGEST_API_KEY}`,
      },
      body: JSON.stringify({
        userId: TEST_USER,
        assignments: [
          {
            assignmentId: DUP_ASSIGNMENT,
            title: SHARED_TITLE,
            courseName: 'CS101',
            rawDueString: 'Due in 5 days',
          },
        ],
      }),
    });

    if (!dupRes.ok) {
      throw new Error(`Deduplication sync failed: ${await dupRes.text()}`);
    }

    // 3c. Inspect DB: older unassociated task should be deleted, and new official task should inherit is_completed=true
    const remainingRows = await sql`
      SELECT id, assignment_id, title, is_completed, status 
      FROM tasks 
      WHERE user_id = ${TEST_USER}::uuid AND title = ${SHARED_TITLE}
    `;

    console.log('Remaining row(s) after deduplication sync:', remainingRows);

    if (remainingRows.length !== 1) {
      throw new Error(`Expected exactly 1 remaining row for title "${SHARED_TITLE}", found ${remainingRows.length}`);
    }

    const surviving = remainingRows[0];
    if (surviving.assignment_id !== DUP_ASSIGNMENT) {
      throw new Error(`Surviving row does not have official assignment_id ${DUP_ASSIGNMENT}`);
    }

    if (surviving.is_completed !== true || surviving.status !== 'completed') {
      throw new Error(`CTE State-Transfer failed! Surviving row did not inherit is_completed=true or status='completed'`);
    }

    console.log('✅ TEST 3 PASSED: Older completion state was safely transferred to official assignment row before deduplication!\n');

    console.log('====================================================');
    console.log('🎉 ALL INGESTION PIPELINE VERIFICATIONS PASSED 100%!');
    console.log('====================================================');
  } finally {
    // Cleanup test records
    await sql`
      DELETE FROM tasks 
      WHERE user_id = ${TEST_USER}::uuid 
        AND assignment_id IN (${ASSIGNMENT_1}, ${ASSIGNMENT_2}, ${ASSIGNMENT_3}, 'a1b2c3d4-9999-4000-8000-000000000099')
    `;
    console.log('\nCleaned up all test artifacts.');
  }
}

runVerification().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
