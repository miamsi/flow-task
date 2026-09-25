create extension if not exists pgcrypto;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  description text,
  due_date date,
  priority smallint not null default 1 check (priority between 0 and 3),
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null default 'text' check (kind in ('text','url','number')),
  body text not null,
  created_at timestamptz not null default now()
);
-- Composite indexes for the columns tools and views filter/sort by
create index tasks_user_due on public.tasks (user_id, due_date);
create index tasks_user_done_due on public.tasks (user_id, done, due_date);
create index notes_user_created on public.notes (user_id, created_at desc);

alter table public.tasks enable row level security;
alter table public.notes enable row level security;
create policy "own tasks" on public.tasks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notes" on public.notes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
