# SchoolNotify (رسال)

A browser-only school messaging app (Arabic, RTL) for sending notices to parents and students:
Excel import of class lists, message templates with variables, recipient selection with a
pre-send confirmation, manual WhatsApp/SMS sending, reports, and backup/restore.

**Live site:** https://mhzcis.github.io/School-notify/

## Deployment

The site is a static Vite + React build hosted on **GitHub Pages**.

- Every push to `main` runs `.github/workflows/deploy.yml`:
  `npm ci` → `npm test` → `npm run build` → upload `dist/` → deploy to Pages.
- Pages source is set to **GitHub Actions** (Settings → Pages).
- `vite.config.ts` sets `base` to `/School-notify/` (the Pages project sub-path).
  Override with `VITE_BASE=/` at build time if the site is ever served from a domain root.

Local development:

```bash
npm ci
npm run dev       # dev server
npm test          # unit tests (vitest)
npm run lint      # type check
npm run build     # production build into dist/
npm run preview   # serve the production build locally
```

## Data model: localStorage only

There is **no backend and no database**. All data (students, templates, logs, scheduled
campaigns, settings) lives in the browser's `localStorage` under keys prefixed `resal_`.

- Data is per browser and per origin. Another browser, device, or domain starts empty.
- Clearing site data deletes everything. Use the built-in **backup/export** regularly.
- Corrupt stored values are quarantined (`resal_corrupt_<key>_<stamp>`) instead of crashing the app.
- Moodle default usernames/passwords imported from Excel are stored in plain text in
  `localStorage` (masked in the UI).

## SMS sending on GitHub Pages

| Mode | Works on Pages? | Notes |
|---|---|---|
| Manual WhatsApp / `sms:` links (one by one) | ✅ Yes | Opens each message for the user to send. |
| SMSGate **cloud** (`api.sms-gate.app`) | ❌ Not yet | The SMSGate API does not allow browser (CORS) calls; it needs a server-side proxy. |
| "School SMS helper" Android app (server queue) | ❌ Not yet | Needs a server to hold the queue. |
| SMSGate **local** (`http://<phone-ip>:8080`) | ❌ From https | Browsers block http calls from an https page (mixed content). Works only if the app is opened over plain http on the same LAN (e.g. `npm run preview -- --host`). |

The UI shows a clear notice and refuses to start a gateway broadcast when the selected mode
cannot work from this deployment.

**Credentials:** SMSGate usernames/passwords entered in the settings are stored in the
browser's `localStorage` (plain text) until a server-side proxy exists. A Supabase Edge
Function proxy is planned; it will keep gateway credentials as server secrets. Until then,
use this app only on a trusted, personal browser profile.

Scheduled campaigns are **not** sent automatically (there is no scheduler); use "send now"
to load and send them manually with confirmation.

## Not included

The previous Express server (`server.ts`) used on Google AI Studio is not part of this
static deployment.
