-- Cron for server-side scheduled sending (every 5 minutes).
--
-- The secret and the function URL are read from Supabase Vault at run time
-- (vault secrets 'school_notify_scheduler_secret' and 'school_notify_scheduler_url').
-- They are created out of band and are NEVER committed to this repository.
--
-- The cron call alone sends nothing. The Edge Function still requires:
--   - SCHEDULER_CRON_SECRET (function secret) equal to the Vault value,
--   - SCHEDULER_ENABLED = "true" (function secret, global kill switch),
--   - scheduler_settings.enabled = true for the owner,
--   - a due, pending, non-archived campaign outside quiet hours (22:00–07:00).
--
-- To stop it: select cron.unschedule('school-notify-scheduled-send');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'school-notify-scheduled-send';

select cron.schedule(
  'school-notify-scheduled-send',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'school_notify_scheduler_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Scheduler-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'school_notify_scheduler_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'school_notify_scheduler_url')
    and exists (select 1 from vault.decrypted_secrets where name = 'school_notify_scheduler_secret');
  $cron$
);
