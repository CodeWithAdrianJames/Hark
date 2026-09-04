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
const TEST_API_URL = 'http://localhost:3000/api/ingest';

async function testFastPath() {
  console.log('Testing Fast-Path Bypass for Native MS Teams Assignment Cards...');

  const uniqueSuffix = Date.now();
  const payload = {
    userId: TEST_USER_ID,
    channelName: 'CS311 - Advanced Systems',
    timezone: 'Asia/Manila',
    messages: [
      // 1. Native Assignment Card (Should take < 50ms, bypass heavy Gemini prompt)
      {
        id: `native_card_${uniqueSuffix}`,
        isNativeCard: true,
        title: `Machine Problem 3: Distributed Hash Table (${uniqueSuffix})`,
        rawDueString: 'Due Sep 12 at 11:59 PM',
        url: 'https://teams.microsoft.com/l/assignment/test',
        sender: 'Assignments Bot',
      },
      // 2. Pure noise message (Should be filtered out immediately without API call)
      {
        id: `noise_msg_${uniqueSuffix}`,
        text: 'Thank you po sir!',
        sender: 'Student Bob',
        timestamp: new Date().toISOString(),
      },
      // 3. Short message (Under 15 chars, should be filtered)
      {
        id: `short_msg_${uniqueSuffix}`,
        text: 'Okay noted.',
        sender: 'Student Alice',
        timestamp: new Date().toISOString(),
      }
    ],
  };

  const start = Date.now();
  const res = await fetch(TEST_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const elapsed = Date.now() - start;

  console.log(`Response HTTP ${res.status} in ${elapsed}ms`);
  const data = await res.json();
  console.log('Result data:', data);

  if (res.ok && Array.isArray(data) && data.length === 1) {
    const task = data[0];
    console.log(`✅ Success! Exactly 1 task created via fast-path bypass in ${elapsed}ms.`);
    console.log(`Title: "${task.title}"`);
    console.log(`Due Date: ${task.due_date}`);
    console.log(`Source Type: ${task.source_type}`);
    if (task.source_type === 'official_assignment') {
      console.log('✅ Task source_type correctly set to official_assignment!');
    } else {
      console.error('❌ Expected source_type official_assignment, got:', task.source_type);
    }
  } else {
    console.error('❌ Fast-path test failed or unexpected task count:', data);
  }
}

testFastPath().catch(console.error);
