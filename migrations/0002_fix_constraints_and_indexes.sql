-- Neon PostgreSQL Migration: Fix Constraints & Multi-Tenant Indexes
-- Migration ID: 0002_fix_constraints_and_indexes
-- Description:
-- 1. [DAT-02] Drops global table-wide unique constraint on tasks.raw_message_hash,
--    enforcing tenant isolation via composite (user_id, raw_message_hash).
-- 2. [PRF-03] Adds composite index on tasks(user_id, due_date ASC, created_at DESC)
--    to eliminate in-memory filesorts on /api/tasks dashboard queries.
-- 3. [ARC-04] Adds composite unique index on courses(user_id, code)
--    to prevent duplicate course generation under concurrent sync passes.

-- 1. Drop global table-wide unique constraint and index on raw_message_hash
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_raw_message_hash_key;
DROP INDEX IF EXISTS tasks_raw_message_hash_key;

-- 2. Ensure composite multi-tenant unique index for deterministic task hash deduplication
CREATE UNIQUE INDEX IF NOT EXISTS tasks_user_id_raw_message_hash_idx 
ON tasks (user_id, raw_message_hash);

-- 3. Add composite index covering dashboard ordering (due_date ASC, created_at DESC)
CREATE INDEX IF NOT EXISTS idx_tasks_user_due_created 
ON tasks (user_id, due_date ASC, created_at DESC);

-- 4. Add composite unique index on courses(user_id, code) for atomic course resolution
CREATE UNIQUE INDEX IF NOT EXISTS courses_user_id_code_idx 
ON courses (user_id, code);
