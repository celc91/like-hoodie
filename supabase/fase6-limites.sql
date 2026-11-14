-- ---------------------------------------------------------------------------
-- Fase 6: límites de tamaño y contadores atómicos de abuso
--
-- 1. Topes de artículos y tamaño en carritos y pedidos.
-- 2. Contador atómico para los errores de cliente (20/h por IP, 2.000/h global).
-- 3. Contador atómico para los intentos de pago con Clip.
--
-- Requiere haber ejecutado fase1-pedidos-seguros.sql (place_order seguro).
-- Ejecutar con:
--   npx supabase db query --remote --file supabase/fase6-limites.sql --yes
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. Topes de artículos y tamaño
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.carts'::regclass
       and conname = 'carts_items_count_chk'
  ) then
    alter table public.carts
      add constraint carts_items_count_chk
      check (jsonb_array_length(items) <= 50);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.carts'::regclass
       and conname = 'carts_items_size_chk'
  ) then
    alter table public.carts
      add constraint carts_items_size_chk
      check (octet_length(items::text) <= 8388608);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.orders'::regclass
       and conname = 'orders_items_count_chk'
  ) then
    alter table public.orders
      add constraint orders_items_count_chk
      check (jsonb_array_length(items) <= 50);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.orders'::regclass
       and conname = 'orders_items_size_chk'
  ) then
    alter table public.orders
      add constraint orders_items_size_chk
      check (octet_length(items::text) <= 8388608);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Monitorización: contador atómico y purga
-- ---------------------------------------------------------------------------

create index if not exists client_error_attempts_created_idx
  on public.client_error_attempts (created_at);

create or replace function public.take_client_error(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip integer;
  v_global integer;
begin
  if p_ip_hash is null or length(p_ip_hash) <> 64 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_ip_hash));

  select count(*) into v_ip
    from public.client_error_attempts
   where ip_hash = p_ip_hash
     and created_at > now() - interval '1 hour';

  if v_ip >= 20 then
    return false;
  end if;

  select count(*) into v_global
    from public.client_errors
   where created_at > now() - interval '1 hour';

  if v_global >= 2000 then
    return false;
  end if;

  insert into public.client_error_attempts (ip_hash)
  values (p_ip_hash);

  delete from public.client_error_attempts
   where created_at < now() - interval '2 days';

  return true;
end;
$$;

revoke all on function public.take_client_error(text) from public;
revoke all on function public.take_client_error(text) from anon;
revoke all on function public.take_client_error(text) from authenticated;
grant execute on function public.take_client_error(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Clip: intentos de cobro
-- ---------------------------------------------------------------------------

create table if not exists public.clip_pay_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  user_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists clip_pay_attempts_ip_idx
  on public.clip_pay_attempts (ip_hash, created_at desc);

create index if not exists clip_pay_attempts_user_idx
  on public.clip_pay_attempts (user_id, created_at desc);

create index if not exists clip_pay_attempts_created_idx
  on public.clip_pay_attempts (created_at);

alter table public.clip_pay_attempts enable row level security;

revoke all on public.clip_pay_attempts from public, anon, authenticated;
grant all on public.clip_pay_attempts to service_role;

create or replace function public.take_clip_pay(
  p_ip_hash text,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip integer;
  v_user integer;
begin
  if p_ip_hash is null or length(p_ip_hash) <> 64 or p_user_id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_ip_hash));

  select count(*) into v_ip
    from public.clip_pay_attempts
   where ip_hash = p_ip_hash
     and created_at > now() - interval '10 minutes';

  if v_ip >= 12 then
    return false;
  end if;

  select count(*) into v_user
    from public.clip_pay_attempts
   where user_id = p_user_id
     and created_at > now() - interval '10 minutes';

  if v_user >= 6 then
    return false;
  end if;

  insert into public.clip_pay_attempts (ip_hash, user_id)
  values (p_ip_hash, p_user_id);

  delete from public.clip_pay_attempts
   where created_at < now() - interval '2 days';

  return true;
end;
$$;

revoke all on function public.take_clip_pay(text, uuid) from public;
revoke all on function public.take_clip_pay(text, uuid) from anon;
revoke all on function public.take_clip_pay(text, uuid) from authenticated;
grant execute on function public.take_clip_pay(text, uuid) to service_role;

commit;
