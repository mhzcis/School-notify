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

Backup (Settings → backup): JSON export of the cloud data (Moodle passwords excluded unless
explicitly included), Excel export of students, and restore with a typed confirmation (restore
merges/updates — it never deletes cloud rows).

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

## Not included

The previous Express server (`server.ts`) used on Google AI Studio is not part of this
static deployment.
