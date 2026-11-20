-- Additive only: do-not-send list (suppression list) for SchoolNotify.
-- One row per owner + local mobile number (05XXXXXXXX) with an optional short reason.
-- RLS matches the other school_notify tables. Anon has no access.
-- Read by the browser (composer exclusions) and by the scheduled sender (service role).

create table if not exists school_notify.suppressed_phones (
  owner uuid not null,
  phone text not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (owner, phone),
  constraint suppressed_phones_phone_format check (phone ~ '^05[0-9]{8}$'),
  constraint suppressed_phones_reason_len check (char_length(reason) <= 200)
);

alter table school_notify.suppressed_phones enable row level security;
alter table school_notify.suppressed_phones force row level security;

revoke all on table school_notify.suppressed_phones from public, anon;
grant select, insert, update, delete on table school_notify.suppressed_phones to authenticated;
grant select on table school_notify.suppressed_phones to service_role;

drop policy if exists suppressed_phones_owner_all on school_notify.suppressed_phones;
create policy suppressed_phones_owner_all
  on school_notify.suppressed_phones
  for all
  to authenticated
  using (owner = (select auth.uid()) and school_notify.is_allowed())
  with check (owner = (select auth.uid()) and school_notify.is_allowed());
