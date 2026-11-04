/**
 * Supabase browser client.
 *
 * Only the project URL and the PUBLISHABLE key are used here (both are public by design).
 * All data access is protected server-side by Row Level Security in the `school_notify` schema
 * (owner = auth.uid() AND school_notify.is_allowed()).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL: string = ((import.meta as any).env?.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
export const SUPABASE_PUBLISHABLE_KEY: string =
  ((import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || '';

export const DB_SCHEMA = 'school_notify';
export const SMS_FUNCTION_NAME = 'school-notify-sms';

export const isSupabaseConfigured = (): boolean => !!SUPABASE_URL && !!SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient<any, any, any> | null = null;

/** Lazily created singleton; null when the build has no Supabase configuration. */
export function getSupabase(): SupabaseClient<any, any, any> | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      db: { schema: DB_SCHEMA },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'school-notify-auth',
      },
    });
  }
  return client;
}

/**
 * Calls the SMS Edge Function with the signed-in user's JWT (added automatically by supabase-js).
 * Returns the function's JSON, or { ok:false, error } for HTTP / network failures.
 */
export async function invokeSmsFunction(body: unknown): Promise<import('./smsProxy').ProxyResponse> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'client_not_configured' };
  try {
    const { data, error } = await sb.functions.invoke(SMS_FUNCTION_NAME, { body: body as Record<string, unknown> });
    if (!error) return data as import('./smsProxy').ProxyResponse;
    const ctx = (error as any).context as Response | undefined;
    if ((error as any).name === 'FunctionsHttpError' && ctx) {
      const status = ctx.status;
      let code = status === 401 ? 'unauthorized' : status === 403 ? 'not_allowed' : `http_${status}`;
      try {
        const j = await ctx.json();
        if (j && typeof j.error === 'string') code = j.error;
      } catch {
        /* non-JSON body */
      }
      return { ok: false, error: code, httpStatus: status };
    }
    return { ok: false, error: 'offline' };
  } catch {
    return { ok: false, error: 'offline' };
  }
}
