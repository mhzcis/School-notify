// school-notify-sms-webhook — receives SMSGate status events (sms:sent / sms:delivered / sms:failed / sms:cancelled).
//
// * verify_jwt = false (SMSGate cannot send a Supabase JWT). The ONLY protection is the HMAC-SHA256
//   signature (X-Signature over rawBody + X-Timestamp) with secret SMSGATE_WEBHOOK_SIGNING_KEY,
//   constant-time compare and a timestamp freshness window. Unsigned / stale / bad requests -> 401.
// * Updates school_notify.messages ONLY through the SECURITY DEFINER RPC
//   school_notify.apply_gateway_event(gateway id, state, error) — executable by service_role only
//   (see supabase/pending-migrations/). Idempotent; never downgrades a final state.
// * Never logs phone numbers, bodies, signatures or keys. Body limited to 64 KB.
import { MAX_WEBHOOK_BYTES, parseEvent, verifySignature } from './webhook.ts';

const plain = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return plain(405, 'method_not_allowed');
  const key = Deno.env.get('SMSGATE_WEBHOOK_SIGNING_KEY') ?? '';
  if (!key) return plain(503, 'not_configured');

  const len = Number(req.headers.get('Content-Length') ?? '0');
  if (len > MAX_WEBHOOK_BYTES) return plain(413, 'too_large');
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return plain(400, 'bad_body');
  }
  if (new TextEncoder().encode(raw).length > MAX_WEBHOOK_BYTES) return plain(413, 'too_large');

  const check = await verifySignature(key, raw, req.headers.get('X-Timestamp'), req.headers.get('X-Signature'));
  if (check !== 'ok') {
    console.log(`school-notify-sms-webhook: rejected (${check})`);
    return plain(401, 'unauthorized');
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return plain(400, 'bad_json');
  }
  const ev = parseEvent(body);
  if (!ev) return plain(200, 'ignored'); // signed but not a tracked event (e.g. system:ping)

  const url = Deno.env.get('SUPABASE_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !service) return plain(500, 'server_misconfigured');
  try {
    const res = await fetch(`${url}/rest/v1/rpc/apply_gateway_event`, {
      method: 'POST',
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'school_notify',
        'Accept-Profile': 'school_notify',
      },
      body: JSON.stringify({ p_gateway_id: ev.gatewayId, p_state: ev.state, p_error: ev.error ?? null }),
    });
    if (!res.ok) {
      await res.body?.cancel();
      console.log(`school-notify-sms-webhook: db_error status=${res.status}`);
      return plain(500, 'db_error'); // SMSGate retries
    }
    const updated = await res.json();
    console.log(`school-notify-sms-webhook: ${ev.state} updated=${Number(updated) || 0}`);
    return plain(200, 'ok');
  } catch {
    return plain(500, 'db_unreachable');
  }
});
