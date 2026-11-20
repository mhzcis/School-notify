-- Supabase advisor fixes for the school_notify schema (low risk, no data changes).
--
-- 1. function_search_path_mutable: pin search_path on two pure helper functions.
--    Both only use built-ins (extract, timestamptz casts), so pg_catalog is enough.
-- 2. auth_rls_initplan: wrap auth.uid() in (select ...) so it is evaluated once
--    per statement instead of per row. Same predicate, same roles.
-- 3. duplicate_index: drop the two duplicated indexes on messages; the identical
--    messages_campaign_id_idx / messages_student_id_idx remain.
--
-- Intentionally NOT changed:
-- - allowed_users has RLS with no policies on purpose (no client access at all).
-- - is_allowed() is SECURITY DEFINER and executable by authenticated on purpose:
--   the app calls it after sign-in, and it only reveals the caller's own status.

alter function school_notify.is_quiet_hours(timestamptz) set search_path = pg_catalog;
alter function school_notify.scheduler_due_at(text) set search_path = pg_catalog;

drop policy if exists recipient_groups_owner_all on school_notify.recipient_groups;
create policy recipient_groups_owner_all on school_notify.recipient_groups
  for all to authenticated
  using (owner = (select auth.uid()) and school_notify.is_allowed())
  with check (owner = (select auth.uid()) and school_notify.is_allowed());

drop policy if exists student_moodle_credentials_owner_all on school_notify.student_moodle_credentials;
create policy student_moodle_credentials_owner_all on school_notify.student_moodle_credentials
  for all to authenticated
  using (owner = (select auth.uid()) and school_notify.is_allowed())
  with check (owner = (select auth.uid()) and school_notify.is_allowed());

drop policy if exists section_events_owner_all on school_notify.section_events;
create policy section_events_owner_all on school_notify.section_events
  for all to authenticated
  using (owner = (select auth.uid()) and school_notify.is_allowed())
  with check (owner = (select auth.uid()) and school_notify.is_allowed());

drop policy if exists scheduler_settings_owner_all on school_notify.scheduler_settings;
create policy scheduler_settings_owner_all on school_notify.scheduler_settings
  for all to authenticated
  using (owner = (select auth.uid()) and school_notify.is_allowed())
  with check (owner = (select auth.uid()) and school_notify.is_allowed());

drop index if exists school_notify.messages_campaign_idx;
drop index if exists school_notify.messages_student_idx;
