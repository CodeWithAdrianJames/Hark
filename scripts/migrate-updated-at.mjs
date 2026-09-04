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

async function migrate() {
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at timestamptz default now()`;
  console.log('✅ Column updated_at added successfully to tasks table in Neon.');
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks'`;
  console.log('Current tasks table columns:', cols.map(c => c.column_name));
}

migrate().catch(console.error);
