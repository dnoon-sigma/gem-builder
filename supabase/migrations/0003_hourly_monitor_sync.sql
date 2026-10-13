-- Hourly sync of monitor frequencies, run from inside Supabase so it works on
-- any Vercel plan. The sync route needs the app's CRON_SECRET as a bearer
-- token; it is read from Supabase Vault (secret name: cron_secret) and is never
-- stored in this file. Create it once with:
--   select vault.create_secret('<CRON_SECRET value>', 'cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.sync_monitors()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  token text;
begin
  select decrypted_secret into token
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;
  if token is null then
    raise exception 'Vault secret cron_secret is not set';
  end if;

  return net.http_get(
    url := 'https://gem-builder.vercel.app/api/ingest/monitors',
    headers := jsonb_build_object('Authorization', 'Bearer ' || token),
    timeout_milliseconds := 30000
  );
end;
$$;

-- Only the database owner (and pg_cron) may run it.
revoke all on function public.sync_monitors() from public, anon, authenticated;

select cron.schedule('sync-monitors', '0 * * * *', $$select public.sync_monitors()$$);
