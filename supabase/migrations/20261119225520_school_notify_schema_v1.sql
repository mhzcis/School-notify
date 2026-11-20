create schema if not exists school_notify;
revoke all on schema school_notify from public, anon;
grant usage on schema school_notify to authenticated;

create table school_notify.allowed_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table school_notify.allowed_users enable row level security;

create or replace function school_notify.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from school_notify.allowed_users a where a.user_id = (select auth.uid()));
$$;
revoke all on function school_notify.is_allowed() from public, anon;
grant execute on function school_notify.is_allowed() to authenticated;

create table school_notify.students (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  national_id text,
  name text not null,
  parent_name text,
  phone text,
  class_name text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index students_owner_idx on school_notify.students(owner);

create table school_notify.templates (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index templates_owner_idx on school_notify.templates(owner);

create table school_notify.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);
create index campaigns_owner_idx on school_notify.campaigns(owner);

create table school_notify.messages (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_id uuid not null references school_notify.campaigns(id) on delete cascade,
  student_id uuid references school_notify.students(id) on delete set null,
  phone text,
  body text not null,
  status text not null default 'pending',
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_owner_idx on school_notify.messages(owner);
create index messages_campaign_idx on school_notify.messages(campaign_id);
create index messages_student_idx on school_notify.messages(student_id);

do $$
declare t text;
begin
  foreach t in array array['students','templates','campaigns','messages'] loop
    execute format('alter table school_notify.%I enable row level security', t);
    execute format('revoke all on school_notify.%I from public, anon', t);
    execute format('grant select, insert, update, delete on school_notify.%I to authenticated', t);
    execute format($p$create policy %I on school_notify.%I for all to authenticated using (owner = (select auth.uid()) and school_notify.is_allowed()) with check (owner = (select auth.uid()) and school_notify.is_allowed())$p$, t || '_owner_allowed', t);
  end loop;
end $$;

-- allowed_users: no client access at all (managed only via SQL by the project owner)
revoke all on school_notify.allowed_users from public, anon, authenticated;
