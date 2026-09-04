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

async function testPostgresUpsert() {
  console.log('Testing SQL Upsert directly on Neon PostgreSQL...');

  const testHash = 'test_hash_' + Date.now();
  const testTitle = 'Initial Test Task';
  const updatedTitle = 'Updated Test Task';
  const dueDate = new Date(Date.now() + 86400000).toISOString();

  // 1. Initial Insert
  console.log('\n--- Step 1: Initial Insert ---');
  const [row1] = await sql`
    INSERT INTO tasks (
      user_id,
      title,
      description,
      due_date,
      source_type,
      raw_message_hash,
      status
    ) VALUES (
      ${TEST_USER_ID}::uuid,
      ${testTitle},
      'Test description',
      ${dueDate}::timestamptz,
      'official_assignment',
      ${testHash},
      'pending'
    )
    ON CONFLICT (raw_message_hash)
    DO UPDATE SET
      title = EXCLUDED.title,
      due_date = EXCLUDED.due_date,
      description = COALESCE(EXCLUDED.description, tasks.description),
      updated_at = NOW()
    RETURNING *, (xmax = 0) AS is_inserted
  `;

  console.log('Row 1 (should be is_inserted: true):', {
    id: row1.id,
    title: row1.title,
    is_inserted: row1.is_inserted,
    updated_at: row1.updated_at,
  });

  if (row1.is_inserted !== true) {
    throw new Error(`Expected row1.is_inserted to be true, got ${row1.is_inserted}`);
  }

  // 2. Duplicate / Re-scan Insert (Should DO UPDATE, NOT throw 500 error!)
  console.log('\n--- Step 2: Duplicate / Re-scan with updated title ---');
  const [row2] = await sql`
    INSERT INTO tasks (
      user_id,
      title,
      description,
      due_date,
      source_type,
      raw_message_hash,
      status
    ) VALUES (
      ${TEST_USER_ID}::uuid,
      ${updatedTitle},
      'Updated description',
      ${dueDate}::timestamptz,
      'official_assignment',
      ${testHash},
      'pending'
    )
    ON CONFLICT (raw_message_hash)
    DO UPDATE SET
      title = EXCLUDED.title,
      due_date = EXCLUDED.due_date,
      description = COALESCE(EXCLUDED.description, tasks.description),
      updated_at = NOW()
    RETURNING *, (xmax = 0) AS is_inserted
  `;

  console.log('Row 2 (should be is_inserted: false, title updated):', {
    id: row2.id,
    title: row2.title,
    is_inserted: row2.is_inserted,
    updated_at: row2.updated_at,
  });

  if (row2.is_inserted !== false) {
    throw new Error(`Expected row2.is_inserted to be false, got ${row2.is_inserted}`);
  }

  if (row2.title !== updatedTitle) {
    throw new Error(`Expected title to be updated to "${updatedTitle}", got "${row2.title}"`);
  }

  // 3. Clean up test row
  await sql`DELETE FROM tasks WHERE raw_message_hash = ${testHash}`;
  console.log('\n✅ Successfully tested idempotent ON CONFLICT upsert & cleaned up test row!');
}

testPostgresUpsert().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
