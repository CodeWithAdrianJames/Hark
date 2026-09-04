/**
 * Automated Test Harness for Sprint 1 & Sprint 2:
 * 1. Seeds the test user into Neon PostgreSQL.
 * 2. Simulates an MS Teams announcement payload from content.js.
 * 3. Sends POST request to /api/ingest.
 * 4. Queries and prints the persisted task and course from Neon database.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Read DATABASE_URL from .env.local
const envLocalPath = path.join(rootDir, '.env.local');
if (!fs.existsSync(envLocalPath)) {
  console.error('❌ .env.local file not found at:', envLocalPath);
  process.exit(1);
}

const envContent = fs.readFileSync(envLocalPath, 'utf-8');
const dbMatch = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)/);
if (!dbMatch) {
  console.error('❌ DATABASE_URL not found in .env.local');
  process.exit(1);
}

const databaseUrl = dbMatch[1];
const sql = neon(databaseUrl);

const TEST_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TEST_API_URL = 'http://localhost:3000/api/ingest';

async function runTestHarness() {
  console.log('\n======================================================');
  console.log('🚀 HARK SPRINT 1 & 2 AUTOMATED TEST HARNESS');
  console.log('======================================================\n');

  // Step 1: Ensure Test User Exists in Neon
  console.log('📦 Step 1: Ensuring test user exists in Neon PostgreSQL...');
  try {
    await sql`
      INSERT INTO users (id, email)
      VALUES (${TEST_USER_ID}::uuid, 'prof_santos_student@university.edu')
      ON CONFLICT (id) DO NOTHING;
    `;
    const [user] = await sql`SELECT id, email, created_at FROM users WHERE id = ${TEST_USER_ID}::uuid`;
    console.log('✅ Test User confirmed:');
    console.table([user]);
  } catch (err) {
    console.error('❌ Failed to seed user into Neon:', err);
    process.exit(1);
  }

  // Step 2: Build Simulation Payload
  console.log('\n📨 Step 2: Preparing MS Teams simulated announcement payload...');
  const testPayload = {
    userId: TEST_USER_ID,
    channelName: 'CS311 - Advanced Systems',
    timezone: 'Asia/Manila',
    messages: [
      {
        id: 'test_msg_' + Date.now(), // Unique ID so each test run processes as a new message
        text: "Good day everyone, please don't forget to submit your System Architecture Diagram and ERD by this Sunday at 11:59 PM to our shared drive link.",
        sender: 'Prof. Santos',
        timestamp: new Date().toISOString(),
        url: 'https://teams.microsoft.com/l/message/test',
      },
    ],
  };

  console.log('Payload Message Content:');
  console.log(`"${testPayload.messages[0].text}"`);

  // Step 3: Dispatch to /api/ingest
  console.log(`\n🌐 Step 3: Dispatching POST request to ${TEST_API_URL}...`);
  let apiResponse;
  let responseData;
  try {
    const startTime = Date.now();
    apiResponse = await fetch(TEST_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload),
    });
    const duration = Date.now() - startTime;

    console.log(`HTTP Status: ${apiResponse.status} ${apiResponse.statusText} (${duration}ms)`);
    console.log('CORS Header Access-Control-Allow-Origin:', apiResponse.headers.get('Access-Control-Allow-Origin'));

    responseData = await apiResponse.json();
    console.log('\nAPI Response Data (Newly Created Tasks):');
    console.dir(responseData, { depth: null, colors: true });

    if (!apiResponse.ok) {
      throw new Error(`API returned error: ${JSON.stringify(responseData)}`);
    }

    if (!Array.isArray(responseData) || responseData.length === 0) {
      console.warn('⚠️ Warning: No tasks were returned. Gemini may not have flagged the message as an assignment.');
    } else {
      console.log(`\n🎉 Gemini Extraction Succeeded! Created ${responseData.length} task(s).`);
    }
  } catch (err) {
    console.error('❌ API Dispatch failed:', err);
    process.exit(1);
  }

  // Step 4: Verify directly in Neon Database
  console.log('\n🔍 Step 4: Verifying database state directly in Neon PostgreSQL...');
  try {
    const tasks = await sql`
      SELECT id, course_id, title, description, due_date, source_type, raw_message_hash, status, created_at
      FROM tasks
      WHERE user_id = ${TEST_USER_ID}::uuid
      ORDER BY created_at DESC
      LIMIT 1;
    `;

    if (tasks.length === 0) {
      console.error('❌ Verification failed: No task found in Neon for user', TEST_USER_ID);
      process.exit(1);
    }

    console.log('\n✅ Latest Record in "tasks" Table:');
    console.table(tasks);

    // Also check associated courses
    const courses = await sql`
      SELECT id, code, name, channel_id, created_at
      FROM courses
      WHERE user_id = ${TEST_USER_ID}::uuid;
    `;
    console.log('✅ Associated Courses:');
    console.table(courses);

    console.log('\n======================================================');
    console.log('🏆 ALL CHECKS PASSED: SPRINT 1 & 2 PIPELINE VERIFIED!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Database verification query failed:', err);
    process.exit(1);
  }
}

runTestHarness();
