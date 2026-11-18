-- NEEDS APPROVAL BEFORE APPLYING TO THE LIVE PROJECT.
-- Do not apply automatically. Take a cloud JSON backup first.
--
-- Additive only: creates school_notify.scheduler_settings and helper functions
-- used by the school-notify-scheduled Edge Function. Drops nothing, rewrites
-- no existing campaign or message rows.
--
-- Automatic sending stays OFF until ALL of the following are true:
--   1. This migration is applied.
--   2. The school-notify-scheduled Edge Function is deployed with
--      SCHEDULER_CRON_SECRET (and SMSGATE_* secrets already used by school-notify-sms).
--   3. The function secret SCHEDULER_ENABLED is set to the exact value "true".
--   4. The teacher enables the per-account switch in the app (defaults to false;
--      requires typing «تفعيل»).
--   5. A pg_cron / pg_net job (or equivalent) calls the function. The schedule
--      SQL at the bottom of this file is COMMENTED OUT and must not be run
--      until the secret is in Vault — never paste the secret into a file.
--
-- The app degrades safely without this table: the UI switch stays disabled
-- and no campaign is claimed or sent automatically.
--
-- Shared project hebrpniqdysrukejwmob: this file touches only school_notify.
-- It never references aoms_* or other schemas.
--
-- Quiet hours for due-campaign claiming: 22:00–07:00 Asia/Jerusalem.
-- scheduledTime values without a timezone are interpreted as Asia/Jerusalem
-- wall time (how the composer stores them).

create table if not exists school_notify.scheduler_settings (
  owner uuid primary key,
  enabled boolean not null default false,
  max_per_run integer not null default 50,
  updated_at timestamptz not null default now(),
  constraint scheduler_settings_max_ok check (max_per_run between 1 and 200)
);

alter table school_notify.scheduler_settings enable row level security;
alter table school_notify.scheduler_settings force row level security;

revoke all on table school_notify.scheduler_settings from public, anon;
grant select, insert, update, delete on table school_notify.scheduler_settings to authenticated;

drop policy if exists scheduler_settings_owner_all on school_notify.scheduler_settings;
create policy scheduler_settings_owner_all
  on school_notify.scheduler_settings
  for all
  to authenticated
  using (owner = auth.uid() and school_notify.is_allowed())
  with check (owner = auth.uid() and school_notify.is_allowed());

create or replace function school_notify.is_quiet_hours(p_at timestamptz default now())
returns boolean
language sql
stable
as $$
  select extract(hour from (p_at at time zone 'Asia/Jerusalem'))::int >= 22
      or extract(hour from (p_at at time zone 'Asia/Jerusalem'))::int < 7;
$$;

create or replace function school_notify.scheduler_due_at(p_raw text)
returns timestamptz
language plpgsql
stable
as $$
begin
  if p_raw is null or btrim(p_raw) = '' then
    return null;
  end if;
  -- Already has a timezone / Z
  if p_raw ~* '(Z|[+-][0-9]{2}:?[0-9]{2})$' then
    return p_raw::timestamptz;
  end if;
  -- Naive local wall time in Asia/Jerusalem
  return (p_raw::timestamp at time zone 'Asia/Jerusalem');
exception when others then
  return null;
end;
$$;

-- Allow-list check that does not depend on auth.uid() (used by the definer claim fn).
create or replace function school_notify.owner_is_allowed(p_owner uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, school_notify, public
as $$
declare
  ok boolean := false;
begin
  if p_owner is null then
    return false;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'school_notify' and table_name = 'allowed_users' and column_name = 'user_id'
  ) then
    execute 'select exists (select 1 from school_notify.allowed_users where user_id = $1)' into ok using p_owner;
    return ok;
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'school_notify' and table_name = 'allowed_users' and column_name = 'id'
  ) then
    execute 'select exists (select 1 from school_notify.allowed_users where id = $1)' into ok using p_owner;
    return ok;
  end if;
  return false;
end;
$$;

revoke all on function school_notify.owner_is_allowed(uuid) from public, anon, authenticated;
grant execute on function school_notify.owner_is_allowed(uuid) to service_role;

-- Atomically claim due scheduled campaigns. Nothing is claimed when the owner's
-- kill switch is off, the owner is not on the allow-list, or we are in quiet
-- hours (unless the campaign was saved with quietHoursOverride).
-- Stuck "sending" rows (claimed more than 15 minutes ago) may be reclaimed.
create or replace function school_notify.claim_due_campaigns(p_limit integer default 3)
returns setof school_notify.campaigns
language plpgsql
security definer
set search_path = pg_catalog, school_notify, public
as $$
declare
  lim integer := greatest(1, least(coalesce(p_limit, 3), 20));
begin
  return query
  with due as (
    select c.id
    from school_notify.campaigns c
    join school_notify.scheduler_settings s on s.owner = c.owner and s.enabled = true
    where school_notify.owner_is_allowed(c.owner)
      and coalesce(c.meta->>'kind', 'scheduled') is distinct from 'immediate'
      and coalesce((c.meta->>'archived')::boolean, false) = false
      and school_notify.scheduler_due_at(c.meta->>'scheduledTime') is not null
      and school_notify.scheduler_due_at(c.meta->>'scheduledTime') <= now()
      and (
        c.status = 'pending'
        or (
          c.status = 'sending'
          and coalesce((c.meta->>'claimedAt')::timestamptz, now() - interval '1 day') <= now() - interval '15 minutes'
        )
      )
      and (
        coalesce((c.meta->>'quietHoursOverride')::boolean, false) = true
        or not school_notify.is_quiet_hours(now())
      )
    order by school_notify.scheduler_due_at(c.meta->>'scheduledTime')
    limit lim
    for update of c skip locked
  )
  update school_notify.campaigns c
  set status = 'sending',
      meta = coalesce(c.meta, '{}'::jsonb) || jsonb_build_object(
        'claimedAt', now(),
        'claimedBy', 'scheduler'
      )
  from due
  where c.id = due.id
  returning c.*;
end;
$$;

revoke all on function school_notify.claim_due_campaigns(integer) from public, anon, authenticated;
grant execute on function school_notify.claim_due_campaigns(integer) to service_role;

revoke all on function school_notify.is_quiet_hours(timestamptz) from public, anon;
grant execute on function school_notify.is_quiet_hours(timestamptz) to authenticated, service_role;
revoke all on function school_notify.scheduler_due_at(text) from public, anon;
grant execute on function school_notify.scheduler_due_at(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CRON (DO NOT RUN until the Edge Function is deployed and the cron secret
-- lives in Vault — never commit the secret). Confirm extensions first:
--   select extname from pg_extension where extname in ('pg_cron', 'pg_net');
-- If either is missing, do not enable cron here; call the function from
-- another trusted scheduler instead.
--
-- select cron.schedule(
--   'school-notify-scheduled-send',
--   '*/5 * * * *',
--   $$
--   select net.http_post(
--     url := current_setting('app.settings.school_notify_scheduler_url', true),
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'X-Scheduler-Secret', current_setting('app.settings.school_notify_scheduler_secret', true)
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
-- ---------------------------------------------------------------------------
