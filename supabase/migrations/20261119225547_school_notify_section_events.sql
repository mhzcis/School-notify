create table if not exists school_notify.section_events (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null,
  grade text not null default '',
  section text not null default '',
  event_type text not null default 'quiz',
  title text not null default '',
  close_at timestamptz,
  close_label text not null default '',
  url text not null default '',
  duration text not null default '',
  attempts text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint section_events_type_ok check (event_type in ('quiz', 'assignment')),
  constraint section_events_title_len check (char_length(title) <= 200)
);

create index if not exists section_events_owner_idx
  on school_notify.section_events (owner);

alter table school_notify.section_events enable row level security;
alter table school_notify.section_events force row level security;

revoke all on table school_notify.section_events from public, anon;
grant select, insert, update, delete on table school_notify.section_events to authenticated;

drop policy if exists section_events_owner_all on school_notify.section_events;
create policy section_events_owner_all
  on school_notify.section_events
  for all
  to authenticated
  using (owner = auth.uid() and school_notify.is_allowed())
  with check (owner = auth.uid() and school_notify.is_allowed());
