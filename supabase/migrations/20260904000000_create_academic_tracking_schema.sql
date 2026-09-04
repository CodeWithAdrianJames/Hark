-- Supabase Migration: Academic Assignment Tracking Dashboard
-- Description: Sets up users, courses, and tasks tables with UUIDs, foreign keys, indexes, and RLS policies.

-- 1. Enable pgcrypto (for UUID generation if needed)
create extension if not exists "pgcrypto";

-- 2. Users Table
-- Linked to Supabase auth.users for authentication integration
create table if not exists public.users (
    id uuid primary key references auth.users(id) on delete cascade,
    email text unique not null,
    created_at timestamptz not null default now()
);

comment on table public.users is 'User profiles mirroring authenticated Supabase users.';

-- 3. Courses Table
create table if not exists public.courses (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    code text not null,
    name text not null,
    channel_id text,
    created_at timestamptz not null default now()
);

comment on table public.courses is 'Academic courses associated with a user, with optional chat channel linking.';

-- 4. Tasks Table
create table if not exists public.tasks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    course_id uuid references public.courses(id) on delete cascade,
    title text not null,
    description text,
    due_date timestamptz not null,
    source_type text check (source_type in ('official_assignment', 'chat_announcement')),
    source_url text,
    raw_message_hash text unique, -- to prevent duplicate ingestion of the same message
    status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
    created_at timestamptz not null default now()
);

comment on table public.tasks is 'Academic tasks and assignments tracked for courses, with ingestion deduplication.';

-- 5. Indexes
-- Foreign key indexes (vital for joins and RLS performance)
create index if not exists idx_courses_user_id on public.courses(user_id);
create index if not exists idx_tasks_user_id on public.tasks(user_id);
create index if not exists idx_tasks_course_id on public.tasks(course_id);

-- Query performance indexes for the dashboard
create index if not exists idx_courses_channel_id on public.courses(channel_id);
create index if not exists idx_tasks_user_due_date on public.tasks(user_id, due_date asc);
create index if not exists idx_tasks_user_status on public.tasks(user_id, status);

-- 6. Enable Row Level Security (RLS)
alter table public.users enable row level security;
alter table public.courses enable row level security;
alter table public.tasks enable row level security;

-- 7. Row Level Security Policies
-- Users Policies: Users can read and update only their own profile
create policy "Users can view their own profile"
    on public.users
    for select
    using (auth.uid() = id);

create policy "Users can update their own profile"
    on public.users
    for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

create policy "Users can insert their own profile"
    on public.users
    for insert
    with check (auth.uid() = id);

-- Courses Policies: Users can read and update only their own courses (plus insert & delete)
create policy "Users can view their own courses"
    on public.courses
    for select
    using (auth.uid() = user_id);

create policy "Users can update their own courses"
    on public.courses
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can insert their own courses"
    on public.courses
    for insert
    with check (auth.uid() = user_id);

create policy "Users can delete their own courses"
    on public.courses
    for delete
    using (auth.uid() = user_id);

-- Tasks Policies: Users can read and update only their own tasks (plus insert & delete)
create policy "Users can view their own tasks"
    on public.tasks
    for select
    using (auth.uid() = user_id);

create policy "Users can update their own tasks"
    on public.tasks
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can insert their own tasks"
    on public.tasks
    for insert
    with check (auth.uid() = user_id);

create policy "Users can delete their own tasks"
    on public.tasks
    for delete
    using (auth.uid() = user_id);

-- 8. Trigger to automatically sync auth.users into public.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
    insert into public.users (id, email, created_at)
    values (new.id, new.email, coalesce(new.created_at, now()))
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
