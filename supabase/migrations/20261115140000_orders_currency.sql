-- Q-05 / LH-06: clip-pay y clip-checkout ya consultan orders.currency, pero la
-- columna no existia en el esquema. En una instalacion limpia el flujo fallaba
-- al seleccionarla, antes de poder cobrar.
--
-- Idempotente.

alter table public.orders
  add column if not exists currency text not null default 'MXN';

do $do$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'orders_currency_chk'
       and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_currency_chk check (currency ~ '^[A-Z]{3}$');
  end if;
end;
$do$;
