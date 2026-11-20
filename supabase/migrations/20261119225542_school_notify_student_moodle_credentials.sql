create table if not exists school_notify.student_moodle_credentials (
  owner uuid not null,
  national_id text not null,
  moodle_username text not null default '',
  moodle_password text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner, national_id),
  constraint student_moodle_credentials_nid_len check (char_length(national_id) between 4 and 15)
);

create index if not exists student_moodle_credentials_owner_idx
  on school_notify.student_moodle_credentials (owner);

alter table school_notify.student_moodle_credentials enable row level security;
alter table school_notify.student_moodle_credentials force row level security;

revoke all on table school_notify.student_moodle_credentials from public, anon;
grant select, insert, update, delete on table school_notify.student_moodle_credentials to authenticated;

drop policy if exists student_moodle_credentials_owner_all on school_notify.student_moodle_credentials;
create policy student_moodle_credentials_owner_all
  on school_notify.student_moodle_credentials
  for all
  to authenticated
  using (owner = auth.uid() and school_notify.is_allowed())
  with check (owner = auth.uid() and school_notify.is_allowed());
