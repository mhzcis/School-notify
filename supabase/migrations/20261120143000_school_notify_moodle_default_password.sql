-- Additive only: per-student Moodle DEFAULT password (the value Moodle resets an account to).
-- Lives ONLY in the owner-only credentials table (RLS forced, anon revoked; see 20261119225542).
-- Never copied to students.extra / notes, backups, reports, logs or previews (masked in the UI).
alter table school_notify.student_moodle_credentials
  add column if not exists default_password text not null default '';

alter table school_notify.student_moodle_credentials
  drop constraint if exists student_moodle_credentials_default_password_len;
alter table school_notify.student_moodle_credentials
  add constraint student_moodle_credentials_default_password_len
  check (char_length(default_password) <= 128);

comment on column school_notify.student_moodle_credentials.default_password is
  'Moodle default (reset) password. Secret: owner-only via RLS; masked everywhere in the app.';
