create or replace function vanteloq_private.dispatch_pos_sync()
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  signing_secret text;
  tick_timestamp text := floor(extract(epoch from clock_timestamp()))::bigint::text;
  tick_nonce text := gen_random_uuid()::text;
  tick_body text := '{}';
  tick_signature text;
begin
  select decrypted_secret into signing_secret
    from vault.decrypted_secrets where name = 'vanteloq_pos_sync_signing_v1';
  if signing_secret is null or length(signing_secret) < 32 then
    raise exception 'Vanteloq POS signing key is not configured';
  end if;
  tick_signature := encode(extensions.hmac(tick_timestamp || '.' || tick_nonce || '.' || tick_body, signing_secret, 'sha256'), 'hex');
  return net.http_post(
    url := 'https://vanteloq.com/api/internal/pos-sync',
    body := tick_body::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Vanteloq-Sync-Timestamp', tick_timestamp,
      'X-Vanteloq-Sync-Nonce', tick_nonce,
      'X-Vanteloq-Sync-Signature', tick_signature
    ),
    timeout_milliseconds := 60000
  );
end;
$function$;
revoke all on function vanteloq_private.dispatch_pos_sync() from public, anon, authenticated;
grant execute on function vanteloq_private.dispatch_pos_sync() to postgres;

