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

async function testDeepLinkPreservation() {
  console.log('Testing Teams Deep Link Extraction, Validation, and Upsert Preservation...\n');

  const testTitle = `DeepLink Verification Project (${Date.now()})`;
  const specificDeepLink =
    'https://teams.microsoft.com/l/message/19:test_channel_123@thread.tacv2/1725510293041?tenantId=a0000000-0000-0000-0000-000000000001&groupId=b0000000-0000-0000-0000-000000000002';
  const genericFallbackUrl = 'https://teams.microsoft.com/v2/';
  const updatedDeepLink =
    'https://teams.microsoft.com/l/assignment/assignment_999/classroom?context=subEntityId_123';

  // 1. Initial Ingestion with Specific Deep Link
  console.log('--- Step 1: Ingest Task with Specific Deep Link ---');
  const res1 = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: TEST_USER_ID,
      channelName: 'CS499 - Capstone Systems',
      timezone: 'Asia/Manila',
      messages: [
        {
          id: `card_initial_${Date.now()}`,
          isNativeCard: true,
          title: testTitle,
          rawDueString: 'Due Sep 25 at 11:59 PM',
          url: specificDeepLink,
          sender: 'Assignments Bot',
        },
      ],
    }),
  });

  const data1 = await res1.json();
  console.log(`Step 1 Status: ${res1.status}, Inserted: ${data1.inserted}`);
  if (res1.status !== 200 || !data1.success || data1.inserted !== 1) {
    throw new Error(`Step 1 Failed: ${JSON.stringify(data1)}`);
  }

  // Verify in Neon DB
  const [dbRow1] = await sql`SELECT source_url, raw_message_hash FROM tasks WHERE title = ${testTitle} AND user_id = ${TEST_USER_ID}::uuid`;
  console.log('DB source_url after Step 1:', dbRow1.source_url);
  if (dbRow1.source_url !== specificDeepLink) {
    throw new Error(`Expected DB source_url to match specificDeepLink, got: ${dbRow1.source_url}`);
  }
  console.log('✅ Step 1 Verified: Specific deep link stored correctly.\n');

  // 2. Re-scan with Generic Fallback URL (Should NOT overwrite specific link!)
  console.log('--- Step 2: Re-scan / Upsert with Generic Fallback URL ---');
  const res2 = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: TEST_USER_ID,
      channelName: 'CS499 - Capstone Systems',
      timezone: 'Asia/Manila',
      messages: [
        {
          id: `card_rescan_${Date.now()}`,
          isNativeCard: true,
          title: testTitle,
          rawDueString: 'Due Sep 25 at 11:59 PM',
          url: genericFallbackUrl, // Bare /v2/ root
          sender: 'Assignments Bot',
        },
      ],
    }),
  });

  const data2 = await res2.json();
  console.log(`Step 2 Status: ${res2.status}, Updated: ${data2.updated}`);
  if (res2.status !== 200 || !data2.success || data2.updated !== 1) {
    throw new Error(`Step 2 Failed: ${JSON.stringify(data2)}`);
  }

  // Verify in Neon DB that specificDeepLink was PRESERVED
  const [dbRow2] = await sql`SELECT source_url FROM tasks WHERE title = ${testTitle} AND user_id = ${TEST_USER_ID}::uuid`;
  console.log('DB source_url after Step 2:', dbRow2.source_url);
  if (dbRow2.source_url !== specificDeepLink) {
    throw new Error(`FAILURE: Specific deep link was overwritten by generic fallback! Got: ${dbRow2.source_url}`);
  }
  console.log('✅ Step 2 Verified: Specific deep link was NOT overwritten by generic fallback URL.\n');

  // 3. Re-scan with a Newer Specific Deep Link (Should update!)
  console.log('--- Step 3: Re-scan with New Valid Deep Link ---');
  const res3 = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: TEST_USER_ID,
      channelName: 'CS499 - Capstone Systems',
      timezone: 'Asia/Manila',
      messages: [
        {
          id: `card_updated_${Date.now()}`,
          isNativeCard: true,
          title: testTitle,
          rawDueString: 'Due Sep 25 at 11:59 PM',
          url: updatedDeepLink,
          sender: 'Assignments Bot',
        },
      ],
    }),
  });

  const data3 = await res3.json();
  console.log(`Step 3 Status: ${res3.status}, Updated: ${data3.updated}`);
  if (res3.status !== 200 || !data3.success || data3.updated !== 1) {
    throw new Error(`Step 3 Failed: ${JSON.stringify(data3)}`);
  }

  // Verify in Neon DB that updatedDeepLink was APPLIED
  const [dbRow3] = await sql`SELECT source_url FROM tasks WHERE title = ${testTitle} AND user_id = ${TEST_USER_ID}::uuid`;
  console.log('DB source_url after Step 3:', dbRow3.source_url);
  if (dbRow3.source_url !== updatedDeepLink) {
    throw new Error(`FAILURE: Specific deep link was not updated to new valid deep link! Got: ${dbRow3.source_url}`);
  }
  console.log('✅ Step 3 Verified: New valid deep link successfully replaced old deep link.\n');

  // 4. Cleanup
  console.log('--- Step 4: Cleanup ---');
  await sql`DELETE FROM tasks WHERE title = ${testTitle} AND user_id = ${TEST_USER_ID}::uuid`;
  console.log('✅ Test task cleaned up from database.');

  console.log('\n🎉 ALL DEEP LINK VALIDATION & PRESERVATION TESTS PASSED!');
}

testDeepLinkPreservation().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
