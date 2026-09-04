-- Neon PostgreSQL Migration: Academic Assignment Tracking Dashboard
-- Description: Sets up users, courses, and tasks tables with UUID primary keys, foreign keys, constraints, and indexes.

-- 1. Extensions
create extension if not exists "pgcrypto";

-- 2. Users Table
create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    email text unique not null,
    created_at timestamptz not null default now()
);

comment on table users is 'Registered application users.';

-- 3. Courses Table
create table if not exists courses (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    code text not null,
    name text not null,
    channel_id text,
    created_at timestamptz not null default now()
);

comment on table courses is 'Academic courses linked to a user, with optional channel identifier.';

-- 4. Tasks Table
create table if not exists tasks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    course_id uuid references courses(id) on delete cascade,
    title text not null,
    description text,
    due_date timestamptz not null,
    source_type text check (source_type in ('official_assignment', 'chat_announcement')),
    source_url text,
    raw_message_hash text unique, -- Prevents duplicate ingestion of identical messages
    status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
    created_at timestamptz not null default now()
);

comment on table tasks is 'Ingested academic assignments and deliverables.';

-- 5. Performance & Foreign Key Indexes
create index if not exists idx_courses_user_id on courses(user_id);
create index if not exists idx_courses_channel_id on courses(channel_id);

create index if not exists idx_tasks_user_id on tasks(user_id);
create index if not exists idx_tasks_course_id on tasks(course_id);
create index if not exists idx_tasks_user_due_date on tasks(user_id, due_date asc);
create index if not exists idx_tasks_user_status on tasks(user_id, status);
