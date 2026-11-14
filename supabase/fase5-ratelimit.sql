-- ---------------------------------------------------------------------------
-- Fase 5: rate limit atómico y fiable para el seguimiento
--
-- El contador vive en una función que serializa por IP y falla cerrado.
-- La Edge Function solo puede llamar a take_order_lookup con service_role.
-- ---------------------------------------------------------------------------

begin;

create index if not exists order_lookup_attempts_created_idx
  on public.order_lookup_attempts (created_at);

create or replace function public.take_order_lookup(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_global integer;
begin
  if p_ip_hash is null or length(p_ip_hash) <> 64 then
    return false;
  end if;

  -- Serializa las peticiones de la misma IP para que el límite sea atómico.
  perform pg_advisory_xact_lock(hashtext(p_ip_hash));

  select count(*) into v_count
    from public.order_lookup_attempts
   where ip_hash = p_ip_hash
     and created_at > now() - interval '10 minutes';

  if v_count >= 12 then
    return false;
  end if;

  -- Tope global de seguridad, aunque roten IPs.
  select count(*) into v_global
    from public.order_lookup_attempts
   where created_at > now() - interval '1 minute';

  if v_global >= 300 then
    return false;
  end if;

  insert into public.order_lookup_attempts (ip_hash)
  values (p_ip_hash);

  delete from public.order_lookup_attempts
   where created_at < now() - interval '2 days';

  return true;
end;
$$;

revoke all on function public.take_order_lookup(text) from public;
revoke all on function public.take_order_lookup(text) from anon;
revoke all on function public.take_order_lookup(text) from authenticated;
grant execute on function public.take_order_lookup(text) to service_role;

commit;
