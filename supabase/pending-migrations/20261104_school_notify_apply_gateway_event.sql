-- APPLIED on 2026-11-04 (Supabase migration school_notify_apply_gateway_event). Kept here for reference.
-- Purpose: let the `school-notify-sms-webhook` Edge Function update ONE message's gateway state by
-- SMSGate message id, without giving service_role general table privileges on school_notify.
-- Additive only: creates one function + one index. Drops nothing, changes no existing rows/columns.

create or replace function school_notify.apply_gateway_event(p_gateway_id text, p_state text, p_error text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  new_rank integer;
begin
  if p_gateway_id is null or p_gateway_id !~ '^[A-Za-z0-9_-]{1,36}$' then
    return 0;
  end if;
  new_rank := case p_state when 'Sent' then 2 when 'Delivered' then 3 when 'Failed' then 3 when 'Cancelled' then 3 else null end;
  if new_rank is null then
    return 0;
  end if;

  update school_notify.messages m
     set meta = coalesce(m.meta, '{}'::jsonb)
                || jsonb_build_object('gatewayState', p_state, 'gatewayUpdatedAt', now()),
         status = case p_state when 'Delivered' then 'delivered' when 'Sent' then 'sent' else 'failed' end,
         error = case when p_state in ('Failed', 'Cancelled') then coalesce(left(p_error, 200), m.error) else m.error end
   where m.meta->>'gatewayMessageId' = p_gateway_id
     -- idempotent + never downgrade: final states are never overwritten, only higher ranks apply
     and coalesce(m.meta->>'gatewayState', 'Pending') not in ('Delivered', 'Failed', 'Cancelled')
     and new_rank > case coalesce(m.meta->>'gatewayState', 'Pending') when 'Processed' then 1 when 'Sent' then 2 else 0 end;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function school_notify.apply_gateway_event(text, text, text) from public, anon, authenticated;
grant execute on function school_notify.apply_gateway_event(text, text, text) to service_role;
-- service_role needs USAGE on the schema to call the RPC through the Data API (no table grants).
grant usage on schema school_notify to service_role;

create index if not exists messages_gateway_message_id_idx
  on school_notify.messages ((meta->>'gatewayMessageId'))
  where meta ? 'gatewayMessageId';
