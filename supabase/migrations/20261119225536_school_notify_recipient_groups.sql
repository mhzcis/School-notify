-- Additive only: creates school_notify.recipient_groups. Drops nothing, rewrites no existing rows.
-- RLS matches the other school_notify tables: owner = auth.uid() AND school_notify.is_allowed().
-- Anon has no access. Groups store only a title and student national IDs — never message
-- bodies, Moodle credentials, or SMSGate secrets.

create table if not exists school_notify.recipient_groups (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null,
  title text not null,
  student_national_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipient_groups_title_len check (char_length(title) between 1 and 80),
  constraint recipient_groups_ids_is_array check (jsonb_typeof(student_national_ids) = 'array')
);

create index if not exists recipient_groups_owner_idx
  on school_notify.recipient_groups (owner);

alter table school_notify.recipient_groups enable row level security;
alter table school_notify.recipient_groups force row level security;

revoke all on table school_notify.recipient_groups from public, anon;
grant select, insert, update, delete on table school_notify.recipient_groups to authenticated;

drop policy if exists recipient_groups_owner_all on school_notify.recipient_groups;
create policy recipient_groups_owner_all
  on school_notify.recipient_groups
  for all
  to authenticated
  using (owner = auth.uid() and school_notify.is_allowed())
  with check (owner = auth.uid() and school_notify.is_allowed());
