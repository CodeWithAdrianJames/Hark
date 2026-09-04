import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const envContent = fs.readFileSync(path.join(rootDir, '.env.local'), 'utf-8');
const dbMatch = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)/);
const sql = neon(dbMatch[1]);

const TEST_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const API_URL = 'http://localhost:3000/api/ingest';

async function runTest() {
  console.log('Testing End-to-End Ingestion Upsert & Duplicate Resilience...\n');

  const testTitle = `Final Project Milestone (${Date.now()})`;
  const cardPayload = {
    userId: TEST_USER_ID,
    channelName: 'CS412 - Cloud Architecture',
    timezone: 'Asia/Manila',
    messages: [
      {
        id: `card_dom_id_${Date.now()}`,
        isNativeCard: true,
        title: testTitle,
        rawDueString: 'Due Sep 18 at 11:59 PM',
        url: 'https://teams.microsoft.com/l/assignment/test-upsert',
        sender: 'Assignments Bot',
      },
    ],
  };

  // Test 1: Initial Ingestion
  console.log('--- Test 1: First Scan (Should Insert) ---');
  const res1 = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cardPayload),
  });

  const data1 = await res1.json();
  console.log(`Status: ${res1.status}, Body:`, data1);

  if (res1.status !== 200 || !data1.success || data1.inserted !== 1) {
    throw new Error(`Test 1 Failed: Expected status 200 and inserted: 1, got status ${res1.status} and ${JSON.stringify(data1)}`);
  }
  console.log('✅ Test 1 Passed: Row successfully inserted.\n');

  // Test 2: Re-scan / "Force Scan Current Channel" (Duplicate raw_message_hash)
  console.log('--- Test 2: Force Scan / Re-scan Same Assignment (Should Update, NOT 500) ---');
  // Mutate the raw due string or DOM ID (simulating page reload)
  const rescanPayload = {
    userId: TEST_USER_ID,
    channelName: 'CS412 - Cloud Architecture',
    timezone: 'Asia/Manila',
    messages: [
      {
        id: `card_dom_id_reloaded_${Date.now()}`,
        isNativeCard: true,
        title: testTitle,
        rawDueString: 'Due Sep 18 at 11:59 PM',
        url: 'https://teams.microsoft.com/l/assignment/test-upsert',
        sender: 'Assignments Bot',
      },
    ],
  };

  const res2 = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rescanPayload),
  });

  const data2 = await res2.json();
  console.log(`Status: ${res2.status}, Body:`, data2);

  if (res2.status !== 200 || !data2.success || data2.updated !== 1) {
    throw new Error(`Test 2 Failed: Expected status 200 and updated: 1 (NO 500 error), got status ${res2.status} and ${JSON.stringify(data2)}`);
  }
  console.log('✅ Test 2 Passed: Row idempotently updated with zero errors.\n');

  // Test 3: Batch with Duplicate Items in the Same Request
  console.log('--- Test 3: Batch Containing Duplicate Items in Same Payload ---');
  const batchPayload = {
    userId: TEST_USER_ID,
    channelName: 'CS412 - Cloud Architecture',
    timezone: 'Asia/Manila',
    messages: [
      {
        id: 'dup_item_1',
        isNativeCard: true,
        title: testTitle,
        rawDueString: 'Due Sep 18 at 11:59 PM',
        url: 'https://teams.microsoft.com/l/assignment/test-upsert',
        sender: 'Assignments Bot',
      },
      {
        id: 'dup_item_2',
        isNativeCard: true,
        title: testTitle,
        rawDueString: 'Due Sep 18 at 11:59 PM',
        url: 'https://teams.microsoft.com/l/assignment/test-upsert',
        sender: 'Assignments Bot',
      },
    ],
  };

  const res3 = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batchPayload),
  });

  const data3 = await res3.json();
  console.log(`Status: ${res3.status}, Body:`, data3);

  if (res3.status !== 200 || !data3.success) {
    throw new Error(`Test 3 Failed: Expected status 200, got status ${res3.status} and ${JSON.stringify(data3)}`);
  }
  console.log('✅ Test 3 Passed: Batch deduplication prevented concurrent unique constraint violation.\n');

  // Cleanup test row from database
  console.log('--- Cleanup ---');
  await sql`DELETE FROM tasks WHERE title = ${testTitle} AND user_id = ${TEST_USER_ID}::uuid`;
  console.log('✅ Cleaned up test task from database.');
  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

runTest().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
