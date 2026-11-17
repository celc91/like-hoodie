-- Script heredado (LH-08). Si la base ya tiene el esquema actual, no se
-- reejecuta: reabriria permisos que las migraciones posteriores cierran.
do $do$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orders'
       and column_name = 'currency'
  ) then
    raise exception 'Script heredado: la base ya esta migrada. Usa scripts/bootstrap-local.mjs o supabase db push.';
  end if;
end;
$do$;

-- Cupones de descuento
-- Ejecuta esto en Supabase → SQL Editor → Run
--
-- IMPORTANTE: place_order NO se define en este archivo. La única versión
-- válida vive en fase1-pedidos-seguros.sql (5 argumentos y precio de servidor).
-- Así, volver a ejecutar este archivo no reabre la versión antigua que
-- confiaba en el unitPrice del navegador.

-- 1) Tabla de cupones
create table if not exists public.coupons (
  code text primary key,
  percent integer not null check (percent between 1 and 100),
  active boolean not null default true,
  max_uses integer,
  used_count integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.coupons enable row level security;

drop policy if exists "coupons_read_active" on public.coupons;
create policy "coupons_read_active"
  on public.coupons
  for select
  to anon, authenticated
  using (active = true);

grant select on public.coupons to anon, authenticated;

insert into public.coupons (code, percent)
values ('BIENVENIDA10', 10)
on conflict (code) do nothing;

-- 2) Columnas nuevas en los pedidos
alter table public.orders add column if not exists discount integer not null default 0;
alter table public.orders add column if not exists coupon text;

-- 3) place_order: ver supabase/fase1-pedidos-seguros.sql.
-- Para desactivar el código:
-- update public.coupons set active = false where code = 'BIENVENIDA10';
