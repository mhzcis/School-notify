# SchoolNotify (رسال)

A school messaging app (Arabic, RTL) for sending notices to parents and students:
Excel import of class lists, message templates with variables, recipient selection with a
pre-send confirmation, cloud SMS (via a Supabase Edge Function) or manual WhatsApp/SMS sending,
reports, and backup/restore. Login required; data is stored in Supabase with Row Level Security.

**Live site:** https://mhzcis.github.io/School-notify/

## Deployment

The site is a static Vite + React build hosted on **GitHub Pages**.

- Every push to `main` runs `.github/workflows/deploy.yml`:
  `npm ci` → `npm run lint` → `npm test` → `npm run build` → upload `dist/` → deploy to Pages.
- Pages source is set to **GitHub Actions** (Settings → Pages).
- `vite.config.ts` sets `base` to `/School-notify/` (the Pages project sub-path).
  Override with `VITE_BASE=/` at build time if the site is ever served from a domain root.

Local development:

```bash
npm ci
cp .env.example .env.local   # fill in the PUBLIC project URL + publishable key
npm run dev       # dev server
npm test          # unit tests (vitest)
npm run lint      # type check
npm run build     # production build into dist/
npm run preview   # serve the production build locally
```

The build reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. In CI they come from the
repository **variables** (`vars.*`). Only the publishable key is ever used in the browser — never a
service-role / secret key.

## Login

The whole app is behind a Supabase Auth email + password login (no sign-up, no password reset in
the UI). After sign-in the app calls `school_notify.is_allowed()`; accounts that are not on the
allow-list (`school_notify.allowed_users`, managed by the owner in the dashboard) are signed out
immediately. Nothing is rendered or fetched before both checks pass.

## Data model: Supabase (`school_notify` schema)

Students, templates, campaigns and message logs are stored in the `school_notify` schema of the
Supabase project, protected by Row Level Security (`owner = auth.uid()` **and** `is_allowed()`).
The anonymous role has no access to the schema at all. Students are unique per owner by national ID
(`students(owner, national_id)`), so re-importing an Excel sheet updates instead of duplicating;
imports are written in batches of 500.

`localStorage` only holds non-sensitive UI preferences (`sn_*` keys: school name, send mode,
segment price). The data of the old browser-only version (`resal_*` keys) is **ignored**: it is not
read, migrated or deleted.

Backup (Settings → backup): JSON export of the cloud data plus non-secret settings (school name,
send-mode, segment price, batch delay) and saved recipient groups. Moodle credentials, student
notes, and SMSGate server secrets are never included. Restore previews the file, requires typing
«استعادة», downloads a safety copy first, then merge-upserts by national ID (it never deletes
cloud rows). A reminder appears if no backup was downloaded in 7 days. Reports can be exported
to Excel (current filters, test/hidden campaigns excluded by default, per-campaign totals).
Named recipient groups can be saved from the send screen; they sync to
`school_notify.recipient_groups` once that pending migration is applied, and otherwise stay in
`localStorage` + the backup file.

## Moodle tools

The **أدوات مودل** tab imports Moodle CSV/Excel exports (participants / last access,
assignment grading worksheets, and quiz reports). Rows are matched by national ID first
(then Moodle user id, then a unique exact name). The teacher can build a campaign or a
saved group for “never logged in”, “not since X days”, “not submitted”, “draft”, or
“not attempted”. Grades stay in the import session only and are never written to the
student row.

Per-section quiz windows (title, close time, duration, attempts, and a launcher URL of
the form `https://mhzcis.github.io/moodle-quiz-launcher/?id=<quizId>`) feed the
`{{رابط_الاختبار}}` and `{{موعد_الإغلاق}}` placeholders and a one-click WhatsApp blurb
(one section at a time — links are never mixed). Section windows sync to
`school_notify.section_events` once that pending migration is applied; otherwise they
stay in `localStorage` and the normal backup file.

Moodle usernames and passwords are stored only in the owner-only table
`school_notify.student_moodle_credentials` (RLS forced, `owner = auth.uid()` and
`is_allowed()`, no anon access). They are imported through a dedicated “Moodle
credentials” form, never through the regular student importer, and they are excluded
from backups, student Excel exports, and reports. Sending a template that uses
`{{كلمة_مرور_مودل}}` / `{{كلمة_المرور}}` (or the username aliases) requires an extra
confirmation. If the pending migration has not been applied, the import is disabled and
credentials are not written to the browser.

Encryption of the password column is intentionally RLS-only: a pgcrypto key would still
be revealed to the signed-in owner in the browser (or to anyone with the service-role
key), so it would not be a simpler or more robust control than the existing owner-only
RLS. See `supabase/pending-migrations/20261118_student_moodle_credentials.sql`.

## SMS sending

Automatic sending goes through the Edge Function `school-notify-sms`
(`supabase/functions/school-notify-sms`): JWT required, re-checks `is_allowed()` for the caller,
validates input (max 50 recipients per call, E.164 phones), CORS limited to
`https://mhzcis.github.io` and localhost, and forwards to SMSGate cloud
(`https://api.sms-gate.app/3rdparty/v1/message`) with Basic auth from the function secrets
`SMSGATE_USERNAME` / `SMSGATE_PASSWORD`. Until the owner sets those secrets (Supabase dashboard →
Edge Functions → Secrets) the function answers "SMS gateway not configured" and the UI shows an
Arabic notice. Phone numbers, message bodies and credentials are never logged.

The manual WhatsApp/SMS queue (one-by-one, opened on the teacher's device) still works without the
gateway.

## Scheduled sending (server-side, off by default)

Campaigns can still be reviewed and sent from the browser. Automatic server-side sending is
implemented but **does not send anything until it is explicitly enabled after deploy**:

1. Apply `supabase/pending-migrations/20261118_scheduled_send.sql` (after a cloud backup). This
   creates `school_notify.scheduler_settings` (per-owner kill switch, default `enabled = false`)
   and `claim_due_campaigns()` (idempotent row lock, quiet hours 22:00–07:00 Asia/Jerusalem).
2. Deploy the Edge Function `school-notify-scheduled` (`verify_jwt = false`) with the existing
   `SMSGATE_*` secrets plus a new `SCHEDULER_CRON_SECRET`.
3. Set the function secret `SCHEDULER_ENABLED` to the exact value `true`. Any other value (or a
   missing secret) makes the function return without sending.
4. Create a cron job (pg_cron + pg_net, or another trusted scheduler) that POSTs to the function
   with header `X-Scheduler-Secret`. The cron SQL in the migration file is commented out and must
   not be run with a secret pasted into a script.
5. In the app (جدولة), type «تفعيل» and turn the per-account switch on. The switch is disabled
   until the settings table exists, and it can be turned off at any time.

Due campaigns are claimed with `FOR UPDATE SKIP LOCKED`, already-logged phones are skipped
(failed may be retried), and each run is capped by `max_per_run` (default 50). Templates that
include Moodle credentials are not auto-sent unless the campaign was saved with
`allowCredentialsAutosend` (from the extra confirmation on the send dialog). Quiet-hour sends
are skipped unless `quietHoursOverride` was stored when scheduling.

## Not included

The previous Express server (`server.ts`) used on Google AI Studio is not part of this
static deployment.
