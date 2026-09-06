import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const envContent = fs.readFileSync(path.join(rootDir, '.env.local'), 'utf-8');
const dbMatch = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)/);
if (!dbMatch) {
  console.error('Missing DATABASE_URL in .env.local');
  process.exit(1);
}
const sql = neon(dbMatch[1]);

async function migrate() {
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignment_id text;`;
  console.log('✅ Column assignment_id added/verified in tasks table.');
  const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tasks' ORDER BY ordinal_position;`;
  console.log('Tasks table columns:', cols.map(c => `${c.column_name} (${c.data_type})`));
}

migrate().catch(console.error);
