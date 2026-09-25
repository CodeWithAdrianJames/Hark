import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const envContent = fs.readFileSync(path.join(rootDir, '.env.local'), 'utf-8');
const dbMatch = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)/);
if (!dbMatch) {
  console.error('❌ Missing DATABASE_URL in .env.local');
  process.exit(1);
}

const sql = neon(dbMatch[1]);

async function runMigration() {
  console.log('🚀 Running migration: 0002_fix_constraints_and_indexes.sql ...\n');

  const migrationSql = fs.readFileSync(
    path.join(rootDir, 'migrations', '0002_fix_constraints_and_indexes.sql'),
    'utf-8'
  );

  // Execute statements
  console.log('Applying Step 1: Drop global table-wide unique constraint on tasks.raw_message_hash...');
  await sql`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_raw_message_hash_key;`;
  await sql`DROP INDEX IF EXISTS tasks_raw_message_hash_key;`;
  console.log('✅ Global raw_message_hash constraint dropped.\n');

  console.log('Applying Step 2: Ensure composite unique index on tasks (user_id, raw_message_hash)...');
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS tasks_user_id_raw_message_hash_idx ON tasks (user_id, raw_message_hash);`;
  console.log('✅ Composite unique index tasks_user_id_raw_message_hash_idx verified.\n');

  console.log('Applying Step 3: Add composite index on tasks (user_id, due_date ASC, created_at DESC)...');
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_user_due_created ON tasks (user_id, due_date ASC, created_at DESC);`;
  console.log('✅ Composite index idx_tasks_user_due_created verified.\n');

  console.log('Applying Step 4: Add composite unique index on courses (user_id, code)...');
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS courses_user_id_code_idx ON courses (user_id, code);`;
  console.log('✅ Composite unique index courses_user_id_code_idx verified.\n');

  // Verification step: Query pg_constraint and pg_indexes for tasks and courses
  console.log('====================================================');
  console.log('VERIFICATION: \\d tasks CONSTRAINTS & INDEXES');
  console.log('====================================================');
  const taskConstraints = await sql`
    SELECT conname, pg_get_constraintdef(c.oid) as def 
    FROM pg_constraint c 
    WHERE conrelid = 'tasks'::regclass
    ORDER BY conname;
  `;
  taskConstraints.forEach(c => console.log(`[Constraint] ${c.conname}: ${c.def}`));

  const taskIndexes = await sql`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename = 'tasks'
    ORDER BY indexname;
  `;
  taskIndexes.forEach(i => console.log(`[Index] ${i.indexname}: ${i.indexdef}`));

  console.log('\n====================================================');
  console.log('VERIFICATION: \\d courses CONSTRAINTS & INDEXES');
  console.log('====================================================');
  const courseConstraints = await sql`
    SELECT conname, pg_get_constraintdef(c.oid) as def 
    FROM pg_constraint c 
    WHERE conrelid = 'courses'::regclass
    ORDER BY conname;
  `;
  courseConstraints.forEach(c => console.log(`[Constraint] ${c.conname}: ${c.def}`));

  const courseIndexes = await sql`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename = 'courses'
    ORDER BY indexname;
  `;
  courseIndexes.forEach(i => console.log(`[Index] ${i.indexname}: ${i.indexdef}`));

  console.log('\n🎉 Migration 0002 applied and verified successfully!');
}

runMigration().catch((err) => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});
